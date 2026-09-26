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
 * 把应用装配的只读默认资源同步进持久运行数据目录：覆盖同路径默认文件、补充新文件，
 * 跳过来源中的 custom，不删除目标里的额外文件。
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
