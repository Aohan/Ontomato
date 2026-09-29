"""Runtime self-checks and assembly pairing inside Linux images; no host Python needed."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import struct
import sys
import zipfile

ROOT = Path('/opt/datarag')
APP = Path('/app')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def architecture():
    machine = platform.machine()
    if machine in ('aarch64', 'arm64'):
        return 'arm64'
    if machine in ('x86_64', 'amd64'):
        return 'amd64'
    raise ValueError(f'Unsupported runtime architecture: {machine}')


def check_jar(path, maximum):
    """A new builder may not silently produce bytecode newer than the locked JRE."""
    with zipfile.ZipFile(path) as jar:
        for name in jar.namelist():
            if not name.endswith('.class'):
                continue
            versioned = re.match(r'META-INF/versions/(\d+)/', name)
            if versioned and int(versioned[1]) > maximum - 44:
                continue  # newer multi-release alternatives are ignored by this JRE
            with jar.open(name) as stream:
                header = stream.read(8)
            if len(header) != 8 or header[:4] != b'\xca\xfe\xba\xbe':
                raise ValueError(f'Invalid class header: {path.name}!{name}')
            minor, major = struct.unpack('>HH', header[4:])
            if major > maximum or minor == 65535:
                raise ValueError(f'Incompatible Java bytecode: {path.name}!{name} is {major}.{minor}, runtime supports non-preview <= {maximum}')


def verify_runtime(root=ROOT):
    arch = (root / 'runtime-arch').read_text().strip()
    contract = json.loads((root / 'runtime-contract.json').read_text())
    maximum = contract['java']['classVersion']
    lib = root / 'lib'
    for path in sorted(lib.iterdir()):
        if path.suffix == '.jar':
            check_jar(path, maximum)
        elif path.suffix == '.so':
            data = path.read_bytes()
            expected_machine = 62 if arch == 'amd64' else 183
            if len(data) < 20 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', data[18:20])[0] != expected_machine:
                raise ValueError(f'Native library is not a 64-bit {arch} ELF: {path.name}')


def load_contract(root=ROOT):
    contract = json.loads((root / 'runtime-contract.json').read_text())
    actual = (root / 'runtime-compat-fingerprint').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}', actual) or fingerprint(contract) != actual:
        raise ValueError('Runtime contract/fingerprint mismatch')
    if contract['family'] != 'java-app' or contract['platform'] != f'linux/{architecture()}':
        raise ValueError('Runtime family or actual architecture mismatch')
    return contract, actual


def assemble(root=ROOT, app=APP, environ=os.environ):
    contract, actual = load_contract(root)
    if (app / 'runtime-family').read_text().strip() != 'java-app':
        raise ValueError('Application runtime family mismatch')
    if (app / 'runtime-compat-fingerprint').read_text().strip() != actual:
        raise ValueError('App/runtime compatibility fingerprint mismatch')
    arch = architecture()
    if (root / 'runtime-arch').read_text().strip() != arch:
        raise ValueError('Runtime recorded architecture mismatch')
    expected_arch = environ['EXPECTED_ARCH']
    if expected_arch != arch:
        raise ValueError(f'Architecture mismatch: expected {expected_arch}, actual {arch}')
    return contract


def main(argv, root=ROOT, app=APP, environ=os.environ):
    command, *args = argv
    if command == 'verify-runtime':
        verify_runtime(Path(args[0]))
        print('Runtime verification OK')
    elif command == 'assemble':
        contract = assemble(root, app, environ)
        print(f'Assembly pairing OK ({contract["platform"]})')
    else:
        raise ValueError(f'Unknown runtime contract command: {command}')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'[contract] {error}', file=sys.stderr)
        sys.exit(1)
