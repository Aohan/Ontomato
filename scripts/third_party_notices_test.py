"""Pure local unit tests: fixture package trees, dist-info directories and jars only."""
import importlib.metadata
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import third_party_notices as notices


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return path


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()


class NpmTests(Fixture):
    def package(self, store, name, version, **extra):
        root = self.root / store / 'node_modules' / name
        write(root / 'package.json', json.dumps({'name': name, 'version': version, **extra}))
        return root

    def test_each_installed_directory_is_one_component_with_its_license_files(self):
        old = self.package('accepts@1.3.8', 'accepts', '1.3.8', homepage='https://accepts.example')
        new = self.package('accepts@2.0.0', 'accepts', '2.0.0', repository={'url': 'git+https://github.com/jshttp/accepts.git'})
        write(old / 'LICENSE', 'MIT old')
        write(new / 'license.md', 'MIT new')
        write(new / 'index.js', 'module.exports = 1')
        apache = self.package('long@5.0.0', 'long', '5.0.0', repository='dcodeIO/long.js')
        write(apache / 'NOTICE', 'Apache notice')
        write(apache / 'LICENSES' / 'Apache-2.0.txt', 'Apache text')
        report = {
            'MIT': [{'name': 'accepts', 'versions': ['1.3.8', '2.0.0'], 'paths': [str(old), str(new)]}],
            'Apache-2.0': [{'name': 'long', 'versions': ['5.0.0'], 'paths': [str(apache)]}],
        }
        items = {(item['name'], item['version']): item for item in notices.npm_components(report)}
        self.assertEqual(sorted(items), [('accepts', '1.3.8'), ('accepts', '2.0.0'), ('long', '5.0.0')])
        self.assertEqual(items['accepts', '1.3.8']['homepage'], 'https://accepts.example')
        self.assertEqual(items['accepts', '2.0.0']['homepage'], 'git+https://github.com/jshttp/accepts.git')
        self.assertEqual(items['accepts', '2.0.0']['texts'], [('license.md', 'MIT new')])
        self.assertEqual(items['long', '5.0.0']['homepage'], 'dcodeIO/long.js')
        self.assertEqual(items['long', '5.0.0']['texts'], [('LICENSES/Apache-2.0.txt', 'Apache text'), ('NOTICE', 'Apache notice')])

    def test_report_that_does_not_match_the_directory_fails(self):
        root = self.package('ms@2.1.3', 'ms', '2.1.3')
        report = {'MIT': [{'name': 'ms', 'versions': ['2.0.0'], 'paths': [str(root)]}]}
        with self.assertRaisesRegex(ValueError, 'does not match'):
            list(notices.npm_components(report))

    def test_spdx_links_skip_operators_and_license_refs(self):
        self.assertEqual(notices.spdx_links('(MIT OR Apache-2.0) AND LicenseRef-Foo'),
                         ['https://spdx.org/licenses/MIT.html', 'https://spdx.org/licenses/Apache-2.0.html'])
        self.assertEqual(notices.spdx_links('GPL-2.0+ WITH Classpath-exception-2.0'),
                         ['https://spdx.org/licenses/GPL-2.0.html', 'https://spdx.org/licenses/Classpath-exception-2.0.html'])


class PythonTests(Fixture):
    def distribution(self, name, version, headers, files):
        info = self.root / f'{name}-{version}.dist-info'
        write(info / 'METADATA', f'Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n{headers}\n')
        for relative, text in files.items():
            write(self.root / relative, text)
        write(info / 'RECORD', ''.join(f'{relative},,\n' for relative in [*files, f'{info.name}/METADATA']))

    def components(self):
        found = importlib.metadata.distributions(path=[str(self.root)])
        return {item['name']: item for item in notices.python_components(found)}

    def test_metadata_and_dist_info_license_files(self):
        self.distribution('numpy', '1.26.4', 'License: BSD-3-Clause\nHome-page: https://numpy.org', {
            'numpy-1.26.4.dist-info/LICENSE.txt': 'numpy license',
            'numpy/__init__.py': '',
        })
        self.distribution('mcp', '1.0.0', 'License-Expression: MIT\nProject-URL: Homepage, https://mcp.example', {
            'mcp-1.0.0.dist-info/licenses/LICENSE': 'mcp license',
        })
        self.distribution('pandas', '1.5.3', 'License: BSD 3-Clause License\n  \n  Copyright pandas\nClassifier: License :: OSI Approved :: BSD License', {})
        self.distribution('wheel', '0.45.1', 'Classifier: License :: OSI Approved :: MIT License', {})
        items = self.components()
        self.assertEqual(items['numpy']['license'], 'BSD-3-Clause')
        self.assertEqual(items['numpy']['homepage'], 'https://numpy.org')
        self.assertEqual(items['numpy']['texts'], [('LICENSE.txt', 'numpy license')])
        self.assertEqual(items['mcp']['homepage'], 'https://mcp.example')
        self.assertEqual(items['mcp']['texts'], [('licenses/LICENSE', 'mcp license')])
        self.assertEqual(items['mcp']['links'], ['https://spdx.org/licenses/MIT.html'])
        # A multi-line License field is text, so the classifier names the license.
        self.assertEqual(items['pandas']['license'], 'BSD License')
        self.assertEqual(items['pandas']['texts'][0][0], 'License metadata field')
        self.assertIn('Copyright pandas', items['pandas']['texts'][0][1])
        self.assertEqual((items['wheel']['license'], items['wheel']['links']), ('MIT License', []))


