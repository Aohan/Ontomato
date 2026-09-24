"""Runtime contract inspection/checks inside Linux images; no host Python needed."""
import hashlib
from runtime_dependencies import python_contract
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
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


def check_requirements(text, packages):
    for raw in text.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([^\s;]+)', line)
        if not match:
            raise ValueError(f'Runtime Python requirements need exact name==version pins: {line}')
        name = re.sub(r'[-_.]+', '-', match[1].lower())
        if packages.get(name) != match[2]:
            raise ValueError(f'Runtime Python dependency mismatch: {name} requires {match[2]}, provides {packages.get(name, "missing")}')


def java_class_version():
    java = subprocess.run(['java', '-XshowSettings:properties', '-version'], capture_output=True, text=True, check=True)
    properties = dict(re.findall(r'^\s*([\w.]+) = (.+)$', java.stderr, re.MULTILINE))
    return int(float(properties['java.class.version']))


def scan_runtime_lib(lib, maximum, arch):
    jars, native = {}, {}
    for path in sorted(lib.iterdir()):
        if path.suffix == '.jar':
            check_jar(path, maximum)
            jars[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        elif path.suffix == '.so':
            data = path.read_bytes()
            expected_machine = 62 if arch == 'amd64' else 183
            if len(data) < 20 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', data[18:20])[0] != expected_machine:
                raise ValueError(f'Native library is not a 64-bit {arch} ELF: {path.name}')
            native[path.name] = hashlib.sha256(data).hexdigest()
    if not jars:
        raise ValueError('Runtime is missing Java dependencies')
    return jars, native


def inspect(interface_version, root=ROOT):
    if interface_version < 1:
        raise ValueError('Invalid runtime interface version')
    maximum = java_class_version()
    arch = architecture()
    jars, native = scan_runtime_lib(root / 'lib', maximum, arch)
    return {
        'family': 'java-app', 'interfaceVersion': interface_version,
        'platform': f'linux/{arch}',
        'java': {'classVersion': maximum},
        'runtimeDependencies': {'jars': fingerprint(jars), 'native': fingerprint(native)},
        'libc': list(platform.libc_ver()),
        'python': python_contract((root / 'requirements.txt').read_text()),
    }


def load_contract(root=ROOT):
    contract = json.loads((root / 'runtime-contract.json').read_text())
    actual = (root / 'runtime-compat-fingerprint').read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}', actual) or fingerprint(contract) != actual:
        raise ValueError('Runtime contract/fingerprint mismatch')
    if contract['family'] != 'java-app' or contract['platform'] != f'linux/{architecture()}':
        raise ValueError('Runtime family or actual architecture mismatch')
    return contract, actual


def pair(root=ROOT, app=APP, environ=os.environ):
    contract, actual = load_contract(root)
    if (app / 'runtime-family').read_text().strip() != 'java-app':
        raise ValueError('Application runtime family mismatch')
    if (app / 'runtime-compat-fingerprint').read_text().strip() != actual:
        raise ValueError('App/runtime compatibility fingerprint mismatch')
    arch = architecture()
    if (root / 'runtime-arch').read_text().strip() != arch:
        raise ValueError('Runtime recorded architecture mismatch')
    expected_arch = environ.get('EXPECTED_ARCH')
    if expected_arch is not None and expected_arch != arch:
        raise ValueError(f'Architecture mismatch: expected {expected_arch}, actual {arch}')
    return contract


def main(argv, root=ROOT, app=APP, environ=os.environ):
    command, *args = argv
    if command == 'inspect':
        print(canonical(inspect(int(args[0]), root)))
    elif command == 'check-app':
        loaded, _ = load_contract(root)
        check_jar(Path(args[0]), loaded['java']['classVersion'])
        check_requirements(Path(args[1]).read_text(), loaded['python']['packages'])
        print('Application bytecode and Python requirements match the runtime')
    elif command == 'pair':
        contract = pair(root, app, environ)
        print(f'Pairing OK ({contract["platform"]})')
    else:
        raise ValueError(f'Unknown runtime contract command: {command}')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'[contract] {error}', file=sys.stderr)
        sys.exit(1)
