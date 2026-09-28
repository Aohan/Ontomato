"""Product file sync into one data root, shared by the container entrypoint (/deploy) and the host
dev entry (apps/data-engine/.dev): conf and skills defaults overwrite same names, add new files and
keep extra files; application.yml and mcp-clients.yml are copied only when missing. Standard library
only: Python is already a required runtime on both chains, and this replaces the former shell copy so
host development needs no bash."""
import shutil
import sys
from pathlib import Path

SITE_CONFIG = ("application.yml", "mcp-clients.yml")


# One entry into the already existing directory: a nested directory merges (same names overwritten,
# extra files kept), a plain file is overwritten in place.
def copy_into(source, destination):
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True)
    else:
        shutil.copy2(source, destination)


def sync(conf_defaults, app_skills, data_root):
    conf_dir = data_root / "conf"
    skills_dir = data_root / "skills"
    for directory in (conf_dir, skills_dir, data_root / "logs", data_root / "python"):
        directory.mkdir(parents=True, exist_ok=True)
    for source in conf_defaults.iterdir():
        if source.name in SITE_CONFIG and (conf_dir / source.name).exists():
            continue
        copy_into(source, conf_dir / source.name)
    print(
        f"[sync] conf synced -> {conf_dir} (overwrite same names, add new files, keep extras; "
        "application.yml and mcp-clients.yml only added when missing)"
    )
    for source in app_skills.iterdir():
        copy_into(source, skills_dir / source.name)
    print(f"[sync] skills synced -> {skills_dir}")


def main(argv):
    if len(argv) != 3:
        print("usage: sync-product-files.py <conf-defaults-dir> <skills-dir> <data-root>", file=sys.stderr)
        return 64
    sync(Path(argv[0]), Path(argv[1]), Path(argv[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