class JavaTests(Fixture):
    def jar(self, name, entries):
        path = self.root / 'lib' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, 'w') as jar:
            for entry, text in entries.items():
                jar.writestr(entry, text)
        return path

    RECORDS = [
        {'groupId': 'io.netty', 'artifactId': 'netty-common', 'version': '4.1.0', 'url': 'https://netty.io',
         'licenses': [{'name': 'Apache License, Version 2.0', 'url': 'https://www.apache.org/licenses/LICENSE-2.0'}]},
        {'groupId': 'org.example', 'artifactId': 'native', 'version': '1.0', 'url': '',
         'licenses': [{'name': 'MIT', 'url': 'https://opensource.org/licenses/MIT'}]},
        {'groupId': 'org.example', 'artifactId': 'own-core', 'version': '4.0.0', 'url': '', 'licenses': []},
    ]

    def test_every_lib_file_joins_one_record_and_keeps_meta_inf_texts(self):
        self.jar('netty-common-4.1.0.jar', {
            'META-INF/LICENSE.txt': 'apache', 'META-INF/NOTICE.txt': 'netty notice',
            'META-INF/license/LICENSE.jctools.txt': 'jctools', 'META-INF/MANIFEST.MF': 'x',
            'io/netty/License.class': 'not a license file',
        })
        self.jar('native-1.0-linux-x86_64.jar', {})
        items = list(notices.java_components(self.root / 'lib', self.RECORDS))
        self.assertEqual([item['file'] for item in items], ['native-1.0-linux-x86_64.jar', 'netty-common-4.1.0.jar'])
        netty = items[1]
        self.assertEqual((netty['name'], netty['version'], netty['homepage']), ('io.netty:netty-common', '4.1.0', 'https://netty.io'))
        self.assertEqual(netty['license'], 'Apache License, Version 2.0')
        self.assertEqual([label for label, _ in netty['texts']],
                         ['META-INF/LICENSE.txt', 'META-INF/NOTICE.txt', 'META-INF/license/LICENSE.jctools.txt'])
        self.assertEqual(items[0]['links'], ['https://opensource.org/licenses/MIT'])

    def test_lib_file_without_record_fails(self):
        self.jar('unknown-2.0.jar', {})
        with self.assertRaisesRegex(ValueError, 'unknown-2.0.jar matches 0 Maven license records'):
            list(notices.java_components(self.root / 'lib', self.RECORDS))


class RenderTests(Fixture):
    def test_output_has_system_section_counts_texts_and_fallback_links(self):
        package = self.root / 'store' / 'node_modules' / 'left-pad'
        write(package / 'package.json', json.dumps({'name': 'left-pad', 'version': '1.3.0'}))
        report = write(self.root / 'report.json', json.dumps(
            {'WTFPL': [{'name': 'left-pad', 'versions': ['1.3.0'], 'paths': [str(package)]}]}))
        lib = self.root / 'lib'
        lib.mkdir()
        with zipfile.ZipFile(lib / 'a-1.jar', 'w') as jar:
            jar.writestr('META-INF/NOTICE', 'A notice')
        records = write(self.root / 'maven.json', json.dumps([
            {'groupId': 'g', 'artifactId': 'a', 'version': '1', 'url': 'https://a.example',
             'licenses': [{'name': 'Apache-2.0', 'url': 'https://www.apache.org/licenses/LICENSE-2.0'}]}]))
        output = self.root / 'out' / 'THIRD_PARTY_NOTICES.txt'
        notices.main([str(output), '--npm', str(report), '--jars', str(lib), str(records)],
                     StringIO('Debian packages: /usr/share/doc/*/copyright\n'))
        text = output.read_text(encoding='utf-8')
        self.assertIn('System components\n' + notices.RULE + '\nDebian packages: /usr/share/doc/*/copyright\n', text)
        self.assertIn('npm packages (1)', text)
        self.assertIn('Name: left-pad\nVersion: 1.3.0\nLicense: WTFPL\nHomepage: (not declared)\n\n'
                      'No license file is shipped with this component.\n'
                      'License text: https://spdx.org/licenses/WTFPL.html\n', text)
        self.assertIn('Java libraries (1)', text)
        self.assertIn('Name: g:a\nVersion: 1\nFile: a-1.jar\nLicense: Apache-2.0\n', text)
        self.assertIn('--- META-INF/NOTICE ---\nA notice\n', text)
        self.assertNotIn('Python packages', text)


if __name__ == '__main__':
    unittest.main()
