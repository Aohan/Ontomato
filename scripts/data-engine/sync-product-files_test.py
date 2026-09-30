"""Real sync runs in temporary directories with the shipped script and interpreter. The fixture root
deliberately contains a space; nothing under the product, .dev or runtime data is touched."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("sync-product-files.py")
CONF_DEFAULTS = {
    "prompt.md": "default v1\n",
    "application.yml": "app: template\n",
    "mcp-clients.yml": "mcp: template\n",
    ".hidden.md": "hidden\n",
    "lang/zh-CN.json": '{"a": 1}\n',
    "template/nested/file.txt": "nested v1\n",
}
SKILLS = {
    "aftercalculate/trend-forecaster/SKILL.md": "skill v1\n",
    "aftercalculate/trend-forecaster/scripts/run.py": "# py\n",
}


def write(root, files):
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")


class SyncProductFilesTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="sync product files "))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.conf = self.root / "payload/conf-defaults"
        self.skills = self.root / "payload/skills"
        self.data = self.root / ".dev"
        write(self.conf, CONF_DEFAULTS)
        write(self.skills, SKILLS)

    def sync(self, *arguments):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *(str(argument) for argument in arguments)],
            capture_output=True, text=True,
        )

    def read(self, relative):
        return (self.data / relative).read_text(encoding="utf-8")

    def test_first_sync_creates_the_four_directories_and_copies_defaults(self):
        result = self.sync(self.conf, self.skills, self.data)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[sync] conf synced ->", result.stdout)
        self.assertIn("[sync] skills synced ->", result.stdout)
        for directory in ("conf", "skills", "logs", "python"):
            self.assertTrue((self.data / directory).is_dir(), directory)
        self.assertEqual(self.read("conf/prompt.md"), "default v1\n")
        self.assertEqual(self.read("conf/application.yml"), "app: template\n")
        self.assertEqual(self.read("conf/mcp-clients.yml"), "mcp: template\n")
        self.assertEqual(self.read("conf/.hidden.md"), "hidden\n")
        self.assertEqual(self.read("conf/lang/zh-CN.json"), '{"a": 1}\n')
        self.assertEqual(self.read("conf/template/nested/file.txt"), "nested v1\n")
        self.assertEqual(self.read("skills/aftercalculate/trend-forecaster/scripts/run.py"), "# py\n")

    def test_second_sync_keeps_site_config_and_extras_and_refreshes_defaults(self):
        self.sync(self.conf, self.skills, self.data)
        write(self.data / "conf", {
            "application.yml": "app: site\n",
            "mcp-clients.yml": "mcp: site\n",
            "extra.md": "extra\n",
            "template/nested/extra.txt": "kept\n",
        })
        write(self.data / "skills", {
            "extra.txt": "x\n",
            "aftercalculate/trend-forecaster/SKILL.md": "site skill\n",
        })
        write(self.conf, {
            "prompt.md": "default v2\n",
            "new.md": "new\n",
            "template/nested/file.txt": "nested v2\n",
        })
        result = self.sync(self.conf, self.skills, self.data)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read("conf/application.yml"), "app: site\n")
        self.assertEqual(self.read("conf/mcp-clients.yml"), "mcp: site\n")
        self.assertEqual(self.read("conf/extra.md"), "extra\n")
        self.assertEqual(self.read("conf/prompt.md"), "default v2\n")
        self.assertEqual(self.read("conf/new.md"), "new\n")
        self.assertEqual(self.read("conf/template/nested/file.txt"), "nested v2\n")
        self.assertEqual(self.read("conf/template/nested/extra.txt"), "kept\n")
        self.assertEqual(self.read("skills/extra.txt"), "x\n")
        # Only conf's two site files are kept: skills defaults overwrite the same names.
        self.assertEqual(self.read("skills/aftercalculate/trend-forecaster/SKILL.md"), "skill v1\n")

    def test_bytes_odd_names_and_spaced_roots_survive(self):
        blob = b"\x00\xff#\r\nnot utf-8\x80"
        write(self.conf, {"binary/blob.dat": blob, "dir with space/café name.txt": "value\n"})
        write(self.skills, {"dir with space/café skill.md": "value\n"})
        result = self.sync(self.conf, self.skills, self.data)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.data / "conf/binary/blob.dat").read_bytes(), blob)
        self.assertEqual(self.read("conf/dir with space/café name.txt"), "value\n")
        self.assertEqual(self.read("skills/dir with space/café skill.md"), "value\n")

    def test_wrong_argument_count_exits_64_without_writing(self):
        for arguments in ([], [self.conf], [self.conf, self.skills], [self.conf, self.skills, self.data, "extra"]):
            result = self.sync(*arguments)
            self.assertEqual(result.returncode, 64, arguments)
            self.assertIn("usage: sync-product-files.py", result.stderr)
        self.assertFalse(self.data.exists())


if __name__ == "__main__":
    unittest.main()
