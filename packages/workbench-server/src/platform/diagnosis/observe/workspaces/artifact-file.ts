import type {
  WorkspaceManifest,
  ArtifactFileTreeNode,
  ArtifactFilePreview,
} from "@ontomato/contracts/observe";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { createLogger } from "../../../../logging/logger";
import { getWorkspacePath } from "./store";

const logger = createLogger("observe:workspace-store");

export const FILE_PREVIEW_BYTES = 5 * 1024 * 1024;

export async function readPhysicalFilePreview(
  filePath: string
): Promise<ArtifactFilePreview | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const bytesToRead = Math.min(stat.size, FILE_PREVIEW_BYTES);

  if (bytesToRead === 0) {
    return {
      content: "",
      size: stat.size,
      loadedBytes: 0,
      truncated: false,
    };
  }

  try {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      return {
        content: buffer.subarray(0, bytesRead).toString("utf-8"),
        size: stat.size,
        loadedBytes: bytesRead,
        truncated: stat.size > bytesRead,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Build the file tree for a workspace.
 */
export function getFileTree(workspaceId: string): ArtifactFileTreeNode | null {
  const dir = getWorkspacePath(workspaceId);
  if (!fs.existsSync(dir)) return null;
  return {
    name: workspaceId,
    path: "",
    type: "directory",
    children: buildArtifactFileTree(dir, "workspace"),
  };
}

/**
 * Read a file from the workspace.
 *
 * @param workspaceId - Workspace identifier
 * @param relativePath - File path relative to the workspace
 * @returns File content as string, or null if not found.
 */
export function readWorkspaceFile(workspaceId: string, relativePath: string): string | null {
  const resolved = resolveWorkspaceFilePath(workspaceId, relativePath);
  if (!resolved) return null;

  return readArtifactFile(resolved, "workspace");
}

/**
 * Read a bounded text preview from a workspace file.
 *
 * Large backend logs can be tens of MB; this keeps preview endpoints responsive
 * while preserving the full artifact download path.
 */
export async function readWorkspaceFilePreview(
  workspaceId: string,
  relativePath: string
): Promise<ArtifactFilePreview | null> {
  const resolved = resolveWorkspaceFilePath(workspaceId, relativePath);
  if (!resolved) return null;

  return readPhysicalFilePreview(resolved);
}

/**
 * Create a zip archive of the workspace.
 *
 * @returns Buffer containing the zip file, or null on failure.
 */
export function createWorkspaceZip(workspaceId: string): Buffer | null {
  const dir = getWorkspacePath(workspaceId);
  if (!fs.existsSync(dir)) return null;

  try {
    const zip = new AdmZip();
    addDirToZip(zip, dir, workspaceId);
    return zip.toBuffer();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create workspace zip", { workspaceId, error: msg });
    return null;
  }
}

function resolveWorkspaceFilePath(workspaceId: string, relativePath: string): string | null {
  const resolved = resolveArtifactFilePath(getWorkspacePath(workspaceId), relativePath);
  if (!resolved) {
    logger.warn("Path traversal attempt", { workspaceId, relativePath });
    return null;
  }
  return resolved;
}

export function walkArtifactDirectory<T>(
  dir: string,
  visit: (entry: fs.Dirent, fullPath: string, children: () => T[]) => T | undefined,
  ignoreAccessErrors = false
): T[] {
  const result: T[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const value = visit(entry, fullPath, () =>
        walkArtifactDirectory(fullPath, visit, ignoreAccessErrors)
      );
      if (value !== undefined) result.push(value);
    }
  } catch (error) {
    if (!ignoreAccessErrors) throw error;
  }
  return result;
}

export function buildArtifactFileTree(
  artifactDir: string,
  format: "case" | "workspace" = "case"
): ArtifactFileTreeNode[] {
  return walkArtifactDirectory<ArtifactFileTreeNode>(
    artifactDir,
    (entry, fullPath, descend) => {
      const relativePath = path.relative(artifactDir, fullPath);
      const childPath =
        format === "case"
          ? relativePath.replace(/\\/g, "/")
          : relativePath.split(path.sep).join("/");
      if (entry.isDirectory()) {
        const children = descend();
        if (children.length > 0) {
          return format === "case"
            ? { name: entry.name, type: "directory", path: childPath, children }
            : { name: entry.name, path: childPath, type: "directory", children };
        }
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        return format === "case"
          ? { name: entry.name, type: "file", path: childPath, size: stat.size }
          : { name: entry.name, path: childPath, type: "file", size: stat.size };
      }
      return undefined;
    },
    format === "workspace"
  );
}

export function readArtifactFile(
  filePath: string,
  source: "case" | "workspace" = "case"
): string | null {
  if (!fs.existsSync(filePath) || (source === "workspace" && !fs.statSync(filePath).isFile())) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if (source !== "workspace") throw error;
    return null;
  }
}

export function addDirToZip(zip: AdmZip, dir: string, zipPrefix: string | false): void {
  walkArtifactDirectory(dir, (entry, fullPath, descend) => {
    const relativePath = path.relative(dir, fullPath).split(path.sep).join("/");
    const zipPath = zipPrefix ? `${zipPrefix}/${relativePath}` : relativePath;
    if (entry.isFile()) {
      zip.addLocalFile(fullPath, path.dirname(zipPath), entry.name);
    } else if (entry.isDirectory()) {
      descend();
    }
    return undefined;
  });
}

export function loadManifestAtArtifactDir(
  artifactDir: string,
  relativeDir: string
): WorkspaceManifest | null {
  const root = path.resolve(artifactDir);
  const manifestPath = path.resolve(root, relativeDir, "manifest.json");
  if (!isPathInside(manifestPath, root) || !fs.existsSync(manifestPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as WorkspaceManifest;
  } catch {
    return null;
  }
}

export function resolveArtifactFilePath(artifactDir: string, relativePath: string): string | null {
  const root = path.resolve(artifactDir);
  const resolved = path.resolve(root, relativePath);
  return isPathInside(resolved, root) ? resolved : null;
}

function isPathInside(candidatePath: string, root: string): boolean {
  return candidatePath === root || candidatePath.startsWith(root + path.sep);
}

export function resolveCaseArtifactDir(
  dataDir: string,
  runId: string,
  caseId: string
): string | null {
  // Validate inputs to prevent path traversal
  if (!runId || /[/\\:*?"<>|]/.test(runId) || runId.includes("..")) return null;
  if (!caseId || /[/\\:*?"<>|]/.test(caseId) || caseId.includes("..")) return null;

  const dir = path.join(dataDir, "runs", runId, caseId);
  return fs.existsSync(dir) ? dir : null;
}
