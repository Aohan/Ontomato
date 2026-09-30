import fs from "fs";
import path from "path";
import { runtimeDataDir, runtimeResourceSources } from "../content/layout";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";

const logger = createLogger("runtime-defaults");

function isCustomPath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(sourceRoot, sourcePath);
  return relativePath.split(path.sep).includes("custom");
}

/**
 * Syncs the app-assembled read-only default resources into the persistent runtime data directory: overwrites same-path default files and adds new ones,
 * skips custom entries in the source, and never deletes extra files in the target.
 */
export async function syncRuntimeDefaultResources(): Promise<void> {
  const runtimeRoot = runtimeDataDir();
  for (const { from, to } of runtimeResourceSources()) {
    const target = path.join(runtimeRoot, to);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.cp(from, target, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: (sourcePath) => !isCustomPath(from, sourcePath),
    });
  }

  logger.info(tApp("foundation.log.resources.synced"), { runtimeRoot });
}
