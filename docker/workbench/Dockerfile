# Workbench final image: Node 24 + Python 3.10, Chromium, production
# dependencies in virtual store, and assembled application payload in /app.
ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm@sha256:2559be987fd64d61badbdafd303ea58a9ccab36d6c3c08bce219e762177d2eca
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG DEBIAN_MIRROR=https://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=https://deb.debian.org/debian-security

# Stage 1: Install production dependencies into /opt/runtime/node_modules.
# Inputs: metadata context under /src only (package.json, workspace yaml, pnpm lock).
# Source code changes do not invalidate this layer.
FROM ${NODE_RUNTIME_IMAGE} AS dependencies-installer

ARG PNPM_VERSION=9.15.9
RUN npm install -g pnpm@${PNPM_VERSION}
ENV npm_config_store_dir=/pnpm/store
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY sources/ /src/
COPY inputs.json /inputs.json
COPY tools/build-support.mjs /tmp/tools/build-support.mjs
COPY tools/workbench/install-runtime.mjs tools/workbench/runtime-layout.mjs tools/workbench/production-graph.mjs /tmp/tools/workbench/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store node /tmp/tools/workbench/install-runtime.mjs

# Stage 2: Web bundle builder and stage assembler.
# Runs on build host platform.
FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS app-builder

ARG WORKSPACE=ontomato
ARG APPLICATION
ARG TARGETPLATFORM
ARG PNPM_VERSION=9.15.9
RUN npm install -g pnpm@${PNPM_VERSION}
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
RUN TARGETPLATFORM=${TARGETPLATFORM} node /tmp/tools/workbench/stage-app.mjs
RUN cp /tmp/launch.sh /stage/launch.sh \
 && chmod 0755 /stage/launch.sh \
 && mkdir -p /stage/data

COPY LICENSE NOTICE /stage/licenses/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter "${APPLICATION}..." licenses list --json > /tmp/npm-licenses.json
RUN python3 /tmp/tools/third_party_notices.py /stage/licenses/THIRD_PARTY_NOTICES.txt --npm /tmp/npm-licenses.json <<'EOF'
Third-party notices for web assets and bundled application dependencies.
EOF

# Stage 3: Python 3.10 runtime base with Chromium, system libraries and Python packages.
FROM ${PYTHON_RUNTIME_IMAGE} AS runtime-base

ARG PIP_INDEX_URL
ARG DEBIAN_MIRROR
ARG DEBIAN_SECURITY_MIRROR

COPY --from=dependencies-installer /usr/local/bin/node /usr/local/bin/node

COPY runtime-requirements.txt /tmp/runtime-requirements.txt

RUN echo 'Acquire::Retries "5"; Acquire::http::Timeout "120";' > /etc/apt/apt.conf.d/99retries && \
    sed -i -E \
      -e "s#https?://deb.debian.org/debian-security#${DEBIAN_SECURITY_MIRROR}#g" \
      -e "s#https?://deb.debian.org/debian#${DEBIAN_MIRROR}#g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fontconfig \
    fonts-wqy-microhei \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxcb1 \
 && test -x /usr/bin/chromium \
 && node --version \
 && python3 --version | grep -E '^Python 3\.10\.' \
 && python3 -m pip install --no-cache-dir --only-binary=:all: --no-deps --index-url "$PIP_INDEX_URL" \
    -r /tmp/runtime-requirements.txt \
 && python3 -m pip check \
 && python3 -c "import pandas, sys; assert sys.version_info[:2] == (3, 10); print('pandas', pandas.__version__)" \
 && rm -rf /usr/local/lib/python3.10/site-packages/pip* /usr/local/lib/python3.10/site-packages/setuptools* /usr/local/lib/python3.10/site-packages/pkg_resources /usr/local/bin/pip* \
 && python3 -c "import pandas, numpy" \
 && rm -rf /usr/local/include \
 && rm -f /etc/apt/apt.conf.d/99retries && rm -rf /var/lib/apt/lists/*

RUN if python3 -m pip --version >/dev/null 2>&1; then echo "pip still present, must be removed from runtime" >&2; exit 1; fi

COPY --from=dependencies-installer /opt/runtime/node_modules /opt/runtime/node_modules
COPY LICENSE NOTICE /licenses/
COPY --from=dependencies-installer /usr/local/LICENSE /licenses/nodejs/LICENSE
RUN --mount=type=bind,from=dependencies-installer,source=/tmp/npm-licenses.json,target=/tmp/npm-licenses.json \
    --mount=type=bind,source=tools/third_party_notices.py,target=/tmp/third_party_notices.py \
    python3 /tmp/third_party_notices.py /licenses/THIRD_PARTY_NOTICES.txt --npm /tmp/npm-licenses.json <<'EOF'
Debian packages of the python:3.10-slim-bookworm base and the apt-installed
Chromium, fonts and libraries: /usr/share/doc/<package>/copyright
Python 3.10 interpreter and standard library: /usr/local/lib/python3.10/LICENSE.txt
Node.js binary (copied alone from the installer stage's Node image): /licenses/nodejs/LICENSE
EOF

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /opt/runtime
RUN ln -s /opt/runtime/node_modules /node_modules

# Stage 4: Final combined image.
FROM runtime-base AS final

COPY --from=app-builder /stage/ /app/
COPY --from=app-builder /stage/licenses/THIRD_PARTY_NOTICES.txt /licenses/WEB_THIRD_PARTY_NOTICES.txt

COPY tools/workbench/runtime-layout.mjs /tmp/tools/workbench/runtime-layout.mjs
RUN node -e 'import("/tmp/tools/workbench/runtime-layout.mjs").then(m => m.checkNoBrokenSymlinks("/app"))' \
 && rm -rf /tmp/tools

WORKDIR /app
CMD ["/app/launch.sh"]
