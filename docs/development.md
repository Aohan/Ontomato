# Development and build

This page is for Ontomato developers: the repository layout, local development and image
builds. Deployment and usage are in the repository root [README](../README.md).

- `apps/`: application startup and assembly.
- `packages/`: the shared implementation and contracts.
- `deploy/`, `docker/`, `scripts/`: product deployment and the shared build tools.

The enterprise extension is maintained in a separate private repository. This repository
builds on its own, without enterprise source, a private license SDK or enterprise build
credentials.

## Product build entry points

`make build ARCH=amd64` (or `arm64`) builds three runnable images in order:
workbench, data engine, ontology manager. Each also has its own Make target. Docker
caches the dependency layers; application source is copied afterwards. No separate
runtime image, compatibility lock or deployment-time build is needed.

Local aliases are `ontomato:deploy-<arch>`, `datarag-opensource:deploy-<arch>` and
`ontomato-ontology-manager:deploy-<arch>`. Versioned tags include the source revision
and a dirty marker when any participating source tree has uncommitted changes.

The build host needs Node.js 24+, Git, Make and Docker with Buildx. `ARCH` defaults
to the host architecture. `PROMPT_LANG=en` selects the public Java prompts. Base
image digests and pnpm versions live in the Dockerfiles. `DEBIAN_MIRROR`,
`DEBIAN_SECURITY_MIRROR` and `PIP_INDEX_URL` remain host-level build settings.

CI publishes final images. Pushes to `develop` publish the `edge` version; formal
`v*` tags publish the stripped version plus `latest`. Pull requests run checks
without publishing (see `.github/workflows/pr-checks.yml`).
GitHub runners reuse the previous release's inline BuildKit
cache through `BUILD_CACHE_REF`; this keeps unchanged dependency layers on a fresh runner.
The enterprise GitLab runner uses its persistent local BuildKit cache.
 `make bundle ARCH=amd64 VERSION=<version> BOOTSTRAP=1`
exports published images with oc-mirror v2; later runs reuse `MIRROR_STATE` and omit
`BOOTSTRAP=1`. See [deployment](../deploy/README.md) for the offline workflow,
baseline recovery and state retention. `build` never publishes images.

## Local development (Node + main web app + Manager)

After `pnpm install`, one root command starts three processes:

- `pnpm dev`: concurrently runs the three scripts below in the foreground and forwards
  SIGINT/SIGTERM to the child processes;
- `pnpm dev:server`: the Node service (`tsx watch src/index.ts` in `apps/workbench`,
  default port 3000);
- `pnpm dev:web`: the main web app's Vite dev server (port 5173, `/api` and `/config.js`
  proxied to 3000);
- `pnpm dev:ontology-manager`: the Ontology Manager's Vite dev server (port 5174,
  `/api/data-query` proxied to `DATARAG_ORIGIN`).

Node 24+ and pnpm 9+ are required. Run `pnpm install`, then `pnpm dev`. Dependencies
always use exact versions, never `^` or `~` ranges; the root `.npmrc` sets
`save-exact=true`, so `pnpm add` writes exact versions.

The Node service reads the product root `.env` (the process environment takes priority)
and writes runtime data under the product root `data/`. The Ontology Manager proxies to
`DATARAG_ORIGIN` from the environment or `.env`, otherwise to `DATA_QUERY_BASE_URL`, so by
default it reaches the same DataRAG as the Node service; with neither set, startup fails. The
Java data engine, PostgreSQL and the Python MCP are prepared separately; this entry point
starts only the three processes above and is not a full-stack start.

## Local development (Java data engine)

Instance graph browsing queries PostgreSQL on demand. Startup does not scan business
tables or build an in-memory instance graph. Overview counts instances per `inStarChart`
object type, then reads at most 500 records in total, allocated proportionally using
largest remainders (ties use class name order). If the total is at most 500, all records
are shown; very small classes may receive no overview nodes and remain searchable.
Overview reads at most 2,000 connections between sampled records; search
returns up to 50 matches, and neighborhood expansion returns 100 connections per page.
Queries are read-only, have a 10-second statement timeout and share a four-request
concurrency limit. Overview refresh recounts instances; these counts are also cached
for the statistics endpoint for 60 seconds;
full connection counts and connectivity statistics are not calculated during browsing.
Refresh reads current data; the legacy star-chart generation endpoint remains an
explicit operation for its existing callers. Stable ordering makes pages reproducible
for unchanged data, but concurrent source edits can change offset-based page boundaries.

`node apps/data-engine/dev.mjs [extra Maven arguments]`: runs the platform's official
Maven wrapper (`./mvnw` on POSIX, `mvnw.cmd` on Windows) in the foreground from this
repository's reactor root with
`-B -ntp -DskipTests -pl apps/data-engine -am spring-boot:run`, which runs the current
working-tree source and needs no `mvn install`. Extra arguments are passed through to
Maven unchanged (for example `-o`).

