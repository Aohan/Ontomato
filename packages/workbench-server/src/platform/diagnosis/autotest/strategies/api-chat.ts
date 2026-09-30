import type { ChatClientEvent } from "@ontomato/contracts/chat";
/**
 * API Chat execution strategy.
 *
 * Directly invokes runDataAgentWorkflow (no HTTP round-trip).
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../../../../logging/logger";
import { buildTurnIdentity, runWithTurnContext } from "../../../../logging/log-context";
import { runDataAgentWorkflow } from "../../../../services/chat/graph/workflow";
import { initializeConnection } from "../../../../infrastructure/connection";
import { convertEventForFrontend } from "../../../../services/chat/event-projection";
import { autotestConfig } from "../config";
import type { ExecutionResult } from "../types";
import { workbenchIdentity } from "../../../../identity/installed";
import { tApp } from "../../../../i18n";


const logger = createLogger("autotest:api-chat");

export interface ApiChatOptions {
  domainId: string;
  question: string;
  threadId?: string;
  userId?: string;
  tk?: string;
  signal?: AbortSignal;
  caseTimeoutMs?: number;
  /**
   * Stage-level progress callback (e.g. workflow node switches).
   * Only stage events are reported, never the token stream. Failures here
   * must not affect case execution -- callers are expected to be side-effect
   * only, and this strategy guards every invocation in a try-catch.
   */
  onStep?: (label: string) => void;
}

type ChatThreadStore = typeof import("../../../../services/chat/thread-store");
type TurnRunStore = typeof import("../../../../services/turn-run/turn-run-store");
type ApiChatStorage = Pick<ChatThreadStore, "allocateRequestSeq" | "createThreadPlaceholder"> &
  Pick<TurnRunStore, "recordTurnRunStart" | "recordTurnRunFinish">;

let apiChatStorage: ApiChatStorage;

export function setApiChatStorage(storage: ApiChatStorage): void {
  apiChatStorage = storage;
}

/**
 * Execute a single question via the data-agent workflow and aggregate results.
 */
