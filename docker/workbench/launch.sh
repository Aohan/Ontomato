#!/bin/sh
# The single workbench launcher, owned by the app recipe. tsx comes from the
# app's own N2-bound node_modules (never the runtime hoist); the entry stays
# in /app so productRoot resolves to /app however the image is mounted.
set -eu
exec node /app/apps/workbench/node_modules/tsx/dist/cli.mjs /app/apps/workbench/src/index.ts
