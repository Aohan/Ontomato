# Ontomato deployment

Three final images run the workbench, data engine and ontology manager. PostgreSQL
is a fourth service. The site needs Docker Engine 26+, Compose v2 and Python 3.8+.

## Online deployment

```bash
cp .env.example .env
# Set ARCH, POSTGRES_PASSWORD and PUBLIC_HOST in .env.
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.ghcr.yml' >> .env
echo 'ONTOMATO_VERSION=4.0.1' >> .env
docker compose pull
docker compose up -d --wait --wait-timeout 600
```

Update `ONTOMATO_VERSION`, then repeat pull and up. Images come from GHCR. Build
and publication happen before deployment; Compose has no build step.

## Offline delivery

On the connected build host, after CI has published the final images:

```bash
make bundle ARCH=amd64 VERSION=4.0.1 BOOTSTRAP=1
# Later versions, using the SAME persistent MIRROR_STATE:
make bundle ARCH=amd64 VERSION=<next-version>
```

The default state is `.build/mirror/<arch>`; set `MIRROR_STATE` to a durable path
for production exports. `IMAGE_REGISTRY` and `IMAGE_TAG` select published sources.
Each product image is checked for the expected architecture, component and version,
then resolved to an immutable platform digest. `REGISTRY_AUTH_FILE` can point to
an oc-mirror-compatible auth JSON; credentials are never copied into a delivery.

The result is `.build/bundle/ontomato-<version>-<time>-<arch>.tar.gz`, including
this deployment template, `offline/` and `package/`. `package/mirror_*.tar` files
are oc-mirror's own archives. The initial `bootstrap.tar.gz` contains Registry 3.1.2
and the pinned oc-mirror 4.22.17 tool image. Subsequent packages omit bootstrap.
Do not use `docker load` on `mirror_*.tar`.

On the disconnected machine, extract the first bundle and run:

```bash
python3 offline/mirror.py import --bundle package \
  --state /var/lib/ontomato-mirror --output-env images.env
cp .env.example .env
# Set POSTGRES_PASSWORD and PUBLIC_HOST in .env, then append the image references:
cat images.env >> .env
docker compose pull
docker compose up -d --wait --wait-timeout 600
```

Registry listens only on `127.0.0.1:5000`. The default project is
`ontomato-offline`; `--port` and `--project` can select an isolated instance. The
site's application images are pulled by digest from this local Registry.

For updates, extract the new bundle outside the existing deployment directory.
Run its import command with the same state directory. After successful import,
replace the six image/version/architecture values in the existing `.env` with
those in `images.env`, then pull and up. Keep existing secrets, data directories
and database volumes. Import failure leaves the previous `.env` and application
containers untouched. Retain the previous references to select a prior image;
application/database migration compatibility must be considered separately.

## State and recovery

- Keep the connected export state (both cache and `export/working-dir`) and each
  site's import state (cache, incoming working directory and Registry data).
- Successful Registry imports are recorded under the site state's `imports/` directory.
  These receipts do not assert that the application upgrade has completed.
- Copy each completed delivery before the next export: oc-mirror reuses its
  output directory. The wrapper copies archives into the versioned bundle first.
- Deliver increments in export order. A site missing a middle version must import
  the missing archives first. A fresh site or lost cache needs a full delivery:
  export the required version with a NEW empty `MIRROR_STATE` and `BOOTSTRAP=1`.
- A populated Registry does not replace oc-mirror's local cache. Do not prune or
  delete either history during a delivery chain. Retain packages for recovery.
- This is whole-layer deduplication: changing a file in a large layer transfers
  that whole new layer. It is not a binary patch format. Keep application changes
  separate from stable dependencies in the Dockerfiles.

Official references: [oc-mirror](https://github.com/openshift/oc-mirror),
[Distribution](https://distribution.github.io/distribution/).

## Data and ports

PostgreSQL uses a named volume and is published on loopback port 5432 by default.
Workbench port is 3000, manager 3005 and data engine 18087. Override them in `.env`.
`frontend_data` maps to `/app/data`, and `backend_data` to `/deploy`. Initial
`initdb.sql` creates the product databases. Services default to UTC; set `TZ` for
another timezone. This stack does not migrate a pre-existing database.