export async function executeApiChat(options: ApiChatOptions): Promise<ExecutionResult> {
  const {
    question,
    threadId = `autotest-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    tk = "",
    signal,
    caseTimeoutMs = autotestConfig.caseTimeoutMs,
    onStep,
  } = options;

  const reportStep = (label: string): void => {
    if (!onStep) return;
    try {
      onStep(label);
    } catch (err) {
      logger.warn("onStep callback threw (ignored)", {
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const tokens: string[] = [];
  const analysisTokens: string[] = [];
  let abcContent = "";
  let turnKey: string | undefined;
  let errorMessage: string | undefined;
  let unresolvedClarificationMessage: string | undefined;

  const startTime = Date.now();

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), caseTimeoutMs);

  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  logger.debug("Executing workflow directly", {
    threadId,
    questionLength: question.length,
  });

  const resetOutputBuffers = (): void => {
    tokens.length = 0;
    analysisTokens.length = 0;
    abcContent = "";
  };

  const runWorkflowAttempt = async (
    attemptQuestion: string
  ): Promise<{ sawClarification: boolean; message?: string }> => {
    resetOutputBuffers();
    let sawClarification = false;
    let clarificationMessage: string | undefined;
    await initializeConnection();
    const actor = await workbenchIdentity().resolveAutotestActor({
      token: tk,
      domainId: options.domainId,
    });
    const userId = actor.userId;
    const domainId = actor.domainId;
    await apiChatStorage.createThreadPlaceholder(threadId, question.slice(0, 20), userId, domainId);
    const requestSeq = await apiChatStorage.allocateRequestSeq(threadId);
    const turn = buildTurnIdentity(threadId, requestSeq);
    turnKey = turn.turnKey;
    await apiChatStorage.recordTurnRunStart({
      threadId,
      requestSeq,
      source: "autotest",
    });

    let turnStatus: "completed" | "failed" | "cancelled" = "completed";
    try {
      await runWithTurnContext(turn, () =>
        runDataAgentWorkflow({
          userQuestion: attemptQuestion,
          userDisplayQuestion: attemptQuestion,
          userId,
          domainId,
          threadId,
          token: tk || undefined,
          requestSeq,
          signal: combinedSignal,
          onEvent: (event) => {
            if (
              event?.type === "progress" &&
              ["router", "clarification", "planner"].includes(String(event.node || "")) &&
              typeof event.content === "string"
            ) {
              reportStep(event.content);
            }

            const frontendEvent = convertEventForFrontend(event);
            if (!frontendEvent) return;

            // Reports stage-level node switches (e.g. query data / analyze data / generate charts).
            // Never report token/analysis_token -- only stage events.
            if (frontendEvent.type === "chain_start" && typeof frontendEvent.name === "string") {
              reportStep(frontendEvent.name);
            }

            if (frontendEvent.type === "clarification") {
              const optionCount = Array.isArray(frontendEvent.options)
                ? frontendEvent.options.length
                : 0;
              clarificationMessage =
                typeof frontendEvent.message === "string" && frontendEvent.message.trim()
                  ? frontendEvent.message.trim()
                  : tApp("diag.autotest.strategies.api-chat.0");
              sawClarification = true;
              reportStep(
                optionCount > 0 ? tApp("diag.autotest.strategies.api-chat.1", { p0: optionCount }) : tApp("diag.autotest.strategies.api-chat.2")
              );
              return;
            }

            handleEvent(frontendEvent, tokens, analysisTokens, (c) => {
              abcContent = c;
            });
          },
        })
      );

      if (combinedSignal.aborted) {
        turnStatus = timeoutController.signal.aborted ? "failed" : "cancelled";
      }
    } catch (error) {
      turnStatus = combinedSignal.aborted
        ? timeoutController.signal.aborted
          ? "failed"
          : "cancelled"
        : "failed";
      throw error;
    } finally {
      await apiChatStorage.recordTurnRunFinish({
        threadId,
        requestSeq,
        status: turnStatus,
      });
    }

    return { sawClarification, message: clarificationMessage };
  };

  try {
    const firstAttempt = await runWorkflowAttempt(question);
    if (firstAttempt.sawClarification) {
      const bypassQuestion = buildClarificationBypassQuestion(question);
      reportStep(tApp("diag.autotest.strategies.api-chat.3"));

      const bypassAttempt = await runWorkflowAttempt(bypassQuestion);
      if (bypassAttempt.sawClarification) {
        unresolvedClarificationMessage =
          bypassAttempt.message || firstAttempt.message || tApp("diag.autotest.strategies.api-chat.0");
      }
    }
  } catch (err) {
    if (combinedSignal.aborted) {
      const finalAnswer = buildFinalAnswer(tokens, analysisTokens, abcContent);
      const timedOut = timeoutController.signal.aborted;
      clearTimeout(timeoutId);
      return {
        turnKey,
        finalAnswer,
        durationMs: Date.now() - startTime,
        status: timedOut ? "error" : "cancelled",
        error: timedOut ? "Case timeout exceeded" : "Request aborted",
      };
    }
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Workflow execution failed", { threadId, error: errorMessage });
  }

  clearTimeout(timeoutId);

  const durationMs = Date.now() - startTime;
  const finalAnswer = buildFinalAnswer(tokens, analysisTokens, abcContent);
  if (unresolvedClarificationMessage && !errorMessage) {
    errorMessage = tApp("diag.autotest.strategies.api-chat.4", { p0: unresolvedClarificationMessage });
  }

  let status: ExecutionResult["status"] = "success";
  if (timeoutController.signal.aborted) {
    // The workflow may swallow the abort and return normally exactly as the
    // case timeout fires. Mirror the catch path so a timed-out case is never
    // reported as success.
    status = "error";
    errorMessage = "Case timeout exceeded";
  } else if (signal?.aborted) {
    status = "cancelled";
    if (!errorMessage) errorMessage = "Cancelled";
  } else if (errorMessage) {
    status = "error";
  }

  logger.debug("Execution complete", {
    threadId,
    status,
    durationMs,
    answerLength: finalAnswer?.length ?? 0,
  });

  return {
    turnKey,
    finalAnswer,
    durationMs,
    status,
    error: errorMessage,
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function handleEvent(
  event: ChatClientEvent,
  tokens: string[],
  analysisTokens: string[],
  setAbcContent: (content: string) => void
): void {
  const type = event.type;
  if (!type) return;

  switch (type) {
    case "token":
      if (typeof event.content === "string") tokens.push(event.content);
      break;
    case "analysis_token":
      if (typeof event.content === "string") analysisTokens.push(event.content);
      break;
    case "abc_content":
      if (typeof event.content === "string") setAbcContent(event.content);
      break;
    case "error":
      break;
    default:
      break;
  }
}

function buildFinalAnswer(
  tokens: string[],
  analysisTokens: string[],
  abcContent: string
): string | undefined {
  if (analysisTokens.length > 0) return analysisTokens.join("");
  if (abcContent) return abcContent;
  if (tokens.length > 0) return tokens.join("");
  return undefined;
}

function buildClarificationBypassQuestion(question: string): string {
  return tApp("diag.autotest.strategies.api-chat.5", { p0: question });
}
