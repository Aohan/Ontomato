import type { RunNotFoundEvent } from "@ontomato/contracts/chat";
import type { ChatClientEvent } from "@ontomato/contracts/chat";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { runDataAgentWorkflow } from "../../services/chat/graph/workflow";
import { initializeConnection } from "../../infrastructure/connection";
import { startStandardTurn } from "../../services/chat/thread-store";
import { createLogger } from "../../logging/logger";
import { createSseErrorEvent, initializeSse } from "../../utils/sse";
import { AuthFailedError } from "../../utils/backend-client";
import { buildTurnIdentity, runWithTurnContext } from "../../logging/log-context";
import { recordTurnRunFinish } from "../../services/turn-run/turn-run-store";
import { convertEventForFrontend } from "../../services/chat/event-projection";
import { runStreamStore, requireRunAccess, type RunRecord } from "../utils/run-stream";
import { generateTitleAsync } from "../utils/title";
import { setLocale, t, tApp, type Locale } from "../../i18n";
import { asyncHandler } from "../utils/http";
import { HttpError } from "../../utils/errors";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { getCheckpointer } from "../../infrastructure/connection";
import { rateLimiter, validateBody, validateQuery } from "../middleware";
const router: ReturnType<typeof Router> = Router();
const logger = createLogger("api:chat");

function chatRunKey(threadId: string): string {
  return `chat:${threadId}`;
}

function runWithOptionalTurn<T>(run: RunRecord | undefined, fn: () => T): T {
  return run?.turn ? runWithTurnContext(run.turn, fn) : fn();
}

function sendRunNotFound(res: Response) {
  initializeSse(res);
  res.write(
    `data: ${JSON.stringify({
      type: "run_not_found",
      timestamp: Date.now(),
    } satisfies RunNotFoundEvent)}\n\n`
  );
  res.end();
}

const ChatQuerySchema = z.object({
  message: z.string().min(1, "message is required"),
  displayMessage: z.string().optional(),
  threadId: z.string().optional(),
  locale: z.string().optional(),
  runId: z.string().optional(),
});

const GenerateTitleBodySchema = z.object({
  message: z.string().min(1),
  threadId: z.string().min(1),
});

router.post(
  "/:threadId/cancel",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const runId = String(req.query.runId || req.body?.runId || "").trim();
    const run = runId
      ? runStreamStore.getRun(runId)
      : runStreamStore.getActiveRunByKey(chatRunKey(threadId));
    if (run) requireRunAccess(run, req as AuthenticatedRequest, chatRunKey(threadId));

    runWithOptionalTurn(run, () => {
      const cancelled = run ? runStreamStore.cancelByRunId(run.id) : false;
      logger.info(tApp("foundation.log.chat.cancelReq"), {
        threadId,
        runId: run?.id || runId || undefined,
        cancelled,
      });
      res.json({
        success: true,
        cancelled,
        ...(run?.turn ? { turnKey: run.turn.turnKey, requestSeq: run.turn.requestSeq } : {}),
      });
    });
  })
);

router.get(
  "/:threadId/stream",
  asyncHandler(async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId || "").trim();
    const run = runStreamStore.getActiveRunByKey(chatRunKey(threadId));
    if (!run) {
      sendRunNotFound(res);
      return;
    }
    runWithOptionalTurn(run, () => runStreamStore.subscribe(req, res, run));
  })
);

