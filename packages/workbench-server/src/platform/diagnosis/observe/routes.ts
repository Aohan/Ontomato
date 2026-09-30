import type { HttpResponse, HttpAcknowledgement } from "@ontomato/contracts/http";
import type {
  ArtifactFilePreview,
  ArtifactFileTreeNode,
  ErrorSummary,
  Flowchart,
  LogParseResult,
  LogSource,
  LogSourceConfig,
  LogSourceProbeResult,
  ParsedLogRecord,
  RetainedWorkspaceManifest,
  TimelineEvent,
  WorkspaceManifest,
  LogSourceType,
  ParsedLogSource,
  LogLevel,
} from "@ontomato/contracts/observe";
import type { SseHeartbeatData } from "@ontomato/contracts/sse";
import { requireDomainId, type AuthenticatedRequest } from "../../../utils/request-identity";
import { getCheckpointer } from "../../../infrastructure/connection";
import { parseTurnKey } from "../../../logging/log-context";
import { HttpError } from "../../../utils/errors";
import type { LogQueryParams, LlmQueryParams, BackendLogQueryParams, LiveLogFilter } from "./types";
/**
 * Observe API routes.
 *
 * Mounted at /api/observe in server.ts.
 */

import { Request, Response, NextFunction, Router } from "express";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../../logging/logger";

import { initializeSse } from "../../../utils/sse";
import { getLogSourceConfig, setLogSourceConfig } from "./config";
import { fetchBackendConfig, getBackendConfig } from "./backend-config-fetcher";
import { listLogSources, probeLogSource } from "./log-sources/manager";
import { queryAppLogs, queryLlmCalls, queryBackendLogs, getErrorSummary } from "./query";
import { buildTurnWorkspace } from "./workspaces/builder";
import { listWorkspaces, loadManifest, deleteWorkspace } from "./workspaces/store";
import {
  getFileTree,
  readWorkspaceFile,
  readWorkspaceFilePreview,
  createWorkspaceZip,
} from "./workspaces/artifact-file";
import { refreshLiveLogSources, subscribeLiveLogs } from "./live-logs";
import {
  clearArtifactRetentionBestEffort,
  getArtifactRetentionSnapshot,
} from "./artifact-retention/store";
import { hasArtifactRetention } from "./artifact-retention/types";
import { WORKSPACE_DIRS } from "./workspaces/store";
import { tApp } from "../../../i18n";


const router: ReturnType<typeof Router> = Router();
const logger = createLogger("observe:routes");

async function verifyTurnAccess(req: Request, turnKey: string): Promise<void> {
  const turn = parseTurnKey(turnKey);
  if (!turn) throw new HttpError(400, "Invalid turnKey");
  const identity = req as AuthenticatedRequest;
  const domainId = requireDomainId(identity);
  const manifest = loadManifest(turnKey);
  if (manifest) {
    if (manifest.domainId !== domainId) throw new HttpError(403, "Workspace access denied");
    if (req.method !== "POST") return;
  }
  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new HttpError(503, "Thread storage unavailable");
  await checkpointer.verifyThreadDomain(turn.threadId, domainId);
}

router.use("/turns/:turnKey", (req, _res, next) => {
  void verifyTurnAccess(req, req.params.turnKey).then(() => next(), next);
});
router.use((req, _res, next) => {
  const turnKeys = [req.query.turnKey, req.body?.turnKey].filter((key) => key !== undefined);
  void Promise.all(turnKeys.map((key) => verifyTurnAccess(req, String(key)))).then(
    () => next(),
    next
  );
});

/* ------------------------------------------------------------------ */
/*  Lazy-load backend infrastructure config on first request           */
/* ------------------------------------------------------------------ */

let backendConfigLoadPromise: Promise<void> | null = null;
let backendConfigLastAttemptAt = 0;

const BACKEND_CONFIG_RETRY_INTERVAL_MS = 60_000;

function hasBackendConfigCredential(token?: string): boolean {
  return !!token;
}

function canRetryBackendConfigLoad(): boolean {
  return Date.now() - backendConfigLastAttemptAt >= BACKEND_CONFIG_RETRY_INTERVAL_MS;
}

