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
# WORKSPACE (source id of the workspace root) and APPLICATION (the selected
# app's package name) always come from the builder; they have no default.
ARG NODE_BUILDER_IMAGE=docker.1ms.run/library/node:20.3.0@sha256:fc738db1cbb81214be1719436605e9d7d84746e5eaf0629762aeba114aa0c28d

# Builder runs on the build host: frozen install of the selected application
# and its workspace dependencies (dev included: the web build needs Vite),
# then that application's own build.
FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS web-builder

ARG WORKSPACE
ARG APPLICATION

RUN npm install -g pnpm@9.15.9

COPY workspace/ /build/workspace/
WORKDIR /build/workspace/${WORKSPACE}
RUN pnpm install --frozen-lockfile --filter "${APPLICATION}..."
WORKDIR /build/workspace/${WORKSPACE}/apps/ontology-manager
RUN pnpm build

FROM docker.io/library/nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

ARG WORKSPACE

RUN apk add --no-cache gettext
COPY --from=web-builder /build/workspace/${WORKSPACE}/apps/ontology-manager/dist /usr/share/nginx/html
COPY config.js.template /usr/share/nginx/html/config.js.template
COPY nginx.conf.template /etc/nginx/templates/ontology-manager.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
