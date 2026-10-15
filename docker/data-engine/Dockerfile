# DataRAG final runnable image, shared by both editions.
#
# The Maven export stages compile the reactor inside Docker and hand their output
# to the final stage: JRE 21, Python 3.10 with the pinned packages, the
# third-party runtime dependencies, then this build's own jars, default
# configuration, skills, MCP service and startup files. Nothing is assembled
# outside this image, and the image is what runs online and offline.
#
# The public component consumes build-central (empty Maven settings). The
# enterprise component consumes build-secret: its private settings arrive as a
# BuildKit secret and its license jar check runs in the same JDK stage.
ARG JDK_IMAGE=docker.io/library/eclipse-temurin:21-jdk-jammy@sha256:c7d5863b5dd8f26b90c64f1d80cc2b0e5a5e4642f8db9955a370d348edd8f438
ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm@sha256:2559be987fd64d61badbdafd303ea58a9ccab36d6c3c08bce219e762177d2eca
ARG JRE_IMAGE=docker.io/library/eclipse-temurin:21-jre-jammy@sha256:61d6c7b34d36aee3f45d043101259f97f3c6d428dc2a6f75513789983c5e254f
# Which export stage the final image copies from. The builder selects it: the
# public component builds build-central, the enterprise component build-secret.
ARG EXPORT_STAGE=build-central

# ---- Maven export ----
# One reactor package, then the target app's runtime closure. The central export
# writes empty Maven settings; the secret export takes the private settings only
# as a BuildKit secret (never copied or read by the host), the target native
# library, the license profile, and one artifact check run in the same JDK stage
# on the exported jar, named by Maven's default <artifactId>-<version>.jar.
# Both exports also write maven-licenses.json: the Maven license record of every
# runtime dependency of the app module, which the final image joins with the
# files under its lib/.
FROM ${JDK_IMAGE} AS ontomato-src
WORKDIR /src
COPY ontomato/ /src/ontomato/

