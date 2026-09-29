# Small application image. Maven compilation stays in Dockerfile.build.
# The caller supplies payload/{lib,conf-defaults,skills,runtime-compat-fingerprint,runtime-family...}.
FROM scratch
COPY payload/ /
