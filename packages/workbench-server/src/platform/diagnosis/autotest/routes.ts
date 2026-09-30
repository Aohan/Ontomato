import type {
  TestCase,
  CaseSet,
  CaseSetImportResult,
  CaseSetListItem,
  RetainedRunMeta,
  RunMeta,
  RunResults,
  RunEvent,
} from "@ontomato/contracts/autotest";
import type { HttpResponse, HttpAcknowledgement } from "@ontomato/contracts/http";
import type { ArtifactFilePreview, ArtifactFileTreeNode } from "@ontomato/contracts/observe";
import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import { requireDomainId, type AuthenticatedRequest } from "../../../utils/request-identity";
import type { RunConfig } from "./types";
/**
 * Autotest API routes.
 *
 * Mounted at /api/observe/autotest in server.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { Request, Response, Router } from "express";

import { t , tApp } from "../../../i18n";
import { createLogger } from "../../../logging/logger";
import { initializeSse } from "../../../utils/sse";
import {
  createEmptyCaseSet,
  deleteCaseSet,
  ensureUniqueCaseIds,
  getCaseSet,
  importCaseSet,
  isEmptyCasePayload,
  listCaseSets,
  saveCaseSet,
} from "./cases/repository";
import {
  getActiveRun,
  isRunActive,
  startRun,
  stopRun,
  subscribeRunEvents,
} from "./runner/run-controller";
import {
  computeSummary,
  deleteRun,
  listRuns,
  loadCaseResults,
  loadRunMeta,
  settleStaleRunMeta,
  hasActiveRunArtifactWrites,
} from "./results/store";
import { autotestConfig } from "./config";
import caseArtifactRouter from "./artifact-routes";
import {
  walkArtifactDirectory,
  buildArtifactFileTree,
  resolveCaseArtifactDir,
  readPhysicalFilePreview,
  resolveArtifactFilePath,
} from "../observe/workspaces/artifact-file";

import {
  clearArtifactRetentionBestEffort,
  getArtifactRetentionSnapshot,
} from "../observe/artifact-retention/store";
import { hasArtifactRetention } from "../observe/artifact-retention/types";

const router: ReturnType<typeof Router> = Router();
const logger = createLogger("autotest:routes");

interface ZipArchiveLike {
  pipe(destination: Response): void;
  file(filePath: string, data: { name: string }): void;
  finalize(): Promise<void>;
}

interface ArchiverModuleLike {
  ZipArchive?: new (options: { zlib: { level: number } }) => ZipArchiveLike;
  default?: (format: string, options: { zlib: { level: number } }) => ZipArchiveLike;
  create?: (format: string, options: { zlib: { level: number } }) => ZipArchiveLike;
}

/* Mount case artifact sub-router */
router.use("/runs/:id", (req: Request, res: Response, next) => {
  const domainId = (req as AuthenticatedRequest).domainId;
  const active = getActiveRun();
  const meta = active?.runId === req.params.id ? active : loadRunMeta(req.params.id);
  if (!domainId || meta?.domainId !== domainId) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }
  next();
});
router.use("/runs/:runId/cases/:caseId/artifacts", caseArtifactRouter);

/* ================================================================== */
/*  Case Sets                                                          */
/* ================================================================== */

/**
 * GET /case-sets - List all case sets (without full case arrays).
 */
