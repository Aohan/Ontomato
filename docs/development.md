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

`make` in the root directory runs `make build` by default, which builds the Node runtime,
the Node app, the Java data-engine and the Manager in that order. `make pack` exports five
image packs — Node runtime, Node app, Java runtime, Java app and Manager; `make pack-app`
exports only the three application packs — Node app, Java app and Manager.

| Command | Scope |
| --- | --- |
| `make build` | workbench-runtime → workbench-app → data-engine → ontology-manager |
| `make build-app` | workbench-app → data-engine-app → ontology-manager |
| `make pack` | workbench-runtime-pack → workbench-app-pack → pack-data-engine → pack-ontology-manager |
| `make pack-app` | workbench-app-pack → pack-data-engine-app → pack-ontology-manager |
| `make pack-amd64` / `pack-arm64` | run `pack` for the given architecture |
| `make pack-app-amd64` / `pack-app-arm64` | run `pack-app` for the given architecture |

`build-app` and `pack-app` do not rebuild the runtime and do not require a runtime image
to be present locally: the build script computes the compatibility fingerprint from the
source, compares it with `runtime-lock.json` and, on a mismatch, tells you to rebuild the
runtime first. `build-app` only builds images and exports no pack; a deployment machine
updates day to day with `git pull` → `make build-app` → `docker compose up -d` in the
deployment directory, and `pack-app` additionally exports the offline pack. The matching
check runs only once, during deployment assembly. The Manager still ships as its own
image; there is no manager runtime. The per-service targets (`workbench-runtime-pack`,
`workbench-app-pack`, `pack-data-engine`, `pack-data-engine-app`,
`pack-ontology-manager` and their architecture variants) can still be called on their
own.

The build host needs Node.js 24+, Git, GNU Make and Docker with the Buildx plugin; `ARCH`
defaults to the host architecture, and `PROMPT_LANG` only controls the Java prompt
language, which is `en` in this repository. Base images are
always written as the official `docker.io/library/…` addresses with pinned digests, and
pulls use each machine's own Docker mirror configuration; the build scripts do not pass
base-image environment variables through, so the Dockerfile defaults are the only source.
`DEBIAN_MIRROR`, `DEBIAN_SECURITY_MIRROR` and `PIP_INDEX_URL` keep environment-variable
overrides as machine-level settings. The pnpm version is likewise declared only in the
Dockerfile (currently 9.15.9, and the runtime install and the app build must agree); it
takes part in the compatibility fingerprint and does not accept an environment-variable
override. These 5 application artifacts do not contain PostgreSQL: the deployment flow
provides PostgreSQL separately; `make bundle` packs the images already built or imported
for one architecture, the `deploy/` templates and the assembly recipes into one offline
full bundle. There is currently no acceptance conclusion from real private Linux hardware
or a complete CI either, and a full-stack run on a real Windows machine is likewise
unverified. Windows packaging is out of scope for this change; images and the offline
packs continue to use the existing verified build environment.

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
and writes runtime data under the product root `data/`. The Ontology Manager's
`DATARAG_ORIGIN` has no default in this repository, so startup fails when it is not
configured and the DataRAG root address must be given in `.env` or the environment. The
Java data engine, PostgreSQL and the Python MCP are prepared separately; this entry point
starts only the three processes above and is not a full-stack start.

## Local development (Java data engine)

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
