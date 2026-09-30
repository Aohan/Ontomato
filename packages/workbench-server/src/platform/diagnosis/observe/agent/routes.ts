import type { HttpResponse, HttpAcknowledgement } from "@ontomato/contracts/http";
import type {
  SessionHistorySnapshot,
  SessionInfo,
  SessionStopResult,
  SessionContext,
} from "@ontomato/contracts/diagnosis";
import { requireDomainId, type AuthenticatedRequest } from "../../../../utils/request-identity";
/**
 * Diagnostic Agent API routes.
 *
 * Mounted at /api/observe/agent in server.ts.
 *
 * Routes:
 *   POST   /chat              - Diagnostic chat (SSE streaming)
 *   GET    /sessions          - List sessions
 *   POST   /sessions          - Create session
 *   GET    /sessions/:id/history - Session history snapshot
 *   GET    /sessions/:id/stream  - Subscribe/replay current response
 *   POST   /sessions/:id/stop    - Explicitly stop current response
 *   DELETE /sessions/:id      - Delete session
 */

import { Request, Response, Router } from "express";

import { createLogger } from "../../../../logging/logger";
import { diagnosisManager } from "./pi-agent";

import { SESSION_CONTEXT_PAGES, normalizeSessionContext } from "./session-types";
import { subscribeResponseStream, writeUnavailableStream } from "./sse-bridge";
import knowledgeRouter from "./knowledge-routes";

const router: ReturnType<typeof Router> = Router();

router.use("/knowledge", knowledgeRouter);
const logger = createLogger("observe:agent");

/* ================================================================== */
/*  Diagnostic Chat (SSE)                                              */
/* ================================================================== */

router.post("/chat", async (req: Request, res: Response, next) => {
  try {
    const { sessionId, message } = req.body as {
      sessionId?: string;
      message?: string;
    };

    if (!sessionId || typeof message !== "string" || !message.trim()) {
      res.status(400).json({
        success: false,
        code: "INVALID_CHAT_INPUT",
        error: "sessionId and message are required",
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const domainId = requireDomainId(authReq);
    const token = authReq.token || undefined;
    const apiKey = authReq.apiKey || undefined;

    logger.info("Diagnostic chat request", {
      sessionId,
      messageLength: message.trim().length,
    });

    const started = await diagnosisManager.startChat(
      sessionId,
      message.trim(),
      { domainId, token, apiKey }
    );
    if (!started.ok) {
      res.status(started.status).json({
        success: false,
        code: started.code,
        error: started.error,
      });
      return;
    }

    subscribeResponseStream(req, res, started.stream);
  } catch (error) {
    next(error);
  }
});

/* ================================================================== */
/*  Session Management                                                 */
/* ================================================================== */

router.get("/sessions", async (_req: Request, res: Response<HttpResponse<SessionInfo[]>>) => {
  try {
    const sessions = await diagnosisManager.listSessions();
    res.json({ success: true, data: sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list sessions", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

router.post("/sessions", async (req: Request, res: Response<HttpResponse<SessionInfo>>) => {
  try {
    const { title, context } = req.body as {
      title?: string;
      context?: SessionContext;
    };

    const normalizedContext = context ? normalizeSessionContext(context) : undefined;
    if (context && !normalizedContext) {
      res.status(400).json({
        success: false,
        error: `Invalid context.page: must be one of ${SESSION_CONTEXT_PAGES.join(", ")}`,
      });
      return;
    }

    const session = await diagnosisManager.createSession({
      title,
      context: normalizedContext,
    });
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create session", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

router.get(
  "/sessions/:id/history",
  async (req: Request, res: Response<HttpResponse<SessionHistorySnapshot>>) => {
    try {
      const sessionId = req.params.id;
      const snapshot = await diagnosisManager.getSessionHistory(sessionId);
      if (!snapshot) {
        res.status(404).json({
          success: false,
          code: "SESSION_NOT_FOUND",
          error: "Session not found",
        });
        return;
      }
      res.json({ success: true, data: snapshot });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: msg });
    }
  }
);

router.get("/sessions/:id/stream", async (req: Request, res: Response, next) => {
  try {
    const sessionId = req.params.id;
    if (!(await diagnosisManager.hasSession(sessionId))) {
      res.status(404).json({
        success: false,
        code: "SESSION_NOT_FOUND",
        error: "Session not found",
      });
      return;
    }

    const stream = diagnosisManager.getResponseStream(sessionId);
    if (!stream) {
      writeUnavailableStream(res);
      return;
    }
    subscribeResponseStream(req, res, stream);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/sessions/:id/stop",
  async (req: Request, res: Response<HttpResponse<SessionStopResult>>, next) => {
    try {
      const sessionId = req.params.id;
      if (!(await diagnosisManager.hasSession(sessionId))) {
        res.status(404).json({
          success: false,
          code: "SESSION_NOT_FOUND",
          error: "Session not found",
        });
        return;
      }

      const cancelled = diagnosisManager.stopSession(sessionId);
      res.json({ success: true, data: { cancelled } });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/sessions/:id", async (req: Request, res: Response<HttpAcknowledgement>) => {
  try {
    const sessionId = req.params.id;
    const deleted = await diagnosisManager.deleteSession(sessionId);

    if (!deleted) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete session", { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
