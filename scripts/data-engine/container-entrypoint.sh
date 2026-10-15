#!/bin/bash
# DataRAG container entrypoint, shipped in the final image at /app/bin and set as
# its ENTRYPOINT. Responsibilities: data directory preparation, product file
# synchronization, built-in MCP startup, process supervision.
set -euo pipefail

APP_ROOT=/app
APP_LIB="$APP_ROOT/lib"
CONF_DEFAULTS="$APP_ROOT/conf-defaults"
APP_SKILLS="$APP_ROOT/skills"
RUNTIME_LIB=/opt/datarag/lib
DEPLOY_DIR=/deploy
CONF_DIR="$DEPLOY_DIR/conf"
MCP_HOST=127.0.0.1
MCP_PORT=18500

die() { echo "[entrypoint] $*" >&2; exit 78; }

# 1) The image content must be complete
[ -d "$APP_ROOT" ] || die "missing application directory $APP_ROOT"
ls "$APP_LIB"/*.jar >/dev/null 2>&1 || die "no application jar under $APP_LIB"
[ -d "$APP_SKILLS" ] || die "$APP_SKILLS is missing, the data-engine image is incomplete"

# 2) Data directory and product file sync: all of /deploy is mounted from a single host directory
#      (created on first start); the shared sync script owns the sync rule.
[ -d "$CONF_DEFAULTS" ] || die "$CONF_DEFAULTS is missing, the data-engine image is incomplete"
python "$(dirname "$0")/sync-product-files.py" "$CONF_DEFAULTS" "$APP_SKILLS" "$DEPLOY_DIR"

# 3) The MCP calculation service runs built into the backend container (started first, polled for up to 30 seconds)
[ -f /app/mcp/mcpserver.py ] || die "missing /app/mcp/mcpserver.py, the data-engine image is incomplete"
/usr/local/bin/python3 /app/mcp/mcpserver.py --host "$MCP_HOST" --port "$MCP_PORT" &
mcp_pid=$!
mcp_ok=0
for _ in $(seq 1 30); do
  if (echo > "/dev/tcp/$MCP_HOST/$MCP_PORT") 2>/dev/null; then mcp_ok=1; break; fi
  kill -0 "$mcp_pid" 2>/dev/null || die "the MCP process has exited and ${MCP_PORT} is not ready; not starting Java"
  sleep 1
done
[ "$mcp_ok" = 1 ] || { kill "$mcp_pid" 2>/dev/null || true; die "MCP was not ready on ${MCP_PORT} within 30 seconds; not starting Java"; }
echo "[entrypoint] MCP ready ${MCP_HOST}:${MCP_PORT} (pid ${mcp_pid})"

echo "[entrypoint] datarag starting"
"$JAVA_HOME/bin/java" \
  -Djava.awt.headless=true \
  -Dfile.encoding=UTF-8 \
  "$@" \
  -classpath "$CONF_DIR:$APP_LIB/*:$RUNTIME_LIB/*" \
  io.ontomato.dataengine.RAGMain &
java_pid=$!

# 4) Process supervision: if either process exits the container exits (non-zero), and compose restart brings it back up
trap 'kill "$mcp_pid" "$java_pid" 2>/dev/null || true' TERM INT
if wait -n "$mcp_pid" "$java_pid"; then rc=0; else rc=$?; fi
echo "[entrypoint] a supervised process exited (rc=$rc), so the container exits as well" >&2
kill "$mcp_pid" "$java_pid" 2>/dev/null || true
wait 2>/dev/null || true
[ "$rc" -ne 0 ] || rc=1
exit "$rc"
