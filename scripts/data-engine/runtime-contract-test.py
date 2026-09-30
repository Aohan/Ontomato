"""Pure local unit tests: no DB, Maven repository, model or service access."""
from contextlib import redirect_stdout
import importlib.util
from io import StringIO
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location('contract', Path(__file__).with_name('runtime-contract.py'))
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def class_jar(path, major, minor=0, entry='Test.class'):
    with zipfile.ZipFile(path, 'w') as jar:
        jar.writestr(entry, b'\xca\xfe\xba\xbe' + struct.pack('>HH', minor, major))


def elf(machine):
    data = bytearray(64)
    data[0:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', data, 18, machine)
    return bytes(data)


class RuntimeContractTests(unittest.TestCase):
    def test_java_class_version(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.jar'
            class_jar(path, 65)
            contract.check_jar(path, 65)
            with self.assertRaisesRegex(ValueError, 'Incompatible Java bytecode'):
                contract.check_jar(path, 61)

    def test_preview_class_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'preview.jar'
            class_jar(path, 65, 65535)
            with self.assertRaisesRegex(ValueError, 'Incompatible Java bytecode'):
                contract.check_jar(path, 65)

    def test_newer_multi_release_class_ignored_by_older_jre(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'multi.jar'
            with zipfile.ZipFile(path, 'w') as jar:
                jar.writestr('Test.class', b'\xca\xfe\xba\xbe' + struct.pack('>HH', 0, 61))
                jar.writestr('META-INF/versions/22/Test.class', b'\xca\xfe\xba\xbe' + struct.pack('>HH', 0, 66))
            contract.check_jar(path, 65)

    def test_bad_class_header_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bad.jar'
            with zipfile.ZipFile(path, 'w') as jar:
                jar.writestr('Bad.class', b'not-java')
            with self.assertRaisesRegex(ValueError, 'Invalid class header'):
                contract.check_jar(path, 65)

    def test_canonical_json(self):
        self.assertEqual(contract.fingerprint({'a': 'café', 'b': [2, 1]}), contract.fingerprint({'b': [2, 1], 'a': 'café'}))
        self.assertNotEqual(contract.fingerprint({'jars': 'first'}), contract.fingerprint({'jars': 'second'}))


class RuntimeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.arch = contract.architecture()
        self.other = 'amd64' if self.arch == 'arm64' else 'arm64'
        self.machine = 183 if self.arch == 'arm64' else 62

    def lib_with_jar(self, directory, so=None):
        root = Path(directory)
        lib = root / 'lib'
        lib.mkdir()
        class_jar(lib / 'app.jar', 65)
        if so is not None:
            (lib / 'native.so').write_bytes(so)
        (root / 'runtime-arch').write_text(self.arch)
        (root / 'runtime-contract.json').write_text(json.dumps({'java': {'classVersion': 65}}))
        return root

    def test_verify_runtime_checks_bytecode_and_elf(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.lib_with_jar(directory, so=elf(self.machine))
            contract.verify_runtime(root)

    def test_bad_elf_rejected_and_matching_elf_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.lib_with_jar(directory, so=b'\x7fELF')
            with self.assertRaisesRegex(ValueError, 'Native library'):
                contract.verify_runtime(root)
        with tempfile.TemporaryDirectory() as directory:
            root = self.lib_with_jar(directory, so=elf(62 if self.machine == 183 else 183))
            with self.assertRaisesRegex(ValueError, 'Native library'):
                contract.verify_runtime(root)

    def install(self, root, app, body):
        fingerprint = contract.fingerprint(body)
        (root / 'runtime-contract.json').write_text(json.dumps(body))
        (root / 'runtime-compat-fingerprint').write_text(fingerprint)
        (root / 'runtime-arch').write_text(self.arch)
        (app / 'runtime-family').write_text('java-app')
        (app / 'runtime-compat-fingerprint').write_text(fingerprint)
        return fingerprint

    def body(self):
        return {
            'family': 'java-app',
            'interfaceVersion': 3,
            'platform': f'linux/{self.arch}',
            'java': {'classVersion': 65},
            'runtimeDependencies': {'jars': 'a' * 64},
            'python': {'version': '3.10', 'packages': {'numpy': '2.2.6'}},
        }

    def test_public_assemble_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'runtime'
            app = Path(directory) / 'app'
            root.mkdir()
            app.mkdir()
            self.install(root, app, self.body())
            stdout = StringIO()
            with redirect_stdout(stdout):
                contract.main(['assemble'], root, app, {'EXPECTED_ARCH': self.arch})
            self.assertEqual(stdout.getvalue(), f'Assembly pairing OK (linux/{self.arch})\n')

    def test_assemble_rejects_family_fingerprint_and_arch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'runtime'
            app = Path(directory) / 'app'
            root.mkdir()
            app.mkdir()
            self.install(root, app, self.body())
            (app / 'runtime-family').write_text('other')
            with self.assertRaisesRegex(ValueError, 'family'):
                contract.assemble(root, app, {'EXPECTED_ARCH': self.arch})
            (app / 'runtime-family').write_text('java-app')
            (app / 'runtime-compat-fingerprint').write_text('0' * 64)
            with self.assertRaisesRegex(ValueError, 'fingerprint'):
                contract.assemble(root, app, {'EXPECTED_ARCH': self.arch})
            self.install(root, app, self.body())
            (root / 'runtime-arch').write_text(self.other)
            with self.assertRaisesRegex(ValueError, 'architecture'):
                contract.assemble(root, app, {'EXPECTED_ARCH': self.arch})
            self.install(root, app, self.body())
            with self.assertRaisesRegex(ValueError, 'Architecture mismatch'):
                contract.assemble(root, app, {'EXPECTED_ARCH': self.other})
            changed = self.body()
            changed['platform'] = f'linux/{self.other}'
            self.install(root, app, changed)
            with self.assertRaisesRegex(ValueError, 'family or actual architecture'):
                contract.assemble(root, app, {'EXPECTED_ARCH': self.arch})

    def test_cli_failure_exits_without_pairing_ok(self):
        completed = subprocess.run([sys.executable, str(Path(__file__).with_name('runtime-contract.py'))], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 1)
        self.assertTrue(completed.stderr.startswith('[contract] '))
        self.assertNotIn('Assembly pairing OK', completed.stdout)


if __name__ == '__main__':
    unittest.main()