router.get("/case-sets", (_req: Request, res: Response<HttpResponse<CaseSetListItem[]>>) => {
  try {
    const sets = listCaseSets();
    res.json({ success: true, data: sets });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list case sets", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /case-sets - Create / import a case set.
 *
 * Body: { name: string, cases: [...] }
 *   or: { name: string, payload: [...] }  (legacy array import)
 */
router.post("/case-sets", (req: Request, res: Response<HttpResponse<CaseSetImportResult>>) => {
  try {
    const { name, cases, payload } = req.body as {
      name?: string;
      cases?: unknown;
      payload?: unknown;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    const data = cases ?? payload;

    // Empty / omitted payload => create a fresh empty case set (fill in later).
    // importCaseSet stays strict ("import must have content"); only this route
    // path treats "no cases" as a valid new empty set.
    if (isEmptyCasePayload(data)) {
      const caseSet = createEmptyCaseSet(name.trim());
      logger.info("Empty case set created", { id: caseSet.id, name: caseSet.name });
      res.status(201).json({
        success: true,
        data: {
          id: caseSet.id,
          name: caseSet.name,
          caseCount: 0,
          warnings: [],
        },
      });
      return;
    }

    const { caseSet, warnings } = importCaseSet(name.trim(), data);

    logger.info("Case set imported", {
      id: caseSet.id,
      name: caseSet.name,
      caseCount: caseSet.cases.length,
      warningCount: warnings.length,
    });

    res.status(201).json({
      success: true,
      data: {
        id: caseSet.id,
        name: caseSet.name,
        caseCount: caseSet.cases.length,
        warnings,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to import case set", { error: msg });
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /case-sets/:id - Get a single case set with all cases.
 */
router.get("/case-sets/:id", (req: Request, res: Response<HttpResponse<CaseSet>>) => {
  try {
    const cs = getCaseSet(req.params.id);
    if (!cs) {
      res.status(404).json({ success: false, error: "Case set not found" });
      return;
    }
    res.json({ success: true, data: cs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * DELETE /case-sets/:id - Delete a case set.
 */
router.delete("/case-sets/:id", (req: Request, res: Response<HttpAcknowledgement>) => {
  try {
    const deleted = deleteCaseSet(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: "Case set not found" });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /case-sets/:id - Update a case set (name and/or cases).
 */
router.put("/case-sets/:id", (req: Request, res: Response<HttpResponse<CaseSet>>) => {
  try {
    const cs = getCaseSet(req.params.id);
    if (!cs) {
      res.status(404).json({ success: false, error: "Case set not found" });
      return;
    }

    const { name, cases } = req.body as {
      name?: string;
      cases?: TestCase[];
    };

    if (name !== undefined) cs.name = name.trim() || cs.name;
    if (Array.isArray(cases)) {
      cs.cases = ensureUniqueCaseIds(
        cases
          .filter((c) => c.question?.trim())
          .map((c, index) => ({
            caseId: c.caseId || `case-${index + 1}`,
            question: c.question.trim(),
            expectedAnswer: c.expectedAnswer,
            expectedLogic: c.expectedLogic,
            judgment: c.judgment,
          }))
      );
    }

    cs.updatedAt = new Date().toISOString();
    saveCaseSet(cs);

    logger.info("Case set updated", { id: cs.id, name: cs.name, caseCount: cs.cases.length });
    res.json({ success: true, data: cs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/* ================================================================== */
/*  Runs                                                               */
/* ================================================================== */

/**
 * POST /runs - Create and start a new run.
 *
 * Body: { caseSetId: string, concurrency?: number, rounds?: number, caseTimeoutSeconds?: number }
 */
router.post("/runs", async (req: Request, res: Response<HttpResponse<RunMeta>>) => {
  try {
    if (isRunActive()) {
      res.status(409).json({
        success: false,
        error: "A run is already active",
      });
      return;
    }

    const { caseSetId, temporaryCases, concurrency, rounds, caseTimeoutSeconds } =
      req.body as Partial<RunConfig> & {
        temporaryCases?: unknown;
        caseTimeoutSeconds?: unknown;
      };
    const identity = req as AuthenticatedRequest;

    if (
      caseTimeoutSeconds !== undefined &&
      (typeof caseTimeoutSeconds !== "number" ||
        !Number.isFinite(caseTimeoutSeconds) ||
        caseTimeoutSeconds <= 0)
    ) {
      res.status(400).json({ success: false, error: "caseTimeoutSeconds must be greater than 0" });
      return;
    }

    let resolvedCaseSetId = caseSetId;

    if (!resolvedCaseSetId && Array.isArray(temporaryCases) && temporaryCases.length > 0) {
      const { caseSet } = importCaseSet(tApp("diag.autotest.routes.0", { p0: Date.now() }), temporaryCases);
      resolvedCaseSetId = caseSet.id;
    }

    if (!resolvedCaseSetId) {
      res.status(400).json({ success: false, error: "caseSetId or temporaryCases is required" });
      return;
    }

    const runConfig: RunConfig = {
      domainId: requireDomainId(identity),
      caseSetId: resolvedCaseSetId,
      concurrency,
      rounds,
      caseTimeoutMs:
        caseTimeoutSeconds === undefined ? autotestConfig.caseTimeoutMs : caseTimeoutSeconds * 1000,
      userId: identity.userId,
      tk: identity.token,
    };

    const meta = await startRun(runConfig);

    res.status(201).json({ success: true, data: meta });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start run", { error: msg });
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /runs - List all runs.
 */
router.get("/runs", async (req: Request, res: Response<HttpResponse<RetainedRunMeta[]>>) => {
  try {
    const active = getActiveRun();
    const keptKeys = await getArtifactRetentionSnapshot();
    const runs = listRuns({
      activeRunId: active?.runId,
      domainId: requireDomainId(req as AuthenticatedRequest),
    }).map((run) => ({
      ...run,
      kept: hasArtifactRetention(keptKeys, "autotest-run", run.runId),
    }));
    res.json({ success: true, data: runs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /runs/:id - Get run detail.
 */
router.get("/runs/:id", async (req: Request, res: Response<HttpResponse<RetainedRunMeta>>) => {
  try {
    const keptKeys = await getArtifactRetentionSnapshot();
    const withRetention = (meta: RunMeta) => ({
      ...meta,
      kept: hasArtifactRetention(keptKeys, "autotest-run", meta.runId),
    });

    // Check active run first (has latest in-memory state)
    const active = getActiveRun();
    if (active && active.runId === req.params.id) {
      res.json({ success: true, data: withRetention(active) });
      return;
    }

    const meta = loadRunMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    res.json({ success: true, data: withRetention(settleStaleRunMeta(meta)) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * DELETE /runs/:id - Delete a completed historical run and its artifacts.
 */
router.delete("/runs/:id", async (req: Request, res: Response<HttpAcknowledgement>) => {
  try {
    const runId = req.params.id;
    const active = getActiveRun();
    const storedMeta = loadRunMeta(runId);
    const meta =
      active?.runId === runId ? active : storedMeta ? settleStaleRunMeta(storedMeta) : null;

    if (!meta) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    if (meta.status === "running" || meta.status === "stopping") {
      res.status(409).json({ success: false, error: t("api.testBatchRunning") });
      return;
    }

    if (hasActiveRunArtifactWrites(runId)) {
      res.status(409).json({ success: false, error: "Run artifacts are still being generated" });
      return;
    }

    const deleted = deleteRun(runId);
    if (!deleted) {
      res.status(500).json({ success: false, error: "Run delete failed" });
      return;
    }

    await clearArtifactRetentionBestEffort("autotest-run", runId);
    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete run", { error: msg, runId: req.params.id });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /runs/:id/stop - Stop a running run.
 */
router.post("/runs/:id/stop", (req: Request, res: Response<HttpResponse<RunMeta>>) => {
  try {
    const meta = stopRun(req.params.id);
    res.json({ success: true, data: meta } satisfies HttpResponse<RunMeta>);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to stop run", { error: msg, runId: req.params.id });
    res.status(400).json({ success: false, error: msg });
  }
});

/**
 * GET /runs/:id/events - SSE stream of run events.
 */
router.get("/runs/:id/events", (req: Request, res: Response) => {
  const runId = req.params.id;

  initializeSse(res);

  const unsubscribe = subscribeRunEvents(runId, (event: RunEvent) => {
    try {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      // Close SSE connection after run completes
      if (event.type === "run_complete") {
        if (!res.writableEnded) {
          res.write("data: [DONE]\n\n");
        }
        cleanup();
      }
    } catch {
      // Connection closed
    }
  });

  if (!unsubscribe) {
    // Run is not active; send current state and close
    const storedMeta = loadRunMeta(runId);
    const meta = storedMeta ? settleStaleRunMeta(storedMeta) : null;
    if (meta) {
      const results = loadCaseResults(runId);
      const summary = computeSummary(results, meta.summary.total || results.length);
      res.write(
        `data: ${JSON.stringify({
          type: "run_complete",
          runId,
          timestamp: Date.now(),
          data: { summary, status: meta.status },
        } satisfies RunEvent)}\n\n`
      );
    }
    res.write("data: [DONE]\n\n");
    if (!res.writableEnded) res.end();
    return;
  }

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write("event: heartbeat\n");
        res.write(`data: ${JSON.stringify({ ts: Date.now() } satisfies SseHeartbeatData)}\n\n`);
      }
    } catch {
      cleanup();
    }
  }, 15000);

  // Auto-close after 2 hours (long runs should reconnect)
  const maxConnectionTimeout = setTimeout(
    () => {
      logger.info("Run SSE connection timed out (2h)", { runId });
      cleanup();
    },
    2 * 60 * 60 * 1000
  );

  function cleanup(): void {
    clearInterval(heartbeat);
    clearTimeout(maxConnectionTimeout);
    unsubscribe?.();
    if (!res.writableEnded) res.end();
  }

  req.on("close", cleanup);
});

/* ================================================================== */
/*  Results                                                            */
/* ================================================================== */

/**
 * GET /runs/:id/results - List case results for a run.
 */
router.get("/runs/:id/results", (req: Request, res: Response<HttpResponse<RunResults>>) => {
  try {
    const meta = loadRunMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    const results = loadCaseResults(req.params.id);
    const summary = computeSummary(results, meta.summary.total || results.length);

    // Optional status filter
    const statusFilter = req.query.status as string | undefined;
    const filtered = statusFilter ? results.filter((r) => r.status === statusFilter) : results;

    res.json({
      success: true,
      data: {
        runId: meta.runId,
        summary,
        results: filtered.map((r) => ({
          caseId: r.caseId,
          threadId: r.threadId,
          status: r.status,
          question: r.question,
          finalAnswer: r.finalAnswer,
          turnKey: r.turnKey,
          durationMs: r.durationMs,
          error: r.error,
          answerEvaluation: r.answerEvaluation,
        })),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/* ================================================================== */
/*  Case Artifacts                                                     */
/* ================================================================== */

/**
 * GET /runs/:id/cases/:caseId/tree - List case artifact files as a tree.
 *
 * Reads from data/autotest/runs/{runId}/{caseId}/.
 */
router.get(
  "/runs/:id/cases/:caseId/tree",
  (req: Request, res: Response<HttpResponse<ArtifactFileTreeNode[]>>) => {
    try {
      const runId = req.params.id;
      const caseId = req.params.caseId;

      const meta = loadRunMeta(runId);
      if (!meta) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }

      const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
      if (!artifactDir) {
        res.status(404).json({ success: false, error: "Case artifacts not found" });
        return;
      }

      const tree = buildArtifactFileTree(artifactDir);
      res.json({ success: true, data: tree });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to list case artifact tree", { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /runs/:id/cases/:caseId/files/* - Preview/download a case artifact file.
 *
 * Reads from data/autotest/runs/{runId}/{caseId}/.
 */
router.get(
  "/runs/:id/cases/:caseId/files/*",
  async (req: Request, res: Response<HttpResponse<ArtifactFilePreview>>) => {
    try {
      const runId = req.params.id;
      const caseId = req.params.caseId;
      const filePath = req.params[0];

      if (!filePath) {
        res.status(400).json({ success: false, error: "File path is required" });
        return;
      }

      if (filePath.includes("..") || path.isAbsolute(filePath)) {
        res.status(400).json({ success: false, error: "Invalid file path" });
        return;
      }

      const meta = loadRunMeta(runId);
      if (!meta) {
        res.status(404).json({ success: false, error: "Run not found" });
        return;
      }

      const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
      if (!artifactDir) {
        res.status(404).json({ success: false, error: "Case artifacts not found" });
        return;
      }

      const fullPath = resolveArtifactFilePath(artifactDir, filePath);
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
  }
);

/**
 * GET /runs/:id/download - Download all run artifacts as a ZIP archive.
 * GET /runs/:id/cases/:caseId/download - Download single case artifacts as ZIP.
 */
router.get("/runs/:id/download", (req: Request, res: Response) => {
  downloadArtifacts(res, req.params.id);
});

router.get("/runs/:id/cases/:caseId/download", (req: Request, res: Response) => {
  downloadArtifacts(res, req.params.id, req.params.caseId);
});

async function downloadArtifacts(res: Response, runId: string, caseId?: string) {
  try {
    const meta = loadRunMeta(runId);
    if (!meta) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    let baseDir: string;
    if (caseId) {
      const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
      if (!artifactDir) {
        res.status(404).json({ success: false, error: "Artifacts not found" });
        return;
      }
      baseDir = artifactDir;
    } else {
      // Full run: download the run directory (still has run.json, results.json)
      baseDir = path.join(autotestConfig.dataDir, "runs", runId);
    }

    if (!fs.existsSync(baseDir)) {
      res.status(404).json({ success: false, error: "Artifacts not found" });
      return;
    }

    const archive = createZipArchive((await import("archiver")) as unknown as ArchiverModuleLike);
    const filename = caseId ? `${runId}_${caseId}.zip` : `${runId}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    archive.pipe(res);
    walkArtifactDirectory(baseDir, (entry, fullPath, descend) => {
      const name = path.relative(baseDir, fullPath).split(path.sep).join("/");
      // file() also preserves directory and symlink entries without traversing them.
      archive.file(fullPath, { name });
      if (entry.isDirectory()) descend();
      return undefined;
    });
    await archive.finalize();

    logger.info("Artifact archive downloaded", { runId, caseId: caseId || "all" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create artifact archive", { error: msg });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: msg });
    }
  }
}

function createZipArchive(archiverModule: ArchiverModuleLike): ZipArchiveLike {
  if (archiverModule.ZipArchive) {
    return new archiverModule.ZipArchive({ zlib: { level: 5 } });
  }

  const createArchive =
    typeof archiverModule.default === "function" ? archiverModule.default : archiverModule.create;
  if (typeof createArchive === "function") {
    return createArchive("zip", { zlib: { level: 5 } });
  }

  throw new Error("Unsupported archiver module");
}

export default router;
