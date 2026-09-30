import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, expect, it, vi } from "vitest";

// Real dotenv plus the app's own env.ts/root.ts, placed into a temporary product layout: reads only the product root .env,
// independent of cwd, and never overrides existing process variables. Touches no .env inside the repository.
const appDir = fileURLToPath(new URL("../../", import.meta.url));
const productRoot = fs.mkdtempSync(path.join(os.tmpdir(), "product-env-"));
const tempApp = path.join(productRoot, "apps", "workbench");

afterAll(() => {
  delete process.env.PRODUCT_ENV_PROBE;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(productRoot, { recursive: true, force: true });
});

it("loads only the product-root .env and keeps variables the process already has", async () => {
  fs.mkdirSync(path.join(tempApp, "src"), { recursive: true });
  for (const file of ["env.ts", "root.ts"]) {
    fs.copyFileSync(path.join(appDir, "src", file), path.join(tempApp, "src", file));
  }
  fs.symlinkSync(path.join(appDir, "node_modules"), path.join(tempApp, "node_modules"));
  fs.writeFileSync(
    path.join(productRoot, ".env"),
    "PRODUCT_ENV_PROBE=from-product-root\nPRODUCT_ENV_EXISTING=from-env-file\n"
  );
  fs.writeFileSync(path.join(tempApp, ".env"), "PRODUCT_ENV_PROBE=from-app-dir\n");
  delete process.env.PRODUCT_ENV_PROBE;
  vi.stubEnv("PRODUCT_ENV_EXISTING", "from-process");
  vi.spyOn(process, "cwd").mockReturnValue(tempApp);

  await import(pathToFileURL(path.join(tempApp, "src", "env.ts")).href);

  expect(process.env.PRODUCT_ENV_PROBE).toBe("from-product-root");
  expect(process.env.PRODUCT_ENV_EXISTING).toBe("from-process");
});