- The start script prepares `apps/data-engine/.dev` (`conf`, `skills`, `logs`, `python`;
  the JVM working directory, with `conf` first on the classpath) from the build entry's
  resources and language. The sync rules match the container's: same-name files are
  overwritten, new ones are added, extra ones are kept, and `application.yml` and
  `mcp-clients.yml` are copied only when missing. The prompt language is `en`; this
  repository accepts only `PROMPT_LANG=en`.
- Prepare `apps/data-engine/.env` yourself first (the Java `POSTGRE_*`, `BACKEND_*` and so
  on, filled in the host's own terms; it is read literally as one `KEY=value` per line and
  overrides inherited environment variables of the same name), and a missing file is
  reported before Maven starts. The Python virtual environment `apps/data-engine/.venv`
  needs no manual preparation: on startup, if it is missing it is created automatically
  with the local `python3` (`py -3` on Windows, Python 3.10+ required) and
  `packages/data-engine-core/requirements-py310.txt` is installed; it is reinstalled when
  that list changes and reused otherwise.
- This entry point starts only the JVM: PostgreSQL and the Python MCP (`mcp-clients.yml`
  default `127.0.0.1:18500`) must be ready separately; it is not a full-stack start.
  Foreground signals follow the same rules as the full-stack entry: on Unix, SIGINT/SIGTERM
  are forwarded to the Maven wrapper; on Windows, Node's `kill` is a forced termination,
  so it instead waits for the child processes of the same console to settle on their own.
  A real Windows machine is unverified and is not reported as passing.

## Unified full-stack development entry point

`pnpm dev:up` / `pnpm dev:down` / `pnpm dev:status` / `pnpm dev:logs` start the whole
stack in the order PG → local Python MCP → Java ready → the three foreground Node
processes; the MCP and Java are separate background process groups, and their logs are
appended to `apps/data-engine/.dev/logs/dev-mcp.log` and `dev-backend.log`. The entry
point uses only Node and tools the system already ships (on Windows it uses the built-in
PowerShell/CIM and needs no Bash, tail or extra dependency), so it runs directly in
PowerShell.

- `dev:up`: first checks the ports, `apps/data-engine/.env` and
  `dev/postgres.compose.yml`, prepares the Python virtual environment as needed and then
  starts Compose. Only the three Node processes run in the foreground (with an explicit
  `PORT=3000`), and Ctrl-C stops only this group; when PG/MCP/Java are already up it reuses
  this checkout, and when a port is taken by another process it reports the error and exits
  without stopping others.
- `dev:down`: identifies and stops the frontend (including concurrently/tsx/Vite subtrees
  left behind after a parent exits), the Java entry point and any leftover Maven/RAGMain,
  and the MCP by this checkout's actual commands and entry points, re-confirming the start
  identity of the same PID before stopping; finally `docker compose down` without `-v`, so
  volumes are kept.
- `dev:status` reports only this checkout's ownership and external port usage, and
  `dev:logs` follows the end of `dev-backend.log`. When Docker is not running it says to
  start Docker Desktop or dockerd and then exits, without opening a GUI.

Windows and POSIX share the same Node orchestration. Both of the new `pnpm dev:*` entry
points have been verified on macOS for actually starting, surviving Ctrl-C in the
background, reusing the background on restart, and stopping this group on down while
keeping the database volume. The verification used an isolated test configuration and
does not mean real business behavior or the real license has passed. Windows full-stack
start/stop, paths with spaces or non-ASCII characters, and multiple-worktree isolation
are still to be verified on a real machine.

Checkout identity: the Compose project name and volume names are derived from the product
root's realpath (`<basename>-dev-<hash8>`), and services and volumes carry the
`dev.stack.root` and `dev.stack.product` labels; different worktrees use different
projects and volumes even with the same basename. After the directory moves, old volumes
can be traced with `docker volume ls --filter label=dev.stack.product=<name>`; existing
volumes are not migrated, backfilled or deleted automatically, and the database-creation
SQL runs only on the first initialization of an empty volume.

Prepare the local configuration (each is only a `cp` of the example): the root `.env`,
`apps/data-engine/.env`, and, when needed, the local MCP entry created from the synced
`apps/data-engine/.dev/conf/mcp-clients.yml` — it must be the only
`http://127.0.0.1:<port>/sse`, and remote entries may be kept alongside it.

Ports: Node 3000, the main web app 5173 and the Manager 5174 are fixed; PG uses `DB_PORT`
(default 5432), Java uses `SERVER_PORT` from `apps/data-engine/.env` (default 18087), and
the MCP uses the local port in `mcp-clients.yml` (template 18500). When a port is taken by
another process, `up` reports the error and exits without stopping other processes. Each
product root needs one install in its own root, so one `pnpm install` in the enterprise
assembly root already includes the adjacent public repository.
