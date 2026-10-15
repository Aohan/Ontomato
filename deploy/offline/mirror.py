#!/usr/bin/env python3
"""Copy oc-mirror archives; oc-mirror owns blob selection, history and import."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL_VERSION = "4.22.17"
TOOL_IMAGE = "ontomato-oc-mirror:" + TOOL_VERSION
REGISTRY_IMAGE = "registry@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8"
TOOL_SHA = {
    "amd64": "2a2e3a3be56a5a44fca7c1e9249e7ed32a9dbf04c67225281c232b1cc31afe42",
    "arm64": "1d1c755a7581e6bfbeab0198c6ad4349f2761918d53a88523e105e7362c14e5e",
}
IMAGE_KEYS = ("WORKBENCH_IMAGE", "DATA_ENGINE_IMAGE", "MANAGER_IMAGE", "POSTGRES_IMAGE")


def run(argv, capture=False, **kwargs):
    result = subprocess.run([str(x) for x in argv], check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, **kwargs)
    return result.stdout.strip() if capture else None


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def repository(ref):
    # Fully qualified source names make destination paths unambiguous.
    first, sep, rest = ref.partition("/")
    if not sep or not ("." in first or ":" in first or first == "localhost"):
        raise ValueError("Use a fully qualified image reference: " + ref)
    path = rest.split("@", 1)[0]
    if ":" in path:
        path = path.rsplit(":", 1)[0]
    return first + "/" + path


def resolve_image(ref, arch, component=None, version=None, enterprise=False):
    raw = subprocess.check_output(["docker", "buildx", "imagetools", "inspect", ref, "--raw"])
    manifest = json.loads(raw)
    if "manifests" in manifest:
        matches = [m for m in manifest["manifests"] if m.get("platform", {}).get("architecture") == arch
                   and m.get("platform", {}).get("os") == "linux"]
        if len(matches) != 1:
            raise ValueError("Expected one linux/" + arch + " manifest in " + ref)
        digest = matches[0]["digest"]
    else:
        # imagetools adds no formatting to --raw; hash the original bytes, including newlines.
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
    resolved = repository(ref) + "@" + digest
    run(["docker", "pull", "--platform", "linux/" + arch, resolved])
    image = json.loads(run(["docker", "image", "inspect", resolved], capture=True))[0]
    if image["Os"] != "linux" or image["Architecture"] != arch:
        raise ValueError("Wrong image platform: " + resolved)
    if component:
        labels = image.get("Config", {}).get("Labels") or {}
        if labels.get("io.ontomato.component") != component or labels.get("org.opencontainers.image.version") != version:
            raise ValueError("Wrong component/version: " + resolved)
        if enterprise and component == "datarag" and labels.get("io.example.license.mode") != "real":
            raise ValueError("Enterprise delivery requires real license mode")
    return resolved


def ensure_tool(state, arch):
    tag = TOOL_IMAGE + "-" + arch
    exists = subprocess.run(["docker", "image", "inspect", tag], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        return tag
    context = state / "tool"
    downloads = context / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / ("oc-mirror-" + arch + ".tar.gz")
    if not archive.exists() or sha256(archive) != TOOL_SHA[arch]:
        segment = "aarch64/" if arch == "arm64" else ""
        url = "https://mirror.openshift.com/pub/openshift-v4/" + segment + "clients/ocp/" + TOOL_VERSION + "/oc-mirror.rhel9.tar.gz"
        print("Downloading " + url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as source, archive.open("wb") as target:
            shutil.copyfileobj(source, target)
        if sha256(archive) != TOOL_SHA[arch]:
            raise ValueError("oc-mirror download checksum mismatch")
    shutil.copyfile(HERE / "Dockerfile", context / "Dockerfile")
    run(["docker", "buildx", "build", "--platform", "linux/" + arch, "--provenance=false", "--load", "-t", tag, context])
    return tag


def mirror(tool, state, args, network=None, authfile=None):
    command = ["docker", "run", "--rm", "--pull=never", "-v", str(state) + ":/work"]
    if network:
        command += ["--network", network]
    if authfile:
        command += ["-v", str(Path(authfile).resolve()) + ":/auth.json:ro"]
        args = ["--authfile", "/auth.json"] + args
    run(command + [tool, "--cache-dir", "/work/cache", "--remove-signatures"] + args)


def save_bootstrap(tool, target, arch):
    registry_ref = resolve_image("docker.io/library/" + REGISTRY_IMAGE, arch)
    # A tag survives docker save/load; digest-only references do not on every engine.
    registry_tag = "ontomato-offline-registry:3.1.2-" + arch
    run(["docker", "tag", registry_ref, registry_tag])
    import gzip
    with gzip.open(target, "wb", compresslevel=1) as out:
        child = subprocess.Popen(["docker", "save", tool, registry_tag], stdout=subprocess.PIPE)
        try:
            shutil.copyfileobj(child.stdout, out)
        finally:
            child.stdout.close()
        if child.wait() != 0:
            raise ValueError("docker save bootstrap failed")
    return registry_tag


def export(args):
    state, output = Path(args.state).resolve(), Path(args.output).resolve()
    if output.exists():
        raise ValueError("Output already exists; choose a new delivery directory: " + str(output))
    if state == output or state in output.parents or output in state.parents:
        raise ValueError("Delivery output and persistent state must be separate directories")
    state.mkdir(parents=True, exist_ok=True)
    components = ("data-agent", "datarag", "ontology-manager") if args.edition == "enterprise" else ("ontomato", "datarag-opensource", "ontomato-ontology-manager")
    inputs = (args.workbench, args.data_engine, args.manager, args.postgres)
    sources = {key: resolve_image(ref, args.arch, components[i] if i < 3 else None,
                                  args.version, args.edition == "enterprise")
               for i, (key, ref) in enumerate(zip(IMAGE_KEYS, inputs))}
    # This oc-mirror version needs a destination tag even for digest sources.
    # A digest-derived tag pins the pull and remains stable across exports.
    # JSON is a YAML subset; no YAML dependency is required at the site.
    config = {"apiVersion": "mirror.openshift.io/v2alpha1", "kind": "ImageSetConfiguration",
              "mirror": {"additionalImages": [
                  {"name": repository(ref) + ":mirror-" + ref.split("@sha256:")[1] + "@" + ref.split("@")[1]}
                  for ref in dict.fromkeys(sources.values())]}}
    (state / "imageset.yaml").write_text(json.dumps(config, indent=2) + "\n")
    tool = ensure_tool(state, args.arch)
    registry_tag = "ontomato-offline-registry:3.1.2-" + args.arch
    if args.bootstrap:
        registry_tag = save_bootstrap(tool, state / "bootstrap.tar.gz", args.arch)
    flags = ["-c", "/work/imageset.yaml"]
    if args.insecure_source:
        flags += ["--src-tls-verify=false"]
    mirror(tool, state, flags + ["file:///work/export"], args.network, args.authfile)
    archives = sorted((state / "export").glob("mirror_*.tar"))
    if not archives:
        raise ValueError("oc-mirror produced no archive; no delivery was created")
    output.mkdir(parents=True)
    for archive in archives:
        shutil.copyfile(archive, output / archive.name)
    shutil.copyfile(state / "imageset.yaml", output / "imageset.yaml")
    if args.bootstrap:
        shutil.copyfile(state / "bootstrap.tar.gz", output / "bootstrap.tar.gz")
    files = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in sorted(output.iterdir())}
    metadata = {"schema": 1, "version": args.version, "arch": args.arch, "images": sources,
                "tool": tool, "registry": registry_tag, "files": files}
    (output / "delivery.json").write_text(json.dumps(metadata, indent=2) + "\n")
    size = sum(item["bytes"] for name, item in files.items() if name.startswith("mirror_"))
    print("DELIVERY=" + str(output) + "\nARCHIVE_BYTES=" + str(size), flush=True)


def verify_bundle(bundle):
    data = json.loads((bundle / "delivery.json").read_text())
    if data.get("schema") != 1 or data.get("arch") not in TOOL_SHA or set(data.get("images", {})) != set(IMAGE_KEYS):
        raise ValueError("Invalid delivery metadata")
    expected_tool = TOOL_IMAGE + "-" + data["arch"]
    expected_registry = "ontomato-offline-registry:3.1.2-" + data["arch"]
    if data.get("tool") != expected_tool or data.get("registry") != expected_registry:
        raise ValueError("This tool version does not match the delivery; use its bundled offline/ directory")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+-]*", data.get("version", "")):
        raise ValueError("Invalid delivery version")
    files = data["files"]
    if "imageset.yaml" not in files or not any(re.fullmatch(r"mirror_\d+\.tar", name) for name in files):
        raise ValueError("Delivery has no image set or mirror archive")
    for name, record in files.items():
        if Path(name).name != name or name not in ("imageset.yaml", "bootstrap.tar.gz") and not re.fullmatch(r"mirror_\d+\.tar", name):
            raise ValueError("Unexpected delivery file: " + name)
        path = bundle / name
        if path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("Delivery checksum mismatch: " + name)
    for ref in data["images"].values():
        repository(ref)
        if not re.fullmatch(r"[a-zA-Z0-9./_:-]+@sha256:[a-f0-9]{64}", ref):
            raise ValueError("Delivery images must use immutable digests")
    return data


def import_bundle(args):
    bundle, state = Path(args.bundle).resolve(), Path(args.state).resolve()
    data = verify_bundle(bundle)
    state.mkdir(parents=True, exist_ok=True)
    if "bootstrap.tar.gz" in data["files"]:
        run(["docker", "load", "-i", bundle / "bootstrap.tar.gz"])
    for image in (data["tool"], data["registry"]):
        run(["docker", "image", "inspect", image], capture=True)
    env = dict(os.environ, MIRROR_STATE=str(state), MIRROR_PORT=str(args.port), MIRROR_REGISTRY_IMAGE=data["registry"])
    run(["docker", "compose", "-p", args.project, "-f", HERE / "compose.yml", "up", "-d"], env=env)
    # Keep import history beside the cache. Only incoming archives change each time.
    incoming = state / "incoming"
    incoming.mkdir(exist_ok=True)
    for old in incoming.glob("mirror_*.tar"):
        old.unlink()
    for name in data["files"]:
        if name == "imageset.yaml" or name.startswith("mirror_"):
            shutil.copyfile(bundle / name, incoming / name)
    mirror(data["tool"], state, ["-c", "/work/incoming/imageset.yaml", "--from", "file:///work/incoming",
                               "--dest-tls-verify=false", "docker://registry:5000"], args.project + "_mirror")
    # Receipts record successful Registry imports only, not application upgrades.
    receipts = state / "imports"
    receipts.mkdir(exist_ok=True)
    shutil.copyfile(bundle / "delivery.json", receipts / (sha256(bundle / "delivery.json") + ".json"))
    # A failed import never changes the active deployment's image references.
    lines = ["ARCH=" + data["arch"], "ONTOMATO_VERSION=" + data["version"]]
    for key in IMAGE_KEYS:
        path = data["images"][key].split("/", 1)[1]
        lines.append(key + "=127.0.0.1:" + str(args.port) + "/" + path)
    target = Path(args.output_env).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.replace(target)
    print("IMAGES_ENV=" + str(target), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    exp = commands.add_parser("export", help="Export published final images; retain --state between versions")
    for name in ("state", "output", "version", "workbench", "data-engine", "manager"):
        exp.add_argument("--" + name, required=True)
    exp.add_argument("--arch", choices=tuple(TOOL_SHA), required=True)
    exp.add_argument("--edition", choices=("public", "enterprise"), required=True)
    exp.add_argument("--postgres", default="docker.io/pgvector/pgvector:pg18")
    exp.add_argument("--bootstrap", action="store_true", help="Include Registry and oc-mirror images for a first installation")
    exp.add_argument("--authfile", help="Container auth JSON with inline credentials; never copied to a delivery")
    exp.add_argument("--network", help="Docker network for the exporter")
    exp.add_argument("--insecure-source", action="store_true")
    imp = commands.add_parser("import", help="Import a delivery to the persistent local Registry")
    for name in ("bundle", "state", "output-env"):
        imp.add_argument("--" + name, required=True)
    imp.add_argument("--port", type=int, default=5000)
    imp.add_argument("--project", default="ontomato-offline")
    args = parser.parse_args()
    try:
        if args.command == "export":
            export(args)
        else:
            if not 1 <= args.port <= 65535:
                raise ValueError("Registry port must be 1..65535")
            import_bundle(args)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, "mirror: " + str(error) + "\n")


if __name__ == "__main__":
    main()
