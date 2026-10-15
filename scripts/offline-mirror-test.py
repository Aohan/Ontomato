import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).resolve().parents[1] / "deploy/offline/mirror.py")
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "imageset.yaml").write_text("{}")
        (self.bundle / "mirror_000001.tar").write_bytes(b"oc-mirror fixture")
        self.data = {"schema": 1, "version": "4.0.1", "arch": "arm64",
                     "tool": mirror.TOOL_IMAGE + "-arm64", "registry": "ontomato-offline-registry:3.1.2-arm64",
                     "images": {key: "example.com/product/" + key.lower() + "@sha256:" + "a" * 64 for key in mirror.IMAGE_KEYS},
                     "files": {p.name: {"bytes": p.stat().st_size, "sha256": mirror.sha256(p)} for p in self.bundle.iterdir()}}
        self.write_manifest()

    def write_manifest(self):
        (self.bundle / "delivery.json").write_text(json.dumps(self.data))

    def test_corrupt_archive_fails_before_docker(self):
        (self.bundle / "mirror_000001.tar").write_bytes(b"corrupt")
        with patch.object(mirror, "run") as run, self.assertRaisesRegex(ValueError, "checksum"):
            mirror.import_bundle(SimpleNamespace(bundle=self.bundle, state=self.root / "state"))
        run.assert_not_called()

    def test_paths_cannot_escape_delivery(self):
        self.data["files"]["../secret"] = {"bytes": 0, "sha256": ""}
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            mirror.verify_bundle(self.bundle)

    def test_failed_import_preserves_active_references(self):
        target = self.root / "images.env"
        target.write_text("WORKBENCH_IMAGE=previous\n")
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5000,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "mirror", side_effect=ValueError("missing baseline")):
            with self.assertRaisesRegex(ValueError, "baseline"):
                mirror.import_bundle(args)
        self.assertEqual(target.read_text(), "WORKBENCH_IMAGE=previous\n")
        self.assertFalse((self.root / "state/imports").exists())

    def test_successful_import_outputs_digests_and_keeps_history(self):
        state = self.root / "state"
        history = state / "incoming/working-dir/.history"
        history.mkdir(parents=True)
        (history / "previous").write_text("keep")
        (state / "incoming/mirror_999999.tar").write_text("old")
        target = self.root / "images.env"
        args = SimpleNamespace(bundle=self.bundle, state=state, port=5100,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "mirror") as invoke:
            mirror.import_bundle(args)
        self.assertEqual((history / "previous").read_text(), "keep")
        self.assertEqual(len(list((state / "imports").glob("*.json"))), 1)
        self.assertFalse((state / "incoming/mirror_999999.tar").exists())
        self.assertIn("WORKBENCH_IMAGE=127.0.0.1:5100/product/workbench_image@sha256:" + "a" * 64, target.read_text())
        self.assertIn("docker://registry:5000", invoke.call_args[0][2])

    def test_source_repository_preserves_ports_and_nested_paths(self):
        self.assertEqual(mirror.repository("localhost:5000/a/b:v1"), "localhost:5000/a/b")
        self.assertEqual(mirror.repository("example.com/a/b@sha256:" + "a" * 64), "example.com/a/b")
        with self.assertRaisesRegex(ValueError, "fully qualified"):
            mirror.repository("pgvector/pgvector:pg18")


if __name__ == "__main__":
    unittest.main()
