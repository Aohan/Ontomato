import type { HttpResponse } from "@ontomato/contracts/http";
import type {
  ArtifactFilePreview,
  ArtifactFileTreeNode,
  Flowchart,
  TimelineEvent,
  WorkspaceManifest,
} from "@ontomato/contracts/observe";
/**
 * Case artifact API routes.
 *
 * Provides access to autotest case artifacts stored under:
 *   data/autotest/runs/{runId}/{caseId}/
 *
 * Mounted at /api/observe/autotest/runs/:runId/cases/:caseId/artifacts
 * in the autotest router.
 */

import path from "node:path";
import AdmZip from "adm-zip";
import { Request, Response, Router } from "express";
import { createLogger } from "../../../logging/logger";
import { autotestConfig } from "./config";
import { loadRunMeta } from "./results/store";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
import {
  addDirToZip,
  buildArtifactFileTree,
  resolveCaseArtifactDir,
  loadManifestAtArtifactDir,
  readPhysicalFilePreview,
  readArtifactFile,
  resolveArtifactFilePath,
} from "../observe/workspaces/artifact-file";
import { WORKSPACE_DIRS } from "../observe/workspaces/store";

const router: ReturnType<typeof Router> = Router({ mergeParams: true });
const logger = createLogger("autotest:artifact-routes");

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/**
 * Middleware-style guard: validates the run exists and the case artifact
 * directory is present. Sends 404 on failure.
 *
 * Returns the resolved artifact directory path, or null if the response
 * was already sent.
 */
function guardArtifactDir(req: Request, res: Response): string | null {
  const { runId, caseId } = req.params;

  const meta = loadRunMeta(runId);
  const domainId = (req as AuthenticatedRequest).domainId;
  if (!domainId || meta?.domainId !== domainId) {
    res.status(404).json({ success: false, error: "Run not found" });
    return null;
  }

  const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
  if (!artifactDir) {
    res.status(404).json({ success: false, error: "Case artifacts not found" });
    return null;
  }

  return artifactDir;
}

/* ================================================================== */
/*  Routes                                                             */
/* ================================================================== */

/**
 * GET / - Get manifest (meta information) for a case's artifacts.
 *
 * Returns the manifest.json content. 404 if artifacts do not exist.
 */
router.get("/", (req: Request, res: Response<HttpResponse<WorkspaceManifest>>) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const manifest = loadManifestAtArtifactDir(artifactDir, "");
    if (!manifest) {
      res.status(404).json({ success: false, error: "Manifest not found" });
      return;
    }

    res.json({ success: true, data: manifest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to get case manifest", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /tree - File tree of case artifacts.
 */
router.get("/tree", (req: Request, res: Response<HttpResponse<ArtifactFileTreeNode[]>>) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const tree = buildArtifactFileTree(artifactDir);
    res.json({ success: true, data: tree });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list case artifact tree", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /files/* - Preview/download a file from case artifacts.
 */
router.get("/files/*", async (req: Request, res: Response<HttpResponse<ArtifactFilePreview>>) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const filePath = req.params[0];
    if (!filePath) {
      res.status(400).json({ success: false, error: "File path is required" });
      return;
    }

    if (filePath.includes("..") || path.isAbsolute(filePath)) {
      res.status(400).json({ success: false, error: "Invalid file path" });
      return;
    }

    const fullPath = resolveArtifactFilePath(artifactDir, filePath);

    // Security: ensure resolved path stays within artifact directory
    if (!fullPath) {
      res.status(400).json({ success: false, error: "Invalid file path" });
      return;
    }

    const preview = await readPhysicalFilePreview(fullPath);
    if (!preview) {
      res.status(404).json({ success: false, error: "File not found" });
      return;
    }

    res.json({ success: true, data: preview });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to serve case artifact file", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /download - Download case artifacts as a ZIP archive.
 */
router.get("/download", (req: Request, res: Response) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const { runId, caseId } = req.params;

    const zip = new AdmZip();
    addDirToZip(zip, artifactDir, caseId);
    const zipBuffer = zip.toBuffer();

    const filename = `${runId}_${caseId}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create case artifact archive", { error: msg });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: msg });
    }
  }
});

/**
 * GET /timeline - Get timeline for a case's artifacts.
 *
 * Reads from the stored diagnostics/timeline.json within the case artifact directory.
 */
router.get("/timeline", (req: Request, res: Response<HttpResponse<TimelineEvent[]>>) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const timelinePath = path.join(artifactDir, WORKSPACE_DIRS.DIAGNOSTICS, "timeline.json");
    const stored = readArtifactFile(timelinePath);
    if (stored === null) {
      res.status(404).json({ success: false, error: "Timeline not found" });
      return;
    }

    const timeline = JSON.parse(stored);
    res.json({ success: true, data: timeline });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to get case timeline", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /flowchart - Get flowchart for a case's artifacts.
 *
 * Reads from the stored diagnostics/flowchart.json within the case artifact directory.
 */
router.get("/flowchart", (req: Request, res: Response<HttpResponse<Flowchart>>) => {
  try {
    const artifactDir = guardArtifactDir(req, res);
    if (!artifactDir) return;

    const flowchartPath = path.join(artifactDir, WORKSPACE_DIRS.DIAGNOSTICS, "flowchart.json");
    const stored = readArtifactFile(flowchartPath);
    if (stored === null) {
      res.status(404).json({ success: false, error: "Flowchart not found" });
      return;
    }

    const flowchart = JSON.parse(stored);
    res.json({ success: true, data: flowchart });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to get case flowchart", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
