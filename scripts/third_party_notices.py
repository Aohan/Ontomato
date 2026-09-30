"""Third-party notices of what one image build installed or bundled.

Runs inside the build stage that holds the content, never on the host. Every
component comes from that content: npm packages from a `pnpm licenses list
--json` report and the package directories it names, Python packages from the
installed distributions' metadata, Java jars from the files under a lib
directory joined with the Maven license records exported next to them. The
image's own system-component section is read from stdin.

usage: third_party_notices.py OUTPUT [--npm REPORT] [--python] [--jars LIB MAVEN_JSON] < system.txt
"""
import argparse
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import zipfile

# A shipped license file: the first path component under the package root (or
# under a jar's META-INF, or a wheel's dist-info) starts with one of these.
LICENSE_NAME = re.compile(r'(LICEN[CS]E|COPYING|NOTICE)', re.IGNORECASE)
RULE = '=' * 72
ITEM = '-' * 72


def decode(data):
    return data.decode('utf-8', errors='replace')


def component(name, version, declared, homepage, texts, links):
    return {'name': name, 'version': version, 'license': declared,
            'homepage': homepage, 'texts': texts, 'links': links}


def spdx_links(expression):
    """npm `license` and Python `License-Expression` are SPDX expressions by definition."""
    ids = [token for token in re.split(r'[\s()]+', expression)
           if token and token not in ('AND', 'OR', 'WITH') and not token.startswith('LicenseRef-')]
    return [f'https://spdx.org/licenses/{token.rstrip("+")}.html' for token in ids]


def directory_texts(root):
    texts = []
    for entry in sorted(root.iterdir()):
        if not LICENSE_NAME.match(entry.name):
            continue
        files = sorted(path for path in entry.rglob('*') if path.is_file()) if entry.is_dir() else [entry]
        texts += [(path.relative_to(root).as_posix(), decode(path.read_bytes())) for path in files]
    return texts


def npm_homepage(manifest):
    repository = manifest.get('repository')
    if isinstance(repository, dict):
        repository = repository.get('url')
    return manifest.get('homepage') or repository or ''


def npm_components(report):
    """One component per installed package directory the report names."""
    for declared, packages in report.items():
        for package in packages:
            for path in package['paths']:
                root = Path(path)
                manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
                if manifest['name'] != package['name'] or manifest['version'] not in package['versions']:
                    raise ValueError(f'pnpm report does not match {path}: {manifest["name"]}@{manifest["version"]}')
                yield component(manifest['name'], manifest['version'], declared, npm_homepage(manifest),
                                directory_texts(root), spdx_links(declared))


def python_components(distributions):
    for dist in distributions:
        meta = dist.metadata
        expression = meta.get('License-Expression')
        field = (meta.get('License') or '').strip()
        classifiers = [value.split(' :: ')[-1] for value in meta.get_all('Classifier') or []
                       if value.startswith('License :: ')]
        declared = expression or (field if field and '\n' not in field else '') or '; '.join(classifiers) or 'UNKNOWN'
        urls = [value.split(',', 1)[1].strip() for value in meta.get_all('Project-URL') or []]
        homepage = meta.get('Home-page') or (urls[0] if urls else '')
        texts = []
        for path in dist.files:
            # Files inside the dist-info, including a PEP 639 licenses/ directory.
            parts = path.parts
            if parts[0].endswith('.dist-info') and len(parts) > 1 and LICENSE_NAME.match(parts[1]):
                texts.append(('/'.join(parts[1:]), decode(dist.locate_file(path).read_bytes())))
        # A multi-line License field is the license text itself, not a name.
        if '\n' in field:
            texts.append(('License metadata field', field))
        yield component(meta['Name'], dist.version, declared, homepage, sorted(texts),
                        spdx_links(expression) if expression else [])


def jar_texts(path):
    with zipfile.ZipFile(path) as jar:
        texts = []
        for name in sorted(jar.namelist()):
            relative = name[len('META-INF/'):] if name.startswith('META-INF/') else name
            if not name.endswith('/') and LICENSE_NAME.match(relative.split('/')[0]):
                texts.append((name, decode(jar.read(name))))
        return texts


def java_components(lib, records):
    """Every file under lib is one Maven artifact named <artifactId>-<version>[-<classifier>].<type>."""
    for path in sorted(lib.iterdir()):
        matches = [record for record in records
                   if path.name == f'{record["artifactId"]}-{record["version"]}{path.suffix}'
                   or path.name.startswith(f'{record["artifactId"]}-{record["version"]}-')]
        if len(matches) != 1:
            raise ValueError(f'{path.name} matches {len(matches)} Maven license records, expected 1')
        record = matches[0]
        declared = '; '.join(entry['name'] for entry in record['licenses']) or 'UNKNOWN'
        links = [entry['url'] for entry in record['licenses'] if entry['url']]
        texts = jar_texts(path) if path.suffix == '.jar' else []
        yield component(f'{record["groupId"]}:{record["artifactId"]}', record['version'], declared,
                        record['url'], texts, links) | {'file': path.name}


def render_component(item):
    lines = [ITEM, f'Name: {item["name"]}', f'Version: {item["version"]}']
    if 'file' in item:
        lines.append(f'File: {item["file"]}')
    lines += [f'License: {item["license"]}', f'Homepage: {item["homepage"] or "(not declared)"}', '']
    if not item['texts']:
        links = ', '.join(item['links']) or '(no standard text link: the declared license is not an SPDX identifier)'
        lines += ['No license file is shipped with this component.', f'License text: {links}', '']
    for label, text in item['texts']:
        lines += [f'--- {label} ---', text.rstrip('\n'), '']
    return lines


def render(system, sections):
    lines = ['THIRD-PARTY SOFTWARE NOTICES', '',
             'Generated at image build time from the content installed in or bundled into this image.', '',
             RULE, 'System components', RULE, system.rstrip('\n'), '']
    for title, items in sections:
        ordered = sorted(items, key=lambda item: (item['name'].lower(), item['version']))
        lines += [RULE, f'{title} ({len(ordered)})', RULE]
        for item in ordered:
            lines += render_component(item)
    return '\n'.join(lines) + '\n'


def main(argv, stdin=sys.stdin):
    parser = argparse.ArgumentParser(prog='third_party_notices.py')
    parser.add_argument('output', type=Path)
    parser.add_argument('--npm', type=Path)
    parser.add_argument('--python', action='store_true')
    parser.add_argument('--jars', nargs=2, type=Path, metavar=('LIB', 'MAVEN_JSON'))
    args = parser.parse_args(argv)
    sections = []
    if args.npm:
        sections.append(('npm packages', list(npm_components(json.loads(args.npm.read_text(encoding='utf-8'))))))
    if args.python:
        sections.append(('Python packages', list(python_components(importlib.metadata.distributions()))))
    if args.jars:
        lib, records = args.jars
        sections.append(('Java libraries', list(java_components(lib, json.loads(records.read_text(encoding='utf-8'))))))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(stdin.read(), sections), encoding='utf-8')
    for title, items in sections:
        print(f'[notices] {title}: {len(items)}')


if __name__ == '__main__':
    main(sys.argv[1:])
