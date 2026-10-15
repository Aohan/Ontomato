# The CLI runs on Linux inside Docker, including on macOS build hosts.
ARG BASE_IMAGE=registry.access.redhat.com/ubi9/ubi@sha256:16e9e43d99e181463513cc84a514859b1abb9460f1c4d9e208da4b4e51cd5cc3
FROM ${BASE_IMAGE} AS unpack
ARG TARGETARCH
COPY downloads/ /downloads/
RUN case "$TARGETARCH" in amd64|arm64) ;; *) exit 1;; esac \
    && tar -xzf /downloads/oc-mirror-${TARGETARCH}.tar.gz -C /usr/local/bin oc-mirror \
    && chmod 755 /usr/local/bin/oc-mirror && rm -rf /downloads
FROM ${BASE_IMAGE}
COPY --from=unpack /usr/local/bin/oc-mirror /usr/local/bin/oc-mirror
ENTRYPOINT ["/usr/local/bin/oc-mirror", "--v2"]
