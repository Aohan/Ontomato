import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkbenchApp } from "../../scripts/workbench/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

export const app = {
  repoRoot,
  publicRoot: repoRoot,
  lockRoot: appRoot,
  lockExclude: "apps/workbench/runtime-lock.json",
  component: "ontomato",
  // Stable runtime alias <name>:deploy-<arch> and runtime package prefix consumed by deployment.
  runtimeImageName: "node-app-runtime",
  workspaceId: "ontomato",
  appImporter: "apps/workbench",
  sources: [{ id: "ontomato", root: repoRoot }],
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  buildWorkbenchApp(app, process.argv.slice(2)).catch((error) => {
    console.error(`[build] ${error.message}`);
    process.exitCode = 1;
  });
