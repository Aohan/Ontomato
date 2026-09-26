# Ontomato unified deployment

Offline Compose for PostgreSQL, DataRAG, the Node app, and the ontology manager.
Requires Docker Engine 26+ and the Docker Compose plugin.

Application images are planned for Docker.io; registry names and tags are not
configured yet. This Compose currently expects preloaded image tags. Prepare
`node-app-runtime:deploy-<ARCH>`, `ontomato-app:deploy`,
`datarag-opensource-runtime:deploy-<ARCH>`, `datarag-opensource-app:deploy`,
`ontomato-ontology-manager:deploy-<ARCH>`, and `pgvector/pgvector:pg18` for one
architecture before the first start. `ARCH` is `amd64` or `arm64` and every image
must match it; `pgvector/pgvector:pg18` has no architecture suffix.

There is no single product pack yet. Each service is built from the repository
root by its own Make target, which writes a gzip archive under `.build/pack/`
for `docker load -i` on the deployment host:

| Images | Command |
|---|---|
| `node-app-runtime:deploy-<ARCH>` | `make workbench-runtime-pack ARCH=<ARCH>` |
| `ontomato-app:deploy` | `make workbench-app-pack ARCH=<ARCH>` (consumes the locked, loaded runtime) |
| `datarag-opensource-runtime:deploy-<ARCH>`, `datarag-opensource-app:deploy` | `make pack ARCH=<ARCH>` (`make pack-app` rebuilds only the app) |
| `ontomato-ontology-manager:deploy-<ARCH>` | `make pack-ontology-manager ARCH=<ARCH>` |

Copy `.env.example` to `.env`, set `ARCH`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
the `BACKEND_LLM_*` and `BACKEND_EMBEDDING_*` values and the browser URLs, then:

```bash
docker compose up -d
```

`POSTGRES_USER` and `POSTGRES_PASSWORD` are copied into the Node `DATABASE_URL`
without percent-encoding, so use letters, digits, `.`, `_`, and `-` only.
`ONTOLOGY_MANAGER_URL` is opened by the browser, so use the host address rather
than a container DNS name and keep it aligned with `ONTOLOGY_MANAGER_PORT`
(default 3005); the Node app is on `PORT` (default 3000). DataRAG and
Postgres are also published on the host, at `DATARAG_PORT` (default 18087) and
`POSTGRES_PORT` (default 5432).

`frontend_data` is mounted at `/app/data`, `backend_data` at `/deploy`, and
Postgres persists in a new volume at `/var/lib/postgresql`; on first init the SQL
creates the `ontomato` and `datarag` databases. The stack does not attach an
existing database or migrate old data.

The assembly recipes `docker/workbench/Dockerfile.assemble` and
`docker/data-engine/Dockerfile.assemble` copy a loaded app image into a loaded
runtime image and run the runtime's own pairing check for `ARCH`; optional pins
are `ONTOMATO_RUNTIME_IMAGE`, `ONTOMATO_APP_IMAGE`, `DATARAG_RUNTIME_IMAGE`, and
`DATARAG_APP_IMAGE`.
