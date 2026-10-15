"""Real verification runs on synthetic jars, ELF headers and JRE layouts; no Docker,
no Maven and no product artifact is involved."""
import importlib.util
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name('verify-image.py')

spec = importlib.util.spec_from_file_location('verify_image', SCRIPT)
verify_image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_image)


def class_entry(major, minor=0):
    return b'\xca\xfe\xba\xbe' + struct.pack('>HH', minor, major)


def write_jar(path, entries):
    with zipfile.ZipFile(path, 'w') as jar:
        for name, data in entries.items():
            jar.writestr(name, data)


def elf(machine):
    data = bytearray(64)
    data[0:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', data, 18, machine)
    return bytes(data)


class Fixture:
    """One image layout: the application jars, the third-party library directory
    and the JRE release file the image would carry."""

    def __init__(self, root, jre_major=21):
        self.root = Path(root)
        self.app = self.root / 'app'
        self.lib = self.root / 'lib'
        self.java_home = self.root / 'java'
        (self.app / 'lib').mkdir(parents=True)
        self.lib.mkdir()
        self.java_home.mkdir()
        self.set_jre(jre_major)
        self.write_jar(self.app / 'lib' / 'app.jar', {'App.class': class_entry(65)})
        self.write_jar(self.lib / 'dep.jar', {'Dep.class': class_entry(65)})

    def set_jre(self, major, text=None):
        (self.java_home / 'release').write_text(
            text if text is not None else f'JAVA_VERSION="{major}.0.5+11"\n'
        )

    def write_jar(self, path, entries):
        write_jar(path, entries)

    def run(self):
        return verify_image.verify(self.app, self.lib, 'amd64', self.java_home)


class JavaMajorTests(unittest.TestCase):
    def test_reads_the_declared_jre_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'release').write_text('JAVA_VERSION="21.0.9+11"\n')
            self.assertEqual(verify_image.java_major(root), 21)

    def test_missing_release_or_version_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'release file is missing'):
                verify_image.java_major(root)
            (root / 'release').write_text('IMPLEMENTOR="Eclipse Adoptium"\n')
            with self.assertRaisesRegex(ValueError, 'JAVA_VERSION'):
                verify_image.java_major(root)


class JarTests(unittest.TestCase):
    def test_bytecode_above_the_jre_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / 'a.jar'
            write_jar(jar, {'A.class': class_entry(65)})
            verify_image.check_jar(jar, 65)
            write_jar(jar, {'A.class': class_entry(66)})
            with self.assertRaisesRegex(ValueError, r'is 66\.0, runtime supports non-preview <= 65'):
                verify_image.check_jar(jar, 65)

    def test_preview_bytecode_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / 'a.jar'
            write_jar(jar, {'A.class': class_entry(65, minor=65535)})
            with self.assertRaisesRegex(ValueError, 'non-preview'):
                verify_image.check_jar(jar, 65)

    def test_invalid_class_header_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / 'a.jar'
            write_jar(jar, {'A.class': b'not a class'})
            with self.assertRaisesRegex(ValueError, 'Invalid class header'):
                verify_image.check_jar(jar, 65)

    def test_newer_multi_release_alternatives_are_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / 'a.jar'
            write_jar(
                jar,
                {
                    'A.class': class_entry(65),
                    'META-INF/versions/25/A.class': class_entry(69),
                },
            )
            verify_image.check_jar(jar, 65)
            write_jar(jar, {'META-INF/versions/17/A.class': class_entry(69)})
            with self.assertRaisesRegex(ValueError, 'non-preview <= 65'):
                verify_image.check_jar(jar, 65)

    def test_non_class_entries_are_not_read(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / 'a.jar'
            write_jar(jar, {'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n'})
            verify_image.check_jar(jar, 65)


class NativeTests(unittest.TestCase):
    def test_native_library_must_be_the_target_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'native.so'
            path.write_bytes(elf(62))
            verify_image.check_native(path, 'amd64')
            with self.assertRaisesRegex(ValueError, 'not a 64-bit arm64 ELF'):
                verify_image.check_native(path, 'arm64')

    def test_non_elf_file_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'native.so'
            path.write_bytes(b'not an elf')
            with self.assertRaisesRegex(ValueError, 'not a 64-bit amd64 ELF'):
                verify_image.check_native(path, 'amd64')

    def test_both_architectures_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'native.so'
            for arch, machine in (('amd64', 62), ('arm64', 183)):
                path.write_bytes(elf(machine))
                verify_image.check_native(path, arch)


class VerifyTests(unittest.TestCase):
    def fixture(self, root):
        return Fixture(root)

    def test_complete_image_passes_with_its_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(directory)
            (fixture.lib / 'native.so').write_bytes(elf(62))
            self.assertEqual(fixture.run(), (1, 1, 1))

    def test_missing_jar_sets_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(directory)
            (fixture.app / 'lib' / 'app.jar').unlink()
            with self.assertRaisesRegex(ValueError, 'No application jar'):
                fixture.run()
            fixture.write_jar(fixture.app / 'lib' / 'app.jar', {'App.class': class_entry(65)})
            (fixture.lib / 'dep.jar').unlink()
            with self.assertRaisesRegex(ValueError, 'No third-party jar'):
                fixture.run()

    def test_jar_of_either_set_above_the_jre_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(directory)
            fixture.write_jar(fixture.lib / 'dep.jar', {'Dep.class': class_entry(66)})
            with self.assertRaisesRegex(ValueError, 'dep.jar'):
                fixture.run()

    def test_native_library_of_the_wrong_architecture_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(directory)
            (fixture.lib / 'native.so').write_bytes(elf(183))
            with self.assertRaisesRegex(ValueError, 'amd64 ELF'):
                fixture.run()

    def test_unknown_target_architecture_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self.fixture(directory)
            with self.assertRaisesRegex(ValueError, 'Unsupported target architecture'):
                verify_image.verify(fixture.app, fixture.lib, 'riscv64', fixture.java_home)


class CliTests(unittest.TestCase):
    def test_success_prints_the_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), '--app', str(fixture.app), '--lib', str(fixture.lib), '--arch', 'amd64'],
                capture_output=True,
                text=True,
                env={**os.environ, 'JAVA_HOME': str(fixture.java_home)},
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn('Image verification OK (amd64): 1 application jars', completed.stdout)

    def test_failure_exits_with_the_prefixed_message(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            fixture.write_jar(fixture.lib / 'dep.jar', {'Dep.class': class_entry(99)})
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), '--app', str(fixture.app), '--lib', str(fixture.lib), '--arch', 'amd64'],
                capture_output=True,
                text=True,
                env={**os.environ, 'JAVA_HOME': str(fixture.java_home)},
            )
            self.assertEqual(completed.returncode, 1)
            self.assertTrue(completed.stderr.startswith('[verify-image] '), completed.stderr)
            self.assertEqual(completed.stdout, '')

    def test_missing_java_home_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            environment = {key: value for key, value in os.environ.items() if key != 'JAVA_HOME'}
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), '--app', str(fixture.app), '--lib', str(fixture.lib), '--arch', 'amd64'],
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertIn('JAVA_HOME is required', completed.stderr)


if __name__ == '__main__':
    unittest.main()
