import express, { Express, Request, Response, NextFunction, Router } from "express";
import cors from "cors";
import path from "path";
import { skillRegistryManager } from "../core/skills/index";
import { config } from "../config/application";
import { datasetSchemaService } from "../services/data-query/dataset-schema";
import analysisAgentsRouter from "../api/routes/analysis-agents";
import analysisReportsRouter from "../api/routes/analysis-reports";
import analysisTasksRouter from "../api/routes/analysis-tasks";
import backendProxyRouter from "../api/routes/backend-proxy";
import knowledgeGovernanceRouter from "../api/routes/knowledge-governance";
import chatRouter from "../api/routes/chat";
import dashboardsRouter from "../api/routes/dashboards";
import feedbackRouter from "../api/routes/feedback";
import memoriesRouter from "../api/routes/memories";
import mcpRouter from "../api/routes/mcp";
import analysisAgentMcpRouter from "../api/routes/analysis-agent-mcp";
import opsAgentMcpRouter from "../api/routes/ops-agent-mcp";
import preferencesRouter from "../api/routes/preferences";
import queryHistoryRouter from "../api/routes/query-history";
import reportsRouter from "../api/routes/reports";
import pptRouter from "../api/routes/ppt";
import skillsRouter from "../api/routes/skills";
import threadsRouter from "../api/routes/threads";
import autotestRouter from "../platform/diagnosis/autotest/routes";
import { setApiChatStorage } from "../platform/diagnosis/autotest/strategies/api-chat";
import observeRouter from "../platform/diagnosis/observe/routes";
import { setRunCompositionResolver } from "../platform/diagnosis/observe/workspaces/builder";
import { setTurnResolverStorage } from "../platform/diagnosis/observe/workspaces/turn-resolver";
import artifactRetentionRouter from "../platform/diagnosis/artifact-retention-routes";
import agentRouter from "../platform/diagnosis/observe/agent/routes";
import { syncRuntimeDefaultResources } from "../platform/runtime-defaults";
import systemModelConfigRouter from "../api/routes/system-model-config";
import workbenchAppearanceRouter from "../api/routes/workbench-appearance";
import { syncDefaultPrompts } from "../core/prompts/loader";
import { createLogger } from "../logging/logger";
import { initializeLogFileTransport } from "../logging/log-file-transport";
import { generateRequestId, runWithLogContext, runWithRequestContext } from "../logging/log-context";
import { startTaskScheduler } from "../services/analysis-agent/task/task-scheduler";
import { resolveAnalysisRunComposition } from "../services/analysis-agent/runtime/run-composition";
import * as queryRunStore from "../services/data-query/query-run-store";
import * as chatSnapshotStore from "../services/chat/chat-snapshot-store";
import * as chatThreadStore from "../services/chat/thread-store";
import * as executionEventStore from "../services/chat/execution-event-store";
import * as turnRunStore from "../services/turn-run/turn-run-store";
import { startArtifactCleanupScheduler } from "../platform/diagnosis/artifact-retention-cleanup";
import { initializeConnection } from "../infrastructure/connection";
import { requestLogger as accessLogger, errorHandler } from "../api/middleware";
import { getDefaultLocale, tApp } from "../i18n/index";
import { echartDir, webDistDir } from "../content/layout";
import { workbenchIdentity } from "../identity/installed";
import { workbenchProduct } from "../product/installed";

const logger = createLogger("server");
const SERVER_NOW_HEADER = "X-Server-Now";

export interface WorkbenchMounts {
  /** Enterprise SSO. Must run before the unified authenticate. OSS has no such route. */
  authRouter?: Router;
  /** Enterprise governance platform connection proxy. Absent in OSS. */
  connectionRouter?: Router;
  /** Enterprise governance platform SSO ticket. Absent in OSS. */
  dataGovernanceRouter?: Router;
}

let runtimeBound = false;

function bindRuntime(): void {
  if (runtimeBound) return;
  runtimeBound = true;
  setRunCompositionResolver(resolveAnalysisRunComposition);
  setTurnResolverStorage({
    getPrimaryQueryRun: queryRunStore.getPrimaryQueryRun,
    getQueryRunBySource: queryRunStore.getQueryRunBySource,
    listQueryRuns: queryRunStore.listQueryRuns,
    listExecutionEvents: executionEventStore.listExecutionEvents,
    listChatRenderSnapshots: chatSnapshotStore.listChatRenderSnapshots,
    getTurnRun: turnRunStore.getTurnRun,
  });
  setApiChatStorage({
    createThreadPlaceholder: chatThreadStore.createThreadPlaceholder,
    allocateRequestSeq: chatThreadStore.allocateRequestSeq,
    recordTurnRunStart: turnRunStore.recordTurnRunStart,
    recordTurnRunFinish: turnRunStore.recordTurnRunFinish,
  });
}

