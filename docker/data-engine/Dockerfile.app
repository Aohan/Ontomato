# Small application image. Maven compilation stays in Dockerfile.build.
# The caller supplies payload/{lib,conf-defaults,skills}, the exported runtime-lib, and requirements-py310.txt.
# A later private assembly may add its own payload files. This recipe does not invent them.
ARG RUNTIME_IMAGE

FROM ${RUNTIME_IMAGE} AS verify

ARG RUNTIME_COMPAT_FINGERPRINT

COPY runtime-lib/ /verify/runtime-lib/
COPY payload/ /verify/payload/
COPY requirements-py310.txt /verify/requirements-py310.txt

RUN set -eu; \
    actual="$(cat /opt/datarag/runtime-compat-fingerprint)"; \
    version="$(python -c 'import json; print(json.load(open("/opt/datarag/runtime-contract.json"))["interfaceVersion"])')"; \
    test -n "$RUNTIME_COMPAT_FINGERPRINT"; \
    test "$actual" = "$RUNTIME_COMPAT_FINGERPRINT" || { echo "runtime compatibility mismatch" >&2; exit 1; }; \
    test "$version" = "3" || { echo "runtime interfaceVersion ${version} is not 3" >&2; exit 1; }; \
    diff -r /verify/runtime-lib /opt/datarag/lib || { echo "runtime dependency bytes differ" >&2; exit 1; }; \
    for jar in /verify/payload/lib/*.jar; do \
      test -f "$jar" || { echo "no application jar" >&2; exit 1; }; \
      echo "check-app $(basename "$jar")"; \
      python /opt/datarag/bin/runtime-contract.py check-app "$jar" /verify/requirements-py310.txt; \
    done; \
    printf '%s' "$actual" > /verify/payload/runtime-compat-fingerprint; \
    printf 'java-app\n' > /verify/payload/runtime-family

FROM scratch
COPY --from=verify /verify/payload/ /
