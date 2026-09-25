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
#   runtime-contract.json   the locked runtime's contract, read by the host
#                           from the already imported runtime image
#   tools/                  the installer/contract scripts this stage needs
#   launch.sh               the single app launcher owned by this recipe
ARG NODE_BUILDER_IMAGE=docker.1ms.run/library/node:20.3.0@sha256:fc738db1cbb81214be1719436605e9d7d84746e5eaf0629762aeba114aa0c28d
ARG WORKSPACE=ontomato
ARG APP_META_JSON

# Builder runs on the build host: full frozen install (dev included, unlike
# the runtime --filter-prod selection), the N3 closure preflight, the web
# build and the /stage assembly. Only the final scratch stage ships.
FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS web-builder

ARG WORKSPACE=ontomato
ARG APP_META_JSON

RUN npm install -g pnpm@9.15.9

WORKDIR /build
COPY workspace/ /build/workspace/
COPY runtime-contract.json /tmp/runtime-contract.json
COPY inputs.json /inputs.json
COPY tools/ /tmp/tools/
COPY launch.sh /tmp/launch.sh

WORKDIR /build/workspace/${WORKSPACE}
RUN pnpm install --frozen-lockfile
WORKDIR /build/workspace/${WORKSPACE}/apps/workbench
RUN pnpm build:web
RUN node /tmp/tools/workbench/stage-app.mjs
RUN cp /tmp/launch.sh /stage/launch.sh \
 && chmod 0755 /stage/launch.sh \
 && mkdir -p /stage/data

FROM scratch AS app

# The image root holds the /app layout: mounted at /app, productRoot is /app.
COPY --from=web-builder /stage/ /
