# Standalone ontology manager image: Nginx serving the compiled web app only;
# no Node, Python, pnpm store or business runtime enters the final image.
#
# The host builder prepares one build context. Every path below is part of
# that contract:
#   workspace/<source id>/  captured workspace metadata of each source plus the
#                           named owners' Git-visible sources, the two repos
#                           adjacent so workspace links keep working
#   config.js.template, nginx.conf.template, docker-entrypoint.sh
#                           the Nginx runtime files of this recipe
#   LICENSE, NOTICE         the public repository's own license files
#   tools/third_party_notices.py
#                           the public notice generator
# WORKSPACE (source id of the workspace root) and APPLICATION (the selected
# app's package name) always come from the builder; they have no default.
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4

# Builder runs on the build host: frozen install of the selected application
# and its workspace dependencies (dev included: the web build needs Vite),
# then that application's own build.
FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS web-builder

ARG WORKSPACE
ARG APPLICATION

ARG PNPM_VERSION=9.15.9
RUN npm install -g pnpm@${PNPM_VERSION}
# pnpm's package store persists on the build machine across builds (a BuildKit
# cache mount): packages are downloaded once and still installed exactly by the
# frozen lock with integrity checks, so image contents do not depend on it.
# Every step that reads the store (install, licenses) mounts the same cache.
ENV npm_config_store_dir=/pnpm/store

COPY workspace/ /build/workspace/
WORKDIR /build/workspace/${WORKSPACE}
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter "${APPLICATION}..."
WORKDIR /build/workspace/${WORKSPACE}/apps/ontology-manager
RUN pnpm build
# Third-party notices of the web bundle (bundling drops the packages' license
# comments), from pnpm's report of exactly the selection installed above, dev
# dependencies included: listing more than the bundle uses is accepted where
# listing less is not.
COPY tools/third_party_notices.py /tmp/third_party_notices.py
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter "${APPLICATION}..." licenses list --json > /tmp/npm-licenses.json
RUN python3 /tmp/third_party_notices.py /licenses/THIRD_PARTY_NOTICES.txt --npm /tmp/npm-licenses.json <<'EOF'
Alpine packages of the nginx:1.27-alpine base and gettext: each package's
license identifier is its L: field in /lib/apk/db/installed
nginx and its modules: /usr/share/licenses/<package>/COPYRIGHT
EOF

FROM docker.io/library/nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

ARG WORKSPACE

RUN apk add --no-cache gettext
COPY --from=web-builder /build/workspace/${WORKSPACE}/apps/ontology-manager/dist /usr/share/nginx/html
COPY LICENSE NOTICE /licenses/
COPY --from=web-builder /licenses/ /licenses/
COPY config.js.template /usr/share/nginx/html/config.js.template
COPY nginx.conf.template /etc/nginx/templates/ontology-manager.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
