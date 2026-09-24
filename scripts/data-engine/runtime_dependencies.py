"""Inspect only the installed Python closure required by the application."""
import importlib.metadata
import json
from pathlib import Path
import re
import sys


def python_contract(text, distribution=importlib.metadata.distribution):
    from packaging.requirements import Requirement
    pending = []
    for raw in text.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if not re.fullmatch(r'[A-Za-z0-9_.-]+==[^\s;]+', line):
            raise ValueError(f'Runtime Python requirements need exact name==version pins: {line}')
        pending.append(Requirement(line))
    packages, visited = {}, set()
    while pending:
        required = pending.pop()
        name = re.sub(r'[-_.]+', '-', required.name.lower())
        installed = distribution(name)
        if not required.specifier.contains(installed.version, prereleases=True):
            raise ValueError(f'Installed Python dependency mismatch: {required}, found {installed.version}')
        packages[name] = installed.version
        # A later path may request additional extras from an already visited package.
        for extra in {''} | required.extras:
            if (name, extra) in visited:
                continue
            visited.add((name, extra))
            for declaration in installed.requires or []:
                child = Requirement(declaration)
                if child.marker is None or child.marker.evaluate({'extra': extra}):
                    pending.append(child)
    return {'api': f'{sys.version_info.major}.{sys.version_info.minor}', 'packages': packages}


if __name__ == '__main__':
    print(json.dumps(python_contract(Path(sys.argv[1]).read_text()), sort_keys=True))