FROM ontomato-src AS recipe
# license-maven-plugin builds each dependency's effective model with Maven's own project
# builder (parent POM inheritance and interpolation included) over the same resolution as
# copy-dependencies, so no POM is re-parsed here; this template only writes that model as JSON.
COPY <<'EOF' /usr/local/share/maven-licenses.ftl
[
<#list dependencyMap as e>
<#assign p = e.getKey()/>
{"groupId": "${p.groupId?json_string}", "artifactId": "${p.artifactId?json_string}", "version": "${p.version?json_string}", "url": "${(p.url!"")?json_string}", "licenses": [<#list p.licenses as l>{"name": "${(l.name!"")?json_string}", "url": "${(l.url!"")?json_string}"}<#sep>, </#sep></#list>]}<#sep>,</#sep>
</#list>
]
EOF
COPY --chmod=0755 <<'EOF' /usr/local/bin/export-java.sh
#!/bin/bash
set -euo pipefail
test -n "${REACTOR_DIR}"
test -n "${APP_MODULE}"
test -n "${APP_LIB_MODULES}"
test -n "${EXCLUDE_ARTIFACT_IDS}"
test -n "${MAVEN_SETTINGS}"
test -f "${MAVEN_SETTINGS}"
if test -n "${LICENSE_PROFILE}" && test "${LICENSE_PROFILE}" != "dev-override"; then
  echo "LICENSE_PROFILE must be empty or dev-override" >&2
  exit 1
fi
set --
if test "${LICENSE_PROFILE}" = "dev-override"; then
  set -- -Pdev-override
fi
reactor="/src/${REACTOR_DIR}"
test -f "${reactor}/pom.xml"
test -x /src/ontomato/mvnw
mkdir -p /out/app/lib /out/runtime-lib
/src/ontomato/mvnw -B -ntp -f "${reactor}/pom.xml" -s "${MAVEN_SETTINGS}" \
  -pl "${APP_MODULE}" -am -DskipTests \
  "$@" \
  package dependency:copy-dependencies \
  -DincludeScope=runtime \
  -DexcludeArtifactIds="${EXCLUDE_ARTIFACT_IDS}" \
  -DoutputDirectory='${project.build.directory}/runtime-lib' \
  org.codehaus.mojo:license-maven-plugin:2.4.0:add-third-party \
  -Dlicense.fileTemplate=/usr/local/share/maven-licenses.ftl \
  -Dlicense.thirdPartyFilename=maven-licenses.json \
  -Dlicense.includedScopes=compile,runtime \
  -Dlicense.useRepositoryMissingFiles=false
for module in ${APP_LIB_MODULES}; do
  dir="${reactor}/${module}/target"
  count=0
  main=
  for jar in "${dir}"/*.jar; do
    test -f "${jar}" || continue
    name=$(basename "${jar}")
    case "${name}" in
      *-sources.jar|*-javadoc.jar|*-tests.jar|*-test-sources.jar) continue ;;
    esac
    count=$((count + 1))
    main=${jar}
  done
  if test "${count}" -ne 1; then
    echo "expected one main jar under ${module}/target, found ${count}" >&2
    exit 1
  fi
  cp "${main}" /out/app/lib/
done
rt="${reactor}/${APP_MODULE}/target/runtime-lib"
test -d "${rt}"
cp -a "${rt}/." /out/runtime-lib/
cp "${reactor}/${APP_MODULE}/target/generated-sources/license/maven-licenses.json" /out/maven-licenses.json
rm -f /out/runtime-lib/*.dll /out/runtime-lib/*.dylib
if test -n "${KEEP_NATIVE}"; then
  find /out/runtime-lib -maxdepth 1 -name '*.so' ! -name "${KEEP_NATIVE}" -delete
  if test ! -f "/out/runtime-lib/${KEEP_NATIVE}"; then
    echo "missing native library ${KEEP_NATIVE}" >&2
    exit 1
  fi
else
  rm -f /out/runtime-lib/*.so
fi
for jar in /out/app/lib/*.jar; do
  if test -e "/out/runtime-lib/$(basename "${jar}")"; then
    echo "own jar in runtime-lib: $(basename "${jar}")" >&2
    exit 1
  fi
done
set -- /out/runtime-lib/*.jar
test -f "$1"
EOF

FROM recipe AS build-central
ARG REACTOR_DIR
ARG APP_MODULE
ARG APP_LIB_MODULES
ARG EXCLUDE_ARTIFACT_IDS
ARG KEEP_NATIVE=
ARG LICENSE_PROFILE=
RUN --mount=type=cache,target=/root/.m2 <<'EOF'
set -eu
cat > /tmp/maven-settings.xml <<'SETTINGS'
<settings></settings>
SETTINGS
MAVEN_SETTINGS=/tmp/maven-settings.xml /usr/local/bin/export-java.sh
rm -f /tmp/maven-settings.xml
EOF

FROM recipe AS enterprise-src
COPY enterprise/ /src/enterprise/

FROM enterprise-src AS build-secret
ARG REACTOR_DIR
ARG APP_MODULE
ARG APP_LIB_MODULES
ARG EXCLUDE_ARTIFACT_IDS
ARG KEEP_NATIVE=
ARG LICENSE_PROFILE=
ARG APP_CHECK_SCRIPT
ARG APP_CHECK_JAR
ARG APP_CHECK_ARG
RUN --mount=type=secret,id=maven-settings,required=true \
    --mount=type=cache,target=/root/.m2 \
    test -n "${APP_CHECK_SCRIPT}" && test -n "${APP_CHECK_JAR}" && test -n "${APP_CHECK_ARG}" \
 && MAVEN_SETTINGS=/run/secrets/maven-settings /usr/local/bin/export-java.sh \
 && sh "${APP_CHECK_SCRIPT}" "${APP_CHECK_JAR}" "${APP_CHECK_ARG}"

# The selected export. Only this stage and its inputs are built: the public
# component never evaluates the enterprise source or the secret stage.
FROM ${EXPORT_STAGE} AS exported

# ---- Runtime base: JRE 21 and Python 3.10 with the pinned packages ----
FROM ${JRE_IMAGE} AS jre

FROM ${PYTHON_RUNTIME_IMAGE} AS runtime-base
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV LANG=C.UTF-8

COPY --from=jre /opt/java/openjdk /opt/java/openjdk

COPY requirements-py310.txt /tmp/requirements-py310.txt
# The pinned list is the whole installed set: --no-deps installs only it, and
# pip check fails if it misses one.
RUN pip install --no-cache-dir --no-deps -i "${PIP_INDEX_URL}" -r /tmp/requirements-py310.txt \
    && pip check \
    && python -c "import pandas, requests, numpy, mcp, sympy" \
    && rm -rf /usr/local/lib/python3.10/site-packages/pip* /usr/local/lib/python3.10/site-packages/setuptools* /usr/local/lib/python3.10/site-packages/pkg_resources /usr/local/bin/pip* \
    && python -c "import pandas, requests, numpy, mcp, sympy"
# pip/setuptools are used only during the build above: at runtime python runs only calculation scripts and the MCP service (pip is unavailable).
RUN if python -m pip --version >/dev/null 2>&1; then echo "pip still present, must be removed from runtime" >&2; exit 1; fi

# ---- Final runnable image ----
FROM runtime-base AS image
ARG TARGETARCH

# Third-party dependencies first, so this layer follows the pinned dependency set
# and not the product source: an ordinary source change reuses it.
COPY --from=exported /out/runtime-lib/ /opt/datarag/lib/
COPY requirements-py310.txt /opt/datarag/requirements.txt
COPY LICENSE NOTICE /licenses/
# Third-party notices of what this image installs, under /licenses, next to the
# dependencies they describe: every file under lib/ joined with the export's Maven
# license records (lib/ itself stays byte-identical to the export), and the
# distributions pip left installed. The system section names where the base images
# keep their own.
RUN --mount=type=bind,from=exported,source=/out/maven-licenses.json,target=/tmp/maven-licenses.json \
    --mount=type=bind,source=tools/third_party_notices.py,target=/tmp/third_party_notices.py \
    python /tmp/third_party_notices.py /licenses/THIRD_PARTY_NOTICES.txt --python --jars /opt/datarag/lib /tmp/maven-licenses.json <<'EOF'
Debian packages of the python:3.10-slim-bookworm base: /usr/share/doc/<package>/copyright
Python 3.10 interpreter and standard library: /usr/local/lib/python3.10/LICENSE.txt
Eclipse Temurin 21 JRE (copied alone from the eclipse-temurin JRE image): /opt/java/openjdk/NOTICE
and /opt/java/openjdk/legal/
EOF

# This build's own jars, then the product resources and startup files. The
# startup script permissions are set at the image boundary with COPY --chmod,
# independently of the build host's filesystem permissions.
COPY --from=exported /out/app/lib/ /app/lib/
COPY payload/ /app/
COPY --chmod=0755 payload/bin/ /app/bin/
# The build fails here rather than at first start if the assembled image cannot
# run on the JRE it carries.
RUN --mount=type=bind,source=tools/verify-image.py,target=/tmp/verify-image.py \
    python /tmp/verify-image.py --app /app --lib /opt/datarag/lib --arch "${TARGETARCH}"

WORKDIR /deploy
# The entrypoint is the product's own; CMD stays empty so an edition that needs
# extra JVM arguments ships an entrypoint wrapper instead of an inherited CMD.
CMD []
ENTRYPOINT ["/app/bin/container-entrypoint.sh"]
