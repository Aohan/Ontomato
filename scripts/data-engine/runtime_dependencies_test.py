"""Run with the runtime's Python (packaging is an existing image dependency)."""
from types import SimpleNamespace
import unittest
from runtime_dependencies import python_contract


class PythonClosureTests(unittest.TestCase):
    def fixture(self):
        return {
            'app': SimpleNamespace(version='1.0', requires=['lib>=2', 'optional; extra == "render"', 'windows-only; sys_platform == "win32"']),
            'lib': SimpleNamespace(version='2.1', requires=[]),
            'optional': SimpleNamespace(version='3.0', requires=[]),
            'wheel': SimpleNamespace(version='99.0', requires=[]),
        }

    def test_only_required_closure_not_all_installed_tools(self):
        packages = self.fixture()
        result = python_contract('app==1.0 # comment\r\n', packages.__getitem__)
        self.assertEqual(result['packages'], {'app': '1.0', 'lib': '2.1'})
        packages['wheel'].version = '100.0'
        self.assertEqual(result, python_contract('app==1.0', packages.__getitem__))
        packages['lib'].version = '2.2'
        self.assertNotEqual(result, python_contract('app==1.0', packages.__getitem__))

    def test_transitive_extra_and_cycle_are_resolved(self):
        packages = self.fixture()
        packages['lib'].requires = ['app[render]==1.0']
        self.assertEqual(python_contract('app==1.0', packages.__getitem__)['packages'], {'app': '1.0', 'lib': '2.1', 'optional': '3.0'})

    def test_absent_and_incompatible_dependencies_fail(self):
        packages = self.fixture()
        del packages['lib']
        with self.assertRaises(KeyError):
            python_contract('app==1.0', packages.__getitem__)
        packages = self.fixture()
        packages['lib'].version = '1.0'
        with self.assertRaisesRegex(ValueError, 'dependency mismatch'):
            python_contract('app==1.0', packages.__getitem__)

    def test_roots_are_pinned_and_language_api_does_not_use_patch(self):
        with self.assertRaisesRegex(ValueError, 'exact'):
            python_contract('app>=1', self.fixture().__getitem__)
        result = python_contract('app==1.0', self.fixture().__getitem__)
        self.assertRegex(result['api'], r'^\d+\.\d+$')


if __name__ == '__main__':
    unittest.main()
