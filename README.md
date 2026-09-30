# Ontomato

Give your AI a model of your business, then ask it real questions.

Ontomato answers natural-language questions over your business database. It grounds
every query in an **ontomap**: your tables, columns and relationships described in
business terms. Each answer traces back to the source records it came from.

## For AI agents

This README is written so that a coding agent (Claude Code, Codex, WorkBuddy, or any
agent that can run shell commands) can set Ontomato up end to end. If you are that
agent:

1. Follow [Deploy](#1-deploy). Ask the user for the chat model and embedding model
   endpoints and keys; do not invent them.
2. Follow [Install the agent skills](#2-install-the-agent-skills) right after the stack
   is healthy, then load the skills. If your agent does not pick up new skills in the
   running session, read each copied `SKILL.md` and follow it directly.
3. Use the `ontomato-ontomap-builder` skill to connect the user's database and build
   the ontomap, as in [Connect your data](#3-connect-your-data-and-ask).

## Quick start

### 1. Deploy

Deployment needs Docker Engine 26+ with the Compose plugin, an OpenAI-compatible chat model
endpoint, and an embedding model endpoint.

The stack is delivered as an offline bundle: the images are built on a build host and
carried to the server inside the bundle, which the server then loads. The build host needs
Node.js 24+, Git, GNU Make and Docker with the Buildx plugin:

```bash
git clone https://github.com/Aohan/Ontomato.git
cd Ontomato
make build ARCH=amd64
docker pull --platform linux/amd64 pgvector/pgvector:pg18
make bundle ARCH=amd64   # or arm64
```

`make build` builds Ontomato's images and does not fetch PostgreSQL. Pull the
PostgreSQL image for the same architecture (`--platform linux/arm64` for arm64), or import
a matching image with `docker load -i`; `make bundle` fails on a missing image or an image
of the wrong architecture.

Copy the unpacked bundle directory to the server, load the images and start the stack:

```bash
for f in images/*.tar.gz; do docker load -i "$f"; done
cp .env.example .env
# edit .env, then:
docker compose up -d
```

The bundle holds `docker-compose.yml`, `.env.example`, `initdb.sql`, the assembly recipes
under `assemble/` and one `images/*.tar.gz` per image.
[deploy/README.md](deploy/README.md) describes the bundle and the on-site steps.

Set these values in `.env`; the other entries have working defaults and are
described in the comments of `.env.example`.

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | letters, digits, `.`, `_` and `-` only |
| `BACKEND_LLM_BASE_URL`, `BACKEND_LLM_API_KEY`, `BACKEND_LLM_MODEL` | the chat model |
| `BACKEND_EMBEDDING_BASE_URL`, `BACKEND_EMBEDDING_API_KEY`, `BACKEND_EMBEDDING_MODEL`, `BACKEND_EMBEDDING_DIMENSIONS` | the embedding model; the dimensions must match the model's output |
| `PUBLIC_HOST` | the address the browser uses to reach this server, an IP or a hostname |

When `docker compose ps` shows every service healthy, these ports are open:

| Port | Service |
| --- | --- |
| 3000 | Ontomato web app and API |
| 3005 | Ontology Manager |
| 18087 | Data engine |
| 5432 | PostgreSQL |

PostgreSQL is published on the server's loopback address only, so it is not reachable from
outside the server.

### 2. Install the agent skills

Three skills are in [agent-skills](agent-skills). They need Node.js 18+.

| Skill | Use it to |
| --- | --- |
| `ontomato-ontomap-builder` | connect Ontomato to a database, write and import the ontomap, and check it with questions |
| `ontomato-analyst` | read the ontomap, run DSL queries and natural-language questions, and reach the analysis agents |
| `ontomato-app-builder` | on a separate test deployment: import the production ontomap, load test data, build and debug MetricViews, Actions and the pages that call them |

Copy the skill directories into your agent's skills directory. From the repository
root:

```bash
# Claude Code
mkdir -p .claude/skills && cp -R agent-skills/* .claude/skills/
# Codex
mkdir -p .agents/skills && cp -R agent-skills/* .agents/skills/
```

| Agent | Project skills directory | User skills directory |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| WorkBuddy | — | `~/.workbuddy/skills/`, or `workbuddy skills add <dir>` |

Then set `envUrl` in each copied `application.yml` to the web app address, such as
`http://localhost:3000`.

For deep analysis reports, also add the MCP server
`http://<host>:3000/mcp/analysis-agents` (Streamable HTTP) to your agent.

### 3. Connect your data and ask

Tell your agent which database to use and what you want to ask about, for example:

> Use the ontomato-ontomap-builder skill. Connect Ontomato to my PostgreSQL database at
> db.example:5432/sales (user `report`, password in `$SALES_DB_PASSWORD`). Build an
> ontomap for the order, customer and product tables, import it, and check it with a
> few questions.

The agent points Ontomato at the database, reads the tables, writes the ontomap,
imports it and asks test questions. Ontomato works with one datasource at a time; this
release supports PostgreSQL as the business database.

Then ask questions in the web app at `http://<host>:3000`, and review or edit the
ontomap in the Ontology Manager at `http://<host>:3005`.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/` | application entry points: web app (`workbench`), data engine, Ontology Manager |
| `packages/` | shared implementation and contracts |
| `agent-skills/` | the agent skills |
| `deploy/` | the Docker Compose stack |
| `docker/`, `scripts/` | image recipes and build tools |

Local development and image builds are described in
[docs/development.md](docs/development.md).

## License

Ontomato is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE).

Every image carries `LICENSE`, `NOTICE` and a generated `THIRD_PARTY_NOTICES.txt` that
lists the third-party components it contains, under `/licenses/` (application files
under `/app/licenses/`). The IBM Db2 JDBC driver is not bundled because its license
restricts redistribution.
