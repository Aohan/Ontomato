# Ontomato unified deployment

Compose for PostgreSQL, DataRAG, the Node app, and the ontology manager.
Requires Docker Engine 26+ and the Docker Compose plugin.

The Node app and DataRAG each ship as a runtime image and an app image, which are
assembled on the deployment machine at `up` (`pull_policy: build`): each recipe under
`assemble/` copies the app image into the runtime image and checks that they pair.
The images come either from GitHub Container Registry (`docker-compose.ghcr.yml`) or
from an offline pack (`docker-compose.yml`).

## Deploy from GitHub Container Registry

From `deploy/` in the source repository:

```bash
cp .env.example .env    # set ARCH, POSTGRES_PASSWORD and PUBLIC_HOST
docker compose -f docker-compose.ghcr.yml up -d
```

`ARCH` names this machine's architecture, `amd64` or `arm64`; the assembly checks the
images against it. `docker-compose.ghcr.yml` inherits every service from
`docker-compose.yml` and only points the runtime, app and ontology manager images at
`ghcr.io/aohan/ontomato-*`. They follow `latest` unless `ONTOMATO_VERSION` is set in
`.env`. A runtime image is published under its compatibility fingerprint, so an update
downloads new app images and reuses the runtime while the fingerprint is unchanged.

To update:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml build --pull
docker compose -f docker-compose.ghcr.yml up -d
```

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

## Databases and ports

PostgreSQL is published on `127.0.0.1` only (`POSTGRES_PORT`, default 5432). The Node
app is on `PORT` (default 3000), the ontology manager on `ONTOLOGY_MANAGER_PORT`
(default 3005), DataRAG on `DATARAG_PORT` (default 18087). The database accounts and
names are fixed in `docker-compose.yml`: user and database `ontomato` for the Node
app, database `datarag` for DataRAG. `frontend_data` is mounted at `/app/data` and
`backend_data` at `/deploy`; on first init `initdb.sql` creates the `ontomato` and
`datarag` databases. The stack does not attach an existing database or migrate old
data.
