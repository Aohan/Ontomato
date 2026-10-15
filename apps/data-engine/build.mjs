import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJavaApp, JAVA_FLAGS, parseJavaArgs } from "../../scripts/data-engine/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");
// Every public adapter module is in the reactor (the root pom lists them all); this app installs postgresql, mysql, sqlserver, duckdb, and neo4j.
const PUBLIC_ADAPTERS = ["postgresql", "mysql", "sqlserver", "gaussdb", "duckdb", "neo4j", "elasticsearch"];
const HELP =
  "Use make data-engine [ARCH=amd64|arm64] [PROMPT_LANG=en].\nBuilds the final datarag-opensource image, which runs as it is.";

export const app = {
  repoRoot,
  versionPom: resolve(repoRoot, "pom.xml"),
  sources: [{ id: "ontomato", root: repoRoot }],
  component: "datarag-opensource",
  promptLang: "en",
  supportedPromptLangs: ["en"],
  reactorDir: "ontomato",
  appModule: "apps/data-engine",
  appLibModules: [
    "packages/data-engine-core",
    "packages/data-adapters/postgresql",
    "packages/data-adapters/mysql",
    "packages/data-adapters/sqlserver",
    "packages/data-adapters/duckdb",
    "packages/data-adapters/neo4j",
    "packages/data-adapters/elasticsearch",
    "apps/data-engine",
  ],
  excludeArtifactIds: "data-engine-core,data-adapter-postgresql,data-adapter-mysql,data-adapter-sqlserver,data-adapter-duckdb,data-adapter-neo4j,data-adapter-elasticsearch,data-engine-app",
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
        // Every adapter depends on the shared contract tests in test scope, so Maven resolves it even with tests skipped.
        "packages/data-adapter-test-support/pom.xml",
        "packages/data-adapter-test-support/src/main",
        ...PUBLIC_ADAPTERS.flatMap((type) => [`packages/data-adapters/${type}/pom.xml`, `packages/data-adapters/${type}/src/main`]),
        "apps/data-engine/pom.xml",
        "apps/data-engine/src/main",
      ],
    },
  ],
  // No private export inputs: this component consumes the recipe's central export.
  secretExport: null,
  requirements: { root: repoRoot, path: "packages/data-engine-core/requirements-py310.txt" },
  mcp: { root: repoRoot, path: "packages/data-engine-core/mcp/mcpserver.py" },
  // Product startup files ride the payload at their fixed /app layout.
  bin: [
    [repoRoot, "scripts/data-engine/container-entrypoint.sh", "payload/bin/container-entrypoint.sh"],
    [repoRoot, "scripts/data-engine/sync-product-files.py", "payload/bin/sync-product-files.py"],
  ],
  resources: [
    [repoRoot, "packages/data-engine-core/conf-defaults", "payload/conf-defaults"],
    [repoRoot, "packages/data-engine-core/skills", "payload/skills"],
  ],
  requiredSkill: "payload/skills/aftercalculate/trend-forecaster/SKILL.md",
  labels: {},
  tagSuffix: "",
};

async function main(args) {
  const invocation = parseJavaArgs(args, JAVA_FLAGS);
  if (invocation.help) {
    console.log(HELP);
    return;
  }
  await buildJavaApp(app, invocation);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[build] ${error.message}`);
    process.exitCode = 1;
  });
