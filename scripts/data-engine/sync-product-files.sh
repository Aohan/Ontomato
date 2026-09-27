#!/bin/bash
# Product file sync into one data root, shared by the container entrypoint (/deploy) and the host dev
# entry (apps/data-engine/.dev): conf and skills defaults overwrite same names, add new files and keep
# extra files; application.yml and mcp-clients.yml are copied only when missing.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: sync-product-files.sh <conf-defaults-dir> <skills-dir> <data-root>" >&2
  exit 64
fi
conf_defaults=$1
app_skills=$2
conf_dir="$3/conf"
skills_dir="$3/skills"

mkdir -p "$conf_dir" "$skills_dir" "$3/logs" "$3/python"
shopt -s dotglob nullglob
for src in "$conf_defaults"/*; do
  name="${src##*/}"
  [ "$name" = "mcp-clients.yml" ] && [ -e "$conf_dir/mcp-clients.yml" ] && continue
  [ "$name" = "application.yml" ] && [ -e "$conf_dir/application.yml" ] && continue
  cp -a "$src" "$conf_dir/"
done
echo "[sync] conf synced -> ${conf_dir} (overwrite same names, add new files, keep extras; application.yml and mcp-clients.yml only added when missing)"
cp -a "$app_skills/." "$skills_dir/"
echo "[sync] skills synced -> ${skills_dir}"