router.get(
  "/",
  rateLimiter({ maxRequests: 30, windowSeconds: 60 }),
  validateQuery(ChatQuerySchema as z.ZodTypeAny),
  asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const {
      message,
      displayMessage,
      threadId: queryThreadId,
      locale,
      runId: queryRunId,
    } = req.query as unknown as z.infer<typeof ChatQuerySchema>;

    const threadId = queryThreadId || `thread-${Date.now()}`;
    const userId = authReq.userId;
    const domainId = requireDomainId(authReq);
    const token = authReq.token;
    const displayMsg = displayMessage || message;

    setLocale(locale as Locale);

    const runId = queryRunId || `chat-${threadId}-${Date.now()}`;
    // The same runId means an EventSource reconnect; replay that run directly.
    const existingRun = runStreamStore.getRun(runId);
    if (existingRun) {
      requireRunAccess(existingRun, authReq, chatRunKey(threadId));
      runWithOptionalTurn(existingRun, () => runStreamStore.subscribe(req, res, existingRun));
      return;
    }

    // Occupy the thread key before any async initialization; a new question must not replace a running server-side task.
    const run = runStreamStore.reserveRun({ runId, key: chatRunKey(threadId), userId, domainId });
    if (!run) {
      const activeRun = runStreamStore.getActiveRunByKey(chatRunKey(threadId));
      if (activeRun) requireRunAccess(activeRun, authReq, chatRunKey(threadId));
      throw new HttpError(409, "chat run already active", undefined, {
        activeRunId: activeRun?.id,
      });
    }
    runStreamStore.subscribe(req, res, run);

    let requestSeq: number;
    try {
      await initializeConnection();
      requestSeq = await startStandardTurn({
        threadId,
        userId,
        domainId,
        title: t("checkpointer.newConversation"),
        displayMessage: displayMsg,
      });
    } catch (error) {
      if (run.controller.signal.aborted) return;
      const errorMessage = error instanceof Error ? error.message : String(error);
      runStreamStore.appendJson(run.id, createSseErrorEvent(errorMessage), true);
      runStreamStore.finishRun(run.id, "failed");
      logger.error(tApp("foundation.log.chat.initFailed"), {
        threadId,
        error: errorMessage,
      });
      return;
    }

    const turn = buildTurnIdentity(threadId, requestSeq);
    run.turn = turn;
    const finishTurnRun = (status: "completed" | "failed" | "cancelled") =>
      recordTurnRunFinish({ threadId, requestSeq, status });

    if (run.controller.signal.aborted) {
      await finishTurnRun("cancelled");
      return;
    }

    await runWithTurnContext(turn, async () => {
      logger.info(tApp("foundation.log.chat.started"), {
        threadId,
        requestSeq,
        messageLength: message.length,
      });

      try {
        runStreamStore.appendJson(run.id, {
          type: "turn_key",
          turnKey: turn.turnKey,
          threadId,
          requestSeq,
          timestamp: Date.now(),
        } satisfies ChatClientEvent);

        runStreamStore.appendJson(run.id, {
          type: "run_started",
          runId: run.id,
          threadId,
          requestSeq,
          turnKey: turn.turnKey,
          timestamp: Date.now(),
        } satisfies ChatClientEvent);

        if (requestSeq === 0) {
          generateTitleAsync(message, threadId, userId, domainId)
            .then((title) => {
              if (title) {
                runStreamStore.appendJson(run.id, {
                  type: "title",
                  title,
                } satisfies ChatClientEvent);
              }
            })
            .catch((error) => {
              logger.warn(tApp("foundation.log.title.failed"), {
                threadId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }

        const finalState = await runDataAgentWorkflow({
          userQuestion: message,
          userDisplayQuestion: displayMsg || message,
          userId,
          domainId,
          threadId,
          requestSeq,
          onEvent: (event) => {
            const frontendEvent = convertEventForFrontend(event);
            if (frontendEvent) {
              runStreamStore.appendJson(run.id, frontendEvent);
            }
          },
          token,
          locale,
          apiKey: authReq.apiKey,
          signal: run.controller.signal,
        });

        if (run.controller.signal.aborted) {
          logger.info(tApp("foundation.log.chat.cancelled"), { userId, threadId, requestSeq });
          await finishTurnRun("cancelled");
          runStreamStore.finishRun(run.id, "cancelled");
          return;
        }

        if (finalState) {
          const runtimeVisualization = finalState.runtimeArtifacts?.visualizationResult;
          const runtimeQuery = finalState.runtimeArtifacts?.queryResult;
          const runtimeAnalysis = finalState.runtimeArtifacts?.analysisResult;

          if (runtimeVisualization?.result?.html) {
            logger.info(tApp("foundation.log.chat.sendViz"), {
              threadId,
              requestSeq,
              requestHasVisualization: true,
              htmlLength: runtimeVisualization.result.html.length,
            });
            runStreamStore.appendJson(run.id, {
              type: "visualization_html",
              html: runtimeVisualization.result.html,
              chartType: runtimeVisualization.result.chartType,
              title: runtimeVisualization.result.title,
            } satisfies ChatClientEvent);
          }

          runStreamStore.appendJson(run.id, {
            type: "workflow_complete",
            plan: finalState.plan,
            hasQuery: !!runtimeQuery || !!finalState.queryArtifactRef,
            hasAnalysis: !!runtimeAnalysis || !!finalState.analysisArtifactRef,
            hasVisualization: !!runtimeVisualization || !!finalState.visualizationArtifactRef,
          } satisfies ChatClientEvent);

          logger.info(tApp("foundation.log.chat.completed"), {
            userId,
            threadId,
            requestSeq,
            hasQuery: !!runtimeQuery || !!finalState.queryArtifactRef,
            hasAnalysis: !!runtimeAnalysis || !!finalState.analysisArtifactRef,
            hasVisualization: !!runtimeVisualization || !!finalState.visualizationArtifactRef,
            nodeCount: Array.isArray(runtimeQuery?.nodeIds) ? runtimeQuery.nodeIds.length : 0,
          });
        }

        // One execution covers the workflow execution plus the settlement of late facts registered on it; this turn's display
        // includes the quality-check panel, so the subscription channel closes only after both finalize. Past the bounded limit, waiting is abandoned.
        await finalState.pendingLateFacts?.settleAll();

        // The user can still cancel while late facts are awaited; cancellation is not completion and is re-evaluated before finalization.
        if (run.controller.signal.aborted) {
          logger.info(tApp("foundation.log.chat.cancelledLate"), { userId, threadId, requestSeq });
          await finishTurnRun("cancelled");
          runStreamStore.finishRun(run.id, "cancelled");
          return;
        }

        runStreamStore.appendRaw(run.id, "[DONE]", true);
        await finishTurnRun("completed");
        runStreamStore.finishRun(run.id, "completed");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (run.controller.signal.aborted) {
          logger.info(tApp("foundation.log.chat.cancelled"), { userId, threadId, requestSeq });
          await finishTurnRun("cancelled");
          runStreamStore.finishRun(run.id, "cancelled");
          return;
        }
        logger.error(tApp("foundation.log.chat.failed"), { userId, threadId, requestSeq, error: errorMessage });
        await finishTurnRun("failed");
        if (error instanceof AuthFailedError) {
          runStreamStore.appendJson(
            run.id,
            { type: "auth_failed", error: errorMessage } satisfies ChatClientEvent,
            true
          );
        } else {
          runStreamStore.appendJson(run.id, createSseErrorEvent(errorMessage), true);
        }
        runStreamStore.finishRun(run.id, "failed");
      }
    });
  })
);

router.post(
  "/generate-title",
  validateBody(GenerateTitleBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { message, threadId } = req.body as z.infer<typeof GenerateTitleBodySchema>;
    const authReq = req as AuthenticatedRequest;
    const domainId = requireDomainId(authReq);
    await getCheckpointer()?.verifyThreadAccess(threadId, authReq.userId, domainId);
    const title = await generateTitleAsync(message, threadId, authReq.userId, domainId);
    res.json({ success: true, title });
  })
);

export default router;
