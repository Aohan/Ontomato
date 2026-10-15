import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkbenchImage } from "../../scripts/workbench/build-images.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

export const app = {
  repoRoot,
  publicRoot: repoRoot,
  component: "ontomato",
  workspaceId: "ontomato",
  appImporter: "apps/workbench",
  sources: [{ id: "ontomato", root: repoRoot }],
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  buildWorkbenchImage(app, process.argv.slice(2)).catch((error) => {
    console.error(`[build] ${error.message}`);
    process.exitCode = 1;
  });
