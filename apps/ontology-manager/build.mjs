import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManagerImage } from "../../scripts/ontology-manager/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

buildManagerImage(
  {
    repoRoot,
    publicRoot: repoRoot,
    component: "ontomato-ontology-manager",
    workspaceId: "ontomato",
    appImporter: "apps/ontology-manager",
    sources: [{ id: "ontomato", root: repoRoot }],
    owners: { ontomato: ["apps/ontology-manager", "packages/ontology-manager"] },
  },
  process.argv.slice(2),
).catch((error) => {
  console.error(`[build] ${error.message}`);
  process.exitCode = 1;
});
