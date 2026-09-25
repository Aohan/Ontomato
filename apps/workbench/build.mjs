import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkbenchApp } from "../../scripts/workbench/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

buildWorkbenchApp(
  {
    repoRoot,
    publicRoot: repoRoot,
    lockRoot: appRoot,
    lockExclude: "apps/workbench/runtime-lock.json",
    component: "workbench-opensource",
    workspaceId: "ontomato",
    appImporter: "apps/workbench",
    sources: [{ id: "ontomato", root: repoRoot }],
  },
  process.argv.slice(2),
).catch((error) => {
  console.error(`[build] ${error.message}`);
  process.exitCode = 1;
});
