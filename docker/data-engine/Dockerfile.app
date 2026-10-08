# Small application image. Maven compilation stays in Dockerfile.build.
# The caller supplies payload/{lib,conf-defaults,skills,bin,mcp,runtime-compat-fingerprint,runtime-family...}.
# Product startup files ride here at their fixed /app layout: bin/container-entrypoint.sh
# (executable), bin/sync-product-files.py and mcp/mcpserver.py.
FROM scratch
COPY payload/ /
# Normalize script permissions at the image boundary, including the enterprise
# lifecycle delegate, independently of the build host's filesystem permissions.
COPY --chmod=0755 payload/bin/ /bin/
