#!/bin/sh
# The single workbench launcher, owned by the app recipe. tsx comes from the
# app's own N2-bound node_modules (never the runtime hoist); the entry stays
# in /app so productRoot resolves to /app however the image is mounted.
# Product Python defaults ship here with the small package; they apply only when
# unset, so an explicitly set value (including an empty string, which lets the
# consumer fall through to the next variable) keeps winning.
set -eu
: "${ABC_REPLAY_PYTHON_COMMAND=python3.10}"
: "${HOT_REPORT_PYTHON_COMMAND=python3.10}"
export ABC_REPLAY_PYTHON_COMMAND HOT_REPORT_PYTHON_COMMAND
exec node /app/apps/workbench/node_modules/tsx/dist/cli.mjs /app/apps/workbench/src/index.ts
