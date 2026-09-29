#!/bin/sh
# Runtime container entrypoint: verifies application content is mounted at /app.
set -eu

if [ ! -f /app/.image-meta.json ]; then
  echo "[entrypoint] no application image mounted at /app (missing /app/.image-meta.json)" >&2
  exit 1
fi

if [ ! -f /runtime/.image-meta.json ]; then
  echo "[entrypoint] runtime metadata missing: /runtime/.image-meta.json" >&2
  exit 1
fi
exec "$@"
