# Ontomato unified deployment

Offline Compose for PostgreSQL, DataRAG, the Node app, and the ontology manager.
Requires Docker Engine 26+ and the Docker Compose plugin.

## Build the offline pack

```bash
make bundle ARCH=arm64   # or amd64
```

The pack is written to `.build/bundle/<product>-<version>-<time>-<arch>.tar.gz`.
It holds this directory's `docker-compose.yml`, `.env.example`, `initdb.sql` and
`README.md`, the assembly recipes under `assemble/`, and one `images/*.tar.gz` per
image. The images of that architecture must already be built or imported on this
host: the pack is built from those local images, not from the source tree, and it
takes the version from the app images.

## Deploy on site

1. Copy the unpacked pack directory to the server.
2. Import the images:

   ```bash
   for f in images/*.tar.gz; do docker load -i "$f"; done
   ```

3. `cp .env.example .env`, then fill in group 1: `POSTGRES_PASSWORD` and
   `PUBLIC_HOST` (the address the browser uses, an IP or a hostname).
4. `docker compose up -d`.

The app and backend images are assembled offline at `up` (`pull_policy: build`):
each recipe copies a loaded app image into its loaded runtime image. To update only
the application, import the new app package and run `docker compose up -d` again;
the runtime stays loaded.

## Moving to Docker.io

`docker-compose.yml` keeps `ONTOMATO_RUNTIME_IMAGE` / `ONTOMATO_APP_IMAGE` and
`DATARAG_RUNTIME_IMAGE` / `DATARAG_APP_IMAGE` as build-argument overrides. Pointing
those four at registry references is the change that moves assembly off the local
image store; they are intentionally absent from `.env.example`.

## Databases and ports

PostgreSQL is published on `127.0.0.1` only (`POSTGRES_PORT`, default 5432). The Node
app is on `PORT` (default 3000), the ontology manager on `ONTOLOGY_MANAGER_PORT`
(default 3005), DataRAG on `DATARAG_PORT` (default 18087). The database accounts and
names are fixed in `docker-compose.yml`: user and database `ontomato` for the Node
app, database `datarag` for DataRAG. `frontend_data` is mounted at `/app/data` and
`backend_data` at `/deploy`; on first init `initdb.sql` creates the `ontomato` and
`datarag` databases. The stack does not attach an existing database or migrate old
data.
