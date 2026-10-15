"""Build-time verification of the assembled data-engine image.

It checks what only the assembled image knows: every packaged jar runs on the JRE
the image carries, every native library is a 64-bit ELF of the target
architecture, and both this build's own jars and the third-party dependency set
are present. It runs inside ``docker build``; the running container never uses it.
"""
import argparse
import os
import re
import struct
import sys
import zipfile
from pathlib import Path

CLASS_HEADER = b'\xca\xfe\xba\xbe'
ELF_HEADER = b'\x7fELF\x02\x01'
ELF_MACHINE = {'amd64': 62, 'arm64': 183}


def java_major(java_home):
    """The bytecode level the image's own JRE accepts."""
    release = Path(java_home) / 'release'
    if not release.is_file():
        raise ValueError(f'JRE release file is missing: {release}')
    match = re.search(r'^JAVA_VERSION="(\d+)', release.read_text(), re.MULTILINE)
    if not match:
        raise ValueError(f'{release} does not declare JAVA_VERSION')
    return int(match.group(1))


def check_jar(path, maximum):
    """A new builder may not silently produce bytecode newer than the image's JRE."""
    with zipfile.ZipFile(path) as jar:
        for name in jar.namelist():
            if not name.endswith('.class'):
                continue
            versioned = re.match(r'META-INF/versions/(\d+)/', name)
            if versioned and int(versioned.group(1)) > maximum - 44:
                continue  # newer multi-release alternatives are ignored by this JRE
            with jar.open(name) as stream:
                header = stream.read(8)
            if len(header) != 8 or header[:4] != CLASS_HEADER:
                raise ValueError(f'Invalid class header: {path.name}!{name}')
            minor, major = struct.unpack('>HH', header[4:])
            if major > maximum or minor == 65535:
                raise ValueError(
                    f'Incompatible Java bytecode: {path.name}!{name} is {major}.{minor}, '
                    f'runtime supports non-preview <= {maximum}'
                )


def check_native(path, arch):
    data = path.read_bytes()
    if len(data) < 20 or data[:6] != ELF_HEADER or struct.unpack('<H', data[18:20])[0] != ELF_MACHINE[arch]:
        raise ValueError(f'Native library is not a 64-bit {arch} ELF: {path.name}')


def jars(directory):
    return sorted(path for path in directory.iterdir() if path.is_file() and path.suffix == '.jar')


def verify(app, lib, arch, java_home):
    if arch not in ELF_MACHINE:
        raise ValueError(f'Unsupported target architecture: {arch}')
    # Java N class files carry major version N + 44.
    maximum = java_major(java_home) + 44
    own = jars(app / 'lib')
    if not own:
        raise ValueError(f'No application jar under {app / "lib"}')
    third_party = jars(lib)
    if not third_party:
        raise ValueError(f'No third-party jar under {lib}')
    for path in own + third_party:
        check_jar(path, maximum)
    native = sorted(path for path in lib.iterdir() if path.is_file() and path.suffix == '.so')
    for path in native:
        check_native(path, arch)
    return len(own), len(third_party), len(native)


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, help='application root inside the image')
    parser.add_argument('--lib', required=True, help='third-party runtime library directory inside the image')
    parser.add_argument('--arch', required=True, choices=sorted(ELF_MACHINE), help='target architecture of this build')
    args = parser.parse_args(argv)
    java_home = os.environ.get('JAVA_HOME')
    if not java_home:
        raise ValueError('JAVA_HOME is required')
    own, third_party, native = verify(Path(args.app), Path(args.lib), args.arch, java_home)
    print(
        f'Image verification OK ({args.arch}): {own} application jars, '
        f'{third_party} third-party jars, {native} native libraries'
    )


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'[verify-image] {error}', file=sys.stderr)
        sys.exit(1)
