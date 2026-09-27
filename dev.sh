#!/bin/bash
# 产品根整栈开发入口：PG → 本机 MCP → Java 就绪 → 前台 Node 三进程。
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$root/scripts/dev-stack.mjs" "$root" "$@"
