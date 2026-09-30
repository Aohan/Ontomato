# Workbench application image: the edition's own payload only, assembled
# into /app. The runtime image supplies Node, Python and the production
# dependencies; this image never contains them, the other edition's app
# sources, or build inputs beyond this recipe's explicit context.
#
# The host entry prepares one build context. Every path below is part of that
# contract; the driver only copies these entries and never redesigns them.
#   workspace/<source id>/  real source trees (node_modules/.git/.build/dist/
#                           tests/.env excluded by the driver) with the two
#                           repos adjacent, so workspace links keep working
#   inputs.json             N4a build input record (workspace/app selection)
#   tools/                  the installer/contract scripts this stage needs
#   launch.sh               the single app launcher owned by this recipe
#   LICENSE, NOTICE         the public repository's own license files
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
ARG WORKSPACE=ontomato
ARG APP_META_JSON

# Builder runs on the build host: full frozen install (dev included, unlike
# the runtime --filter-prod selection), the closure check, the web
# build and the /stage assembly. Only the final scratch stage ships.
FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS web-builder

ARG WORKSPACE=ontomato
ARG APPLICATION
ARG APP_META_JSON

ARG PNPM_VERSION=9.15.9
RUN npm install -g pnpm@${PNPM_VERSION}
# pnpm's package store persists on the build machine across builds (a BuildKit
# cache mount): packages are downloaded once and still installed exactly by the
# frozen lock with integrity checks, so image contents do not depend on it.
# Every step that reads the store (install, licenses) mounts the same cache.
ENV npm_config_store_dir=/pnpm/store

WORKDIR /build
COPY workspace/ /build/workspace/
COPY inputs.json /inputs.json
COPY tools/ /tmp/tools/
COPY launch.sh /tmp/launch.sh

WORKDIR /build/workspace/${WORKSPACE}
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
WORKDIR /build/workspace/${WORKSPACE}/apps/workbench
RUN pnpm build:web
RUN node /tmp/tools/workbench/stage-app.mjs
RUN cp /tmp/launch.sh /stage/launch.sh \
 && chmod 0755 /stage/launch.sh \
 && mkdir -p /stage/data
# Third-party notices of the web bundle (bundling drops the packages' license
# comments), from pnpm's report of the application's workspace closure. Dev
# dependencies are included: the application declares its web packages as
# devDependencies, and listing more than the bundle uses is accepted where
# listing less is not. Everything else under /app comes from the runtime.
COPY LICENSE NOTICE /stage/licenses/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter "${APPLICATION}..." licenses list --json > /tmp/npm-licenses.json
RUN python3 /tmp/tools/third_party_notices.py /stage/licenses/THIRD_PARTY_NOTICES.txt --npm /tmp/npm-licenses.json <<'EOF'
None in this image: it holds only application files and the bundled web
assets. Node.js, Python, the system packages and the server's production
dependencies come from the paired runtime image; see /licenses there.
EOF

FROM scratch AS app

# The image root holds the /app layout: mounted at /app, productRoot is /app.
COPY --from=web-builder /stage/ /
