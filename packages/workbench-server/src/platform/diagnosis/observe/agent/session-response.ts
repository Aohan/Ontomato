import { createLogger } from "../../../../logging/logger";
import { createSseErrorEvent } from "../../../../utils/sse";
import type { AssistantMessage } from "../../../../core/agent-loop/types";
import { harnessSessions } from "../../../../infrastructure/harness-sessions";
import type { ManagedSession } from "./session-runtime";
import type { SessionResponseStream } from "./session-stream";
import { toDiagnosisStreamEvent } from "./sse-bridge";

import { runWithLogContext } from "../../../../logging/log-context";

export const logger: ReturnType<typeof createLogger> = createLogger("observe:pi-agent");

function lastAssistant(messages: readonly AssistantMessage[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

export async function executeResponse(
  sessionId: string,
  managed: ManagedSession,
  message: string,
  stream: SessionResponseStream,
  turnId: string
): Promise<void> {
  return runWithLogContext(
    { domainId: managed.caller.domainId, token: managed.caller.token, apiKey: managed.caller.apiKey },
    async () => {
      let status: "completed" | "failed" | "cancelled" = "completed";
      let errorMessage: string | undefined;
      let unsubscribe = () => {};

      logger.info("Chat started", { sessionId, targetKey: managed.context?.targetKey });
      stream.append({ type: "response_started", message });
  try {
    const agent = managed.agent;
    if (!agent) throw new Error("Diagnosis response has no agent");
    unsubscribe = agent.subscribe((event) => {
      const streamEvent = toDiagnosisStreamEvent(event);
      if (streamEvent) stream.append(streamEvent);
    });
    await agent.prompt(message, stream.controller.signal);

    if (stream.controller.signal.aborted) {
      status = "cancelled";
    } else {
      const finalAssistant = lastAssistant(
        agent.state.messages.filter((item): item is AssistantMessage => item.role === "assistant")
      );
      if (finalAssistant?.stopReason === "error") {
        status = "failed";
        errorMessage = finalAssistant.errorMessage || "Model response failed";
      } else if (finalAssistant?.stopReason === "aborted") {
        status = "cancelled";
      }
    }
  } catch (error) {
    status = stream.controller.signal.aborted ? "cancelled" : "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    if (status === "cancelled") logger.info("Chat cancellation observed", { sessionId });
    else logger.error("Chat failed", { sessionId, error: errorMessage });
  } finally {
    unsubscribe();
    try {
      await harnessSessions.finishTurn(sessionId, turnId, status);
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to persist diagnosis response terminal state", {
        sessionId,
        error: errorMessage,
      });
    }
    stream.append(
      status === "failed"
        ? createSseErrorEvent(errorMessage || "Model response failed")
        : { type: "response_end", status }
    );
    logger.info("Chat finished", { sessionId, status });
  }
}
  );
}
