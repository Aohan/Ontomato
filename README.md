# Ontomato

[中文](README.zh-CN.md) · [Website](https://ontomato.ai/)

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

Requirements: Docker Engine 26+ with the Compose plugin, an OpenAI-compatible chat model
endpoint, and an embedding model endpoint. The images are pulled from Docker Hub for
`linux/amd64` and `linux/arm64`.

```bash
git clone https://github.com/Aohan/Ontomato.git
cd Ontomato/deploy
cp .env.example .env
# edit .env, then:
docker compose up -d
```

Set these values in `.env`; the other entries have working defaults and are
described in the comments of `.env.example`.

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | letters, digits, `.`, `_` and `-` only |
| `BACKEND_LLM_BASE_URL`, `BACKEND_LLM_API_KEY`, `BACKEND_LLM_MODEL` | the chat model |
| `BACKEND_EMBEDDING_BASE_URL`, `BACKEND_EMBEDDING_API_KEY`, `BACKEND_EMBEDDING_MODEL`, `BACKEND_EMBEDDING_DIMENSIONS` | the embedding model; the dimensions must match the model's output |
| `ONTOLOGY_MANAGER_URL` | the Ontology Manager address as the browser reaches it, such as `http://<host>:3005` |

When `docker compose ps` shows every service healthy, these ports are open:

| Port | Service |
| --- | --- |
| 3000 | Ontomato web app and API |
| 3005 | Ontology Manager |
| 18087 | Data engine |
| 5432 | PostgreSQL |

### 2. Install the agent skills

Three skills are in [agent-skills/en](agent-skills/en); Chinese versions are in
[agent-skills/zh](agent-skills/zh). They need Node.js 18+.

| Skill | Use it to |
| --- | --- |
| `ontomato-ontomap-builder` | connect Ontomato to a database, write and import the ontomap, and check it with questions |
| `ontomato-analyst` | read the ontomap, run DSL queries and natural-language questions, and reach the analysis agents |
| `ontomato-app-builder` | on a separate test deployment: import the production ontomap, load test data, build and debug MetricViews, Actions and the pages that call them |

Copy the skill directories into your agent's skills directory. From the repository
root:

```bash
# Claude Code
mkdir -p .claude/skills && cp -R agent-skills/en/* .claude/skills/
# Codex
mkdir -p .agents/skills && cp -R agent-skills/en/* .agents/skills/
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
| `agent-skills/` | the agent skills, in English and Chinese |
| `deploy/` | the Docker Compose stack |
| `docker/`, `scripts/` | image recipes and build tools |

Local development and image builds are described in
[docs/development.md](docs/development.md) (Chinese).

## License

Ontomato is licensed under the [Apache License 2.0](LICENSE); see also [NOTICE](NOTICE).

Every image carries `LICENSE`, `NOTICE` and a generated `THIRD_PARTY_NOTICES.txt` that
lists the third-party components it contains, under `/licenses/` (application files
under `/app/licenses/`). The IBM Db2 JDBC driver is not bundled because its license
restricts redistribution.
