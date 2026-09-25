import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJavaApp } from "../../scripts/data-engine/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

buildJavaApp(
  {
    repoRoot,
    lockRoot: appRoot,
    lockExclude: "apps/data-engine/runtime-lock.json",
    versionPom: resolve(repoRoot, "pom.xml"),
    component: "datarag-opensource",
    family: "java-app",
    interfaceVersion: 3,
    promptLang: "en",
    promptLabel: "io.ontomato.prompt.lang",
    reactorDir: "ontomato",
    appModule: "apps/data-engine",
    appLibModules: ["packages/data-engine-core", "apps/data-engine"],
    excludeArtifactIds: "data-engine-core,data-engine-app",
    contextTrees: [
      {
        dest: "ontomato",
        root: repoRoot,
        paths: [
          "pom.xml",
          "mvnw",
          "mvnw.cmd",
          ".mvn",
          "packages/data-engine-core/pom.xml",
          "packages/data-engine-core/src/main",
          "apps/data-engine/pom.xml",
          "apps/data-engine/src/main",
        ],
      },
    ],
    requirements: "packages/data-engine-core/requirements-py310.txt",
    mcp: "packages/data-engine-core/mcp/mcpserver.py",
    bin: [
      ["scripts/data-engine/container-entrypoint.sh", "bin/container-entrypoint.sh"],
      ["scripts/data-engine/runtime-contract.py", "bin/runtime-contract.py"],
      ["scripts/data-engine/runtime_dependencies.py", "bin/runtime_dependencies.py"],
    ],
    resources: [
      ["packages/data-engine-core/conf-defaults", "payload/conf-defaults"],
      ["packages/data-engine-core/skills", "payload/skills"],
    ],
    requiredSkill: "payload/skills/aftercalculate/trend-forecaster/SKILL.md",
    pairContract: "/opt/datarag/bin/runtime-contract.py",
    exportImages: ["JDK_IMAGE"],
    runtimeImages: ["JRE_IMAGE", "PYTHON_RUNTIME_IMAGE"],
  },
  process.argv.slice(2),
).catch((error) => {
  console.error(`[build] ${error.message}`);
  process.exitCode = 1;
});