export function createWorkbenchApp(mounts: WorkbenchMounts = {}): Express {
  bindRuntime();
  const identity = workbenchIdentity();
  const product = workbenchProduct();
  const app: Express = express();
  const isDev = config.nodeEnv !== "production";

  app.use((req: Request, _res: Response, next: NextFunction) => {
    runWithRequestContext(generateRequestId(), () => next());
  });
  app.use(accessLogger);
  app.use(cors({ exposedHeaders: [SERVER_NOW_HEADER] }));
  app.use(express.json({ limit: "50mb" }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = ((body?: any) => {
      if (!res.headersSent) res.setHeader(SERVER_NOW_HEADER, String(Date.now()));
      return originalJson(body);
    }) as Response["json"];
    next();
  });

  if (mounts.authRouter) app.use("/api/auth", mounts.authRouter);
  app.use("/api/data-query", backendProxyRouter);
  app.use(product.proxyMountPath, backendProxyRouter);
  app.use("/mcp/analysis-agents", analysisAgentMcpRouter);
  app.use("/mcp/ops-agent", opsAgentMcpRouter);
  app.use(
    "/api/echart",
    express.static(echartDir(), {
      fallthrough: false,
      index: false,
      maxAge: "1d",
      redirect: false,
    })
  );

  app.use("/api/skills/resources", async (req: Request, res: Response, next: NextFunction) => {
    const verification = await identity.resolveSkillResourceDomain(req);
    if (!verification.ok) {
      res.status(verification.status).json({
        success: false,
        code: verification.code,
        error: verification.error,
      });
      return;
    }
    const { domainId } = verification;
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      await runWithLogContext(
        { domainId, token: verification.token, apiKey: verification.apiKey },
        async () => {
        await skillRegistryManager.forDomain(domainId);
        express.static(skillRegistryManager.getDomainSkillsRoot(domainId), { fallthrough: false })(
          req,
          res,
          next
        );
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/config.js", (_req: Request, res: Response) => {
    res.type("application/javascript");
    res.send(
      `window.__APP_CONFIG__ = ${JSON.stringify({
        API_BASE: config.apiBase,
        DEFAULT_LOCALE: getDefaultLocale(),
        ONTOLOGY_MANAGER_URL: config.ontologyManagerUrl,
      })};`
    );
  });

  app.use("/api", identity.authenticate);
  app.use("/api/analysis-agents", analysisAgentsRouter);
  app.use("/api/analysis-reports", analysisReportsRouter);
  app.use("/api/analysis-tasks", analysisTasksRouter);
  app.use("/api/chat", chatRouter);
  if (mounts.connectionRouter) app.use("/api/connections", mounts.connectionRouter);
  if (mounts.dataGovernanceRouter) app.use("/api/data-governance", mounts.dataGovernanceRouter);
  app.use("/api/knowledge-governance", knowledgeGovernanceRouter);
  app.use("/api/dashboards", dashboardsRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/preferences", preferencesRouter);
  app.use("/api/memories", memoriesRouter);
  app.use("/api/threads", threadsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/ppt", pptRouter);
  app.use("/api/skills", skillsRouter);
  app.use("/api/mcp", mcpRouter);
  app.use("/api/query-history", queryHistoryRouter);
  app.use(
    [
      "/api/observe/retention",
      "/api/observe/autotest/runs",
      "/api/observe/turns",
      "/api/observe/logs",
      "/api/observe/llm-calls",
      "/api/observe/backend-logs",
      "/api/observe/errors",
      "/api/observe/live-logs",
      "/api/observe/parse",
    ],
    identity.observeAccess
  );
  app.use("/api/observe/retention", artifactRetentionRouter);
  app.use("/api/observe/autotest", autotestRouter);
  app.use("/api/observe", observeRouter);
  app.use("/api/observe/agent", agentRouter);
  app.use("/api/system-model-config", systemModelConfigRouter);
  app.use("/api/workbench-appearance", workbenchAppearanceRouter);
  app.use(errorHandler);

  if (!isDev) {
    const staticPath = webDistDir();
    app.use(express.static(staticPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  return app;
}

export async function startWorkbench(app: Express, port: number): Promise<void> {
  const isDev = config.nodeEnv !== "production";
  initializeLogFileTransport();
  await syncRuntimeDefaultResources();
  syncDefaultPrompts();
  await initializeConnection();
  if (config.dataQuery.baseUrl) {
    datasetSchemaService.setConfig(config.dataQuery.baseUrl);
    logger.info(tApp("foundation.log.boot.datasetService"));
  }
  startTaskScheduler();
  logger.info(tApp("foundation.log.boot.schedulerStarted"));
  startArtifactCleanupScheduler();
  logger.info(tApp("foundation.log.boot.cleanupStarted"));
  app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    try {
      const pgUrl = new URL(config.postgres.connectionString);
      logger.info(tApp("foundation.log.boot.dbConnected"), { host: pgUrl.hostname, port: pgUrl.port || 5432 });
    } catch {
      logger.info(tApp("foundation.log.boot.dbConfigured"));
    }
    if (isDev) logger.info(tApp("foundation.log.boot.devFrontend"));
  });
}
