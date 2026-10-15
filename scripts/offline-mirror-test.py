import importlib.util
import hashlib
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

    def test_resolve_selects_platform_digest_without_product_policy(self):
        digest = "sha256:" + "b" * 64
        manifest = {"manifests": [
            {"platform": {"os": "linux", "architecture": "amd64"}, "digest": "sha256:" + "a" * 64},
            {"platform": {"os": "linux", "architecture": "arm64"}, "digest": digest},
        ]}
        image = {"Os": "linux", "Architecture": "arm64"}
        with patch.object(mirror.subprocess, "check_output", return_value=json.dumps(manifest).encode()), \
                patch.object(mirror, "run", side_effect=["pull output", json.dumps([image])]) as run:
            ref = mirror.resolve_image("example.com/arbitrary/image:mutable", "arm64")
        self.assertEqual(ref, "example.com/arbitrary/image@" + digest)
        self.assertEqual(run.call_args_list[0].args[0], ["docker", "pull", "--platform", "linux/arm64", ref])

    def test_resolve_single_manifest_hashes_exact_bytes(self):
        raw = b'{"schemaVersion":2}\n'
        image = {"Os": "linux", "Architecture": "arm64"}
        with patch.object(mirror.subprocess, "check_output", return_value=raw), \
                patch.object(mirror, "run", side_effect=["", json.dumps([image])]):
            ref = mirror.resolve_image("example.com/a:tag", "arm64")
        self.assertEqual(ref, "example.com/a@sha256:" + hashlib.sha256(raw).hexdigest())

    def test_resolve_rejects_wrong_platform(self):
        with patch.object(mirror.subprocess, "check_output", return_value=b'{"schemaVersion":2}'), \
                patch.object(mirror, "run", side_effect=["", json.dumps([{"Os": "linux", "Architecture": "amd64"}])]):
            with self.assertRaisesRegex(ValueError, "platform"):
                mirror.resolve_image("example.com/a:tag", "arm64")

    def export_args(self):
        refs = list(self.data["images"].values())
        return SimpleNamespace(state=self.root / "state", output=self.root / "exported", arch="arm64",
                               version="4.0.1", workbench=refs[0], data_engine=refs[1], manager=refs[2],
                               postgres=refs[3], bootstrap=False, insecure_source=False, network=None, authfile=None)

    def test_export_rejects_mutable_tag_before_creating_state(self):
        args = self.export_args()
        args.workbench = "example.com/a:mutable"
        with patch.object(mirror, "ensure_tool") as tool, self.assertRaisesRegex(ValueError, "immutable"):
            mirror.export(args)
        tool.assert_not_called()
        self.assertFalse(args.state.exists())

    def test_export_preserves_validated_pins_without_resolving_again(self):
        args = self.export_args()
        def write_archive(*_):
            (args.state / "export").mkdir()
            (args.state / "export/mirror_000001.tar").write_bytes(b"archive")
        with patch.object(mirror, "resolve_image") as resolve, \
                patch.object(mirror, "ensure_tool", return_value=self.data["tool"]), \
                patch.object(mirror, "mirror", side_effect=write_archive):
            mirror.export(args)
        resolve.assert_not_called()
        data = mirror.verify_bundle(args.output)
        self.assertEqual(data["images"], self.data["images"])
        names = [item["name"] for item in json.loads((args.output / "imageset.yaml").read_text())["mirror"]["additionalImages"]]
        self.assertEqual(len(names), 4)
        self.assertTrue(all(name.endswith("@sha256:" + "a" * 64) for name in names))


if __name__ == "__main__":
    unittest.main()
