import type { WorkspaceManifest } from "@ontomato/contracts/observe";
/**
 * Observe workspace file management.
 *
 * Each workspace has a workspace directory at:
 *   data/traces/{workspaceId}/
 *
 * Structure:
 *   manifest.json
 *   raw-logs/
 *     app.log
 *     llm-calls.jsonl
 *     backend.log
 *   prompts/
 *     {agentName}-{seq}.md
 *   diagnostics/
 *     summary.md
 *     mqls_logic.md
 *     errors.log
 *     post_process_status.json
 *
 * Historical workspaces may also contain timeline.json / flowchart.json.
 */

import fs from "node:fs";
import path from "node:path";
import { environment } from "../../../../config/environment";
import { createLogger } from "../../../../logging/logger";
import { workbenchProduct } from "../../../../product/installed";

const logger = createLogger("observe:workspace-store");

/* ================================================================== */
/*  Chinese subdirectory name constants                               */
/* ================================================================== */

/**
 * Standard subdirectory names used within each observe workspace. They are persisted on
 * disk and referenced by each edition's knowledge and skills, so each application installs
 * its own historical names (see WorkbenchProduct.diagnosisWorkspaceNames).
 */
export const WORKSPACE_DIRS = {
  get RAW_LOGS() {
    return workbenchProduct().diagnosisWorkspaceNames.rawLogs;
  },
  get PROMPTS() {
    return workbenchProduct().diagnosisWorkspaceNames.prompts;
  },
  get DIAGNOSTICS() {
    return workbenchProduct().diagnosisWorkspaceNames.diagnostics;
  },
};

/* ================================================================== */
/*  Workspace paths                                                   */
/* ================================================================== */

function workspacesRoot(): string {
  return path.resolve(environment.observeWorkspaces() || "data/traces");
}

/** Validate workspaceId to prevent path traversal attacks. */
function validateWorkspaceId(workspaceId: string): void {
  if (!workspaceId || /[/\\:*?"<>|]/.test(workspaceId) || workspaceId.includes("..")) {
    throw new Error(`Invalid workspaceId: ${workspaceId}`);
  }
}

function workspaceDir(workspaceId: string): string {
  validateWorkspaceId(workspaceId);
  return path.join(workspacesRoot(), workspaceId);
}

export function getWorkspacePath(workspaceId: string): string {
  return workspaceDir(workspaceId);
}

function manifestPath(workspaceId: string): string {
  return path.join(workspaceDir(workspaceId), "manifest.json");
}

/* ================================================================== */
/*  Manifest operations                                               */
/* ================================================================== */

/**
 * Load a workspace manifest.
 */
export function loadManifest(workspaceId: string): WorkspaceManifest | null {
  const mp = manifestPath(workspaceId);
  if (!fs.existsSync(mp)) return null;
  try {
    const raw = fs.readFileSync(mp, "utf-8");
    return JSON.parse(raw) as WorkspaceManifest;
  } catch {
    return null;
  }
}

/**
 * Persist a workspace manifest.
 */
export function saveManifest(workspaceId: string, manifest: WorkspaceManifest): void {
  fs.mkdirSync(workspaceDir(workspaceId), { recursive: true });
  fs.writeFileSync(manifestPath(workspaceId), JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * List all workspace manifests sorted by creation time (newest first).
 */
export function listWorkspaces(): WorkspaceManifest[] {
  return listWorkspaceEntries().map((entry) => entry.manifest);
}

export interface WorkspaceStoreEntry {
  workspaceId: string;
  manifest: WorkspaceManifest;
}

/** List workspace directory IDs with their manifests, newest first. */
export function listWorkspaceEntries(): WorkspaceStoreEntry[] {
  const root = workspacesRoot();
  if (!fs.existsSync(root)) return [];

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const workspaces: WorkspaceStoreEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = loadManifest(entry.name);
      if (manifest) workspaces.push({ workspaceId: entry.name, manifest });
    }

    workspaces.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
    return workspaces;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list workspaces", { error: msg });
    return [];
  }
}

/**
 * Delete a workspace.
 */
export function deleteWorkspace(workspaceId: string): boolean {
  const dir = workspaceDir(workspaceId);
  if (!fs.existsSync(dir)) return false;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    logger.info("Workspace deleted", { workspaceId });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete workspace", { workspaceId, error: msg });
    return false;
  }
}
