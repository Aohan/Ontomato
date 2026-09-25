#!/bin/sh
# Pairing preflight: the read-only application image mounted at /app must have
# been built for this runtime (same compatibility fingerprint). The app image
# itself is architecture-independent, so only the runtime architecture is
# compared against the actual process architecture. Mismatches stop the
# container instead of running against the wrong dependency set.
set -eu

if [ ! -f /app/.image-meta.json ]; then
  echo "[entrypoint] no application image mounted at /app (missing /app/.image-meta.json)" >&2
  exit 1
fi

if [ ! -f /runtime/.image-meta.json ]; then
  echo "[entrypoint] runtime metadata missing: /runtime/.image-meta.json" >&2
  exit 1
fi

node /runtime/scripts/workbench/runtime-contract.mjs pair

exec "$@"