function loadBackendConfigOnce(token?: string): Promise<void> {
  backendConfigLastAttemptAt = Date.now();
  backendConfigLoadPromise = fetchBackendConfig(token)
    .then((config) => {
      if (config) refreshLiveLogSources();
    })
    .catch((err) => {
      logger.warn(tApp("diag.observe.routes.0"), {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      backendConfigLoadPromise = null;
    });
  return backendConfigLoadPromise;
}

function shouldWaitForBackendConfig(req: Request): boolean {
  if (req.method === "POST") {
    return req.path === "/turns" || req.path === "/parse" || req.path === "/log-sources/probe";
  }

  if (req.method !== "GET") return false;

  return (
    req.path === "/log-source-config" ||
    req.path === "/backend-logs" ||
    req.path === "/errors" ||
    req.path === "/live-logs" ||
    /^\/turns\/[^/]+\/context$/.test(req.path)
  );
}

router.use(async (req: Request, _res: Response, next: NextFunction) => {
  if (!getBackendConfig()) {
    const token = (req as AuthenticatedRequest).token;
    const needsBackendConfig = shouldWaitForBackendConfig(req);
    const shouldWaitForRemoteConfig = !!token && needsBackendConfig;

    if (
      needsBackendConfig &&
      !backendConfigLoadPromise &&
      hasBackendConfigCredential(token) &&
      canRetryBackendConfigLoad()
    ) {
      loadBackendConfigOnce(token || undefined);
    }
    if (shouldWaitForRemoteConfig && backendConfigLoadPromise) {
      await backendConfigLoadPromise;
    }
  }
  next();
});

/* ================================================================== */
/*  Log Sources                                                       */
/* ================================================================== */

/**
 * GET /log-sources - List all log sources with availability status.
 */
router.get("/log-sources", (_req: Request, res: Response<HttpResponse<LogSource[]>>) => {
  try {
    const sources = listLogSources();
    res.json({ success: true, data: sources });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list log sources", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /log-source-config - Get current log source configuration.
 */
router.get("/log-source-config", (_req: Request, res: Response<HttpResponse<LogSourceConfig>>) => {
  try {
    const config = getLogSourceConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /log-source-config - Save log source configuration (runtime override).
 */
router.put("/log-source-config", (req: Request, res: Response<HttpResponse<LogSourceConfig>>) => {
  try {
    const body = req.body as Partial<LogSourceConfig>;

    const config: LogSourceConfig = {
      backendNodes: Array.isArray(body.backendNodes)
        ? body.backendNodes
            .map((item) => ({
              nodeId: String((item as { nodeId?: unknown }).nodeId || "").trim(),
              baseUrl: String((item as { baseUrl?: unknown }).baseUrl || "").trim(),
            }))
            .filter((item) => item.nodeId && item.baseUrl)
        : [],
    };

    setLogSourceConfig(config);
    refreshLiveLogSources();
    logger.info("Log source config updated", {
      backendNodeCount: config.backendNodes.length,
    });

    res.json({ success: true, data: config });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /log-sources/probe - Test connectivity of a specific log source.
 *
 * Body: { sourceType: "data-agent-app" | "ontomato-app" | "data-agent-llm" | "ontomato-llm" | "backend-node-api" }
 */
router.post(
  "/log-sources/probe",
  async (req: Request, res: Response<HttpResponse<LogSourceProbeResult>>) => {
    try {
      const { sourceType } = req.body as { sourceType?: LogSourceType };

      if (!sourceType) {
        res.status(400).json({ success: false, error: "sourceType is required" });
        return;
      }

      const result = await probeLogSource(sourceType, {
        token: (req as AuthenticatedRequest).token,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Probe failed", { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/* ================================================================== */
/*  Parse & Errors                                                    */
/* ================================================================== */

/**
 * POST /parse - Trigger parsing by time range.
 *
 * Body: { startTime?: string, endTime?: string }
 */
router.post("/parse", async (req: Request, res: Response<HttpResponse<LogParseResult>>) => {
  try {
    const { startTime, endTime } = req.body as {
      startTime?: string;
      endTime?: string;
    };

    if (!startTime) {
      res.status(400).json({
        success: false,
        error: "startTime is required",
      });
      return;
    }

    // Logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
    requireDomainId(req as AuthenticatedRequest);
    const appLogs = queryAppLogs({ startTime, endTime });
    const llmLogs = queryLlmCalls({ startTime, endTime });
    res.json({
      success: true,
      data: { appLogCount: appLogs.length, llmLogCount: llmLogs.length },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Parse failed", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /errors - Error summary across all log sources.
 */
router.get("/errors", async (req: Request, res: Response<HttpResponse<ErrorSummary>>) => {
  try {
    const turnKey = req.query.turnKey as string | undefined;
    const startTime = req.query.startTime as string | undefined;
    const endTime = req.query.endTime as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    // Logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
    requireDomainId(req as AuthenticatedRequest);
    const summary = await getErrorSummary(
      {
        turnKey,
        startTime,
        endTime,
        limit,
      },
      { token: (req as AuthenticatedRequest).token }
    );
    res.json({ success: true, data: summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/* ================================================================== */
/*  Live Logs (SSE)                                                   */
/* ================================================================== */

/**
 * GET /live-logs - SSE stream of real-time log entries.
 *
 * Query params: source, level, turnKey, keyword, since_seq
 */
router.get("/live-logs", (req: Request, res: Response) => {
  initializeSse(res);

  const listenerId = randomUUID();

  // Live logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
  requireDomainId(req as AuthenticatedRequest);
  const filter: LiveLogFilter = {};
  if (req.query.source) {
    filter.source = (req.query.source as string).split(",") as ParsedLogSource[];
  }
  if (req.query.level) {
    filter.level = (req.query.level as string).split(",") as LogLevel[];
  }
  if (req.query.turnKey) {
    filter.turnKey = req.query.turnKey as string;
  }
  if (req.query.keyword) {
    filter.keyword = req.query.keyword as string;
  }
  if (req.query.since_seq) {
    filter.sinceSeq = parseInt(req.query.since_seq as string, 10);
  }

  const unsubscribe = subscribeLiveLogs(
    listenerId,
    filter,
    (seq, record) => {
      try {
        if (!res.writableEnded) {
          res.write(`id: ${seq}\n`);
          res.write(`data: ${JSON.stringify(record)}\n\n`);
        }
      } catch {
        cleanup();
      }
    },
    () => {
      cleanup();
    },
    { token: (req as AuthenticatedRequest).token }
  );

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

  // Auto-close after 30 minutes to prevent indefinite connection hold
  const maxConnectionTimeout = setTimeout(
    () => {
      logger.info("Live-log SSE connection timed out (30min)", { listenerId });
      cleanup();
    },
    30 * 60 * 1000
  );

  function cleanup(): void {
    clearInterval(heartbeat);
    clearTimeout(maxConnectionTimeout);
    unsubscribe();
    if (!res.writableEnded) res.end();
  }

  req.on("close", cleanup);
});

/* ================================================================== */
/*  Turns                                                             */
/* ================================================================== */

/**
 * POST /turns - Create or on-demand build a Turn workspace.
 *
 * Body: { turnKey: string, force?: boolean }
 */
router.post("/turns", async (req: Request, res: Response<HttpResponse<WorkspaceManifest>>) => {
  try {
    const { turnKey, force } = req.body as {
      turnKey?: string;
      force?: boolean;
    };

    if (!turnKey) {
      res.status(400).json({ success: false, error: "turnKey is required" });
      return;
    }

    if (force) {
      deleteWorkspace(turnKey);
    } else {
      const existing = loadManifest(turnKey);
      if (existing) {
        res.json({ success: true, data: existing });
        return;
      }
    }

    const manifest = await buildTurnWorkspace({
      turnKey,
      domainId: requireDomainId(req as AuthenticatedRequest),
      token: (req as AuthenticatedRequest).token,
    });
    res.status(201).json({ success: true, data: manifest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create turn workspace", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /turns - List all Turn workspaces.
 */
router.get(
  "/turns",
  async (req: Request, res: Response<HttpResponse<RetainedWorkspaceManifest[]>>) => {
    try {
      const keptKeys = await getArtifactRetentionSnapshot();
      const domainId = requireDomainId(req as AuthenticatedRequest);
      const turns = listWorkspaces()
        .filter((manifest) => manifest.domainId === domainId)
        .filter((manifest) => manifest.turnKey)
        .map((manifest) => ({
          ...manifest,
          kept: hasArtifactRetention(
            keptKeys,
            "turn-workspace",
            manifest.turnKey || manifest.workspaceId
          ),
        }));
      res.json({ success: true, data: turns });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /turns/:turnKey - Get stored Turn manifest only.
 */
router.get(
  "/turns/:turnKey",
  async (req: Request, res: Response<HttpResponse<RetainedWorkspaceManifest>>) => {
    try {
      const manifest = loadManifest(req.params.turnKey);

      if (!manifest) {
        res.status(404).json({ success: false, error: "Turn workspace not found" });
        return;
      }

      const keptKeys = await getArtifactRetentionSnapshot();
      res.json({
        success: true,
        data: {
          ...manifest,
          kept: hasArtifactRetention(keptKeys, "turn-workspace", req.params.turnKey),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * DELETE /turns/:turnKey - Delete a Turn workspace.
 */
router.delete("/turns/:turnKey", async (req: Request, res: Response<HttpAcknowledgement>) => {
  try {
    const deleted = deleteWorkspace(req.params.turnKey);
    if (!deleted) {
      res.status(404).json({ success: false, error: "Turn workspace not found" });
      return;
    }
    await clearArtifactRetentionBestEffort("turn-workspace", req.params.turnKey);
    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /turns/:turnKey/tree - File tree of Turn workspace.
 */
router.get(
  "/turns/:turnKey/tree",
  (req: Request, res: Response<HttpResponse<ArtifactFileTreeNode>>) => {
    try {
      const tree = getFileTree(req.params.turnKey);
      if (!tree) {
        res.status(404).json({ success: false, error: "Turn workspace not found" });
        return;
      }
      res.json({ success: true, data: tree });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /turns/:turnKey/files/* - Preview a file from Turn workspace.
 */
router.get(
  "/turns/:turnKey/files/*",
  async (req: Request, res: Response<HttpResponse<ArtifactFilePreview>>) => {
    try {
      const turnKey = req.params.turnKey;
      const relativePath = req.params[0] || "";

      if (!relativePath) {
        res.status(400).json({ success: false, error: "File path is required" });
        return;
      }

      const preview = await readWorkspaceFilePreview(turnKey, relativePath);
      if (preview === null) {
        res.status(404).json({ success: false, error: "File not found" });
        return;
      }
      res.json({ success: true, data: preview });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /turns/:turnKey/download - Download Turn workspace as zip.
 */
router.get("/turns/:turnKey/download", (req: Request, res: Response) => {
  try {
    const turnKey = req.params.turnKey;
    const zipBuffer = createWorkspaceZip(turnKey);

    if (!zipBuffer) {
      res.status(404).json({ success: false, error: "Turn workspace not found" });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="turn-${turnKey}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /turns/:turnKey/timeline - Get Turn timeline.
 */
router.get(
  "/turns/:turnKey/timeline",
  (req: Request, res: Response<HttpResponse<TimelineEvent[]>>) => {
    try {
      const stored = readWorkspaceFile(req.params.turnKey, `${WORKSPACE_DIRS.DIAGNOSTICS}/timeline.json`);
      if (!stored) {
        res.status(404).json({ success: false, error: "Stored timeline not found" });
        return;
      }

      res.json({ success: true, data: JSON.parse(stored) });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

/**
 * GET /turns/:turnKey/flowchart - Get Turn flowchart.
 */
router.get("/turns/:turnKey/flowchart", (req: Request, res: Response<HttpResponse<Flowchart>>) => {
  try {
    const stored = readWorkspaceFile(req.params.turnKey, `${WORKSPACE_DIRS.DIAGNOSTICS}/flowchart.json`);
    if (!stored) {
      res.status(404).json({ success: false, error: "Stored flowchart not found" });
      return;
    }

    res.json({ success: true, data: JSON.parse(stored) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/* ================================================================== */
/*  Log Queries                                                       */
/* ================================================================== */

/**
 * GET /logs - Query main app logs.
 */
router.get("/logs", (req: Request, res: Response<HttpResponse<ParsedLogRecord[]>>) => {
  try {
    // Logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
    requireDomainId(req as AuthenticatedRequest);
    const params: LogQueryParams = {
      turnKey: req.query.turnKey as string | undefined,
      level: req.query.level as LogLevel | undefined,
      keyword: req.query.keyword as string | undefined,
      startTime: req.query.startTime as string | undefined,
      endTime: req.query.endTime as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const logs = queryAppLogs(params);
    res.json({ success: true, data: logs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /llm-calls - Query LLM call logs.
 */
router.get("/llm-calls", (req: Request, res: Response<HttpResponse<ParsedLogRecord[]>>) => {
  try {
    // Logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
    requireDomainId(req as AuthenticatedRequest);
    const params: LlmQueryParams = {
      turnKey: req.query.turnKey as string | undefined,
      agentName: req.query.agentName as string | undefined,
      startTime: req.query.startTime as string | undefined,
      endTime: req.query.endTime as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const logs = queryLlmCalls(params);
    res.json({ success: true, data: logs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /backend-logs - Query backend logs through turnKey -> query run -> sessions -> node windows.
 */
router.get(
  "/backend-logs",
  async (req: Request, res: Response<HttpResponse<ParsedLogRecord[]>>) => {
    try {
      // Backend logs are environment-level evidence and their content is not filtered by domain; callers must still carry a business domain.
      requireDomainId(req as AuthenticatedRequest);
      const params: BackendLogQueryParams = {
        turnKey: req.query.turnKey as string | undefined,
        keyword: req.query.keyword as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      };

      if (!params.turnKey) {
        res.status(400).json({ success: false, error: "turnKey is required" });
        return;
      }

      const logs = await queryBackendLogs(params, { token: (req as AuthenticatedRequest).token });
      res.json({ success: true, data: logs });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

export default router;
