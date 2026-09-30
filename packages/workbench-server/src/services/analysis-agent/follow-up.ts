import type { AnalysisFollowUpEvent } from "@ontomato/contracts/analysis-events";
import { createModel } from "../../config/model-factory";
import { modelAgentName } from "../../logging/model-agents";
import { renderPrompt } from "../../core/prompts/loader";
import { createLogger } from "../../logging/logger";
import { createSseErrorEvent } from "../../utils/sse";
import { allocateRequestSeq } from "../chat/thread-store";
import { upsertChatRenderSnapshot } from "../chat/chat-snapshot-store";
import { getAnalysisTaskService } from "./task/task-service";
import { tApp } from "../../i18n";


const logger = createLogger("api:analysis-agents");
type FollowUpRun = { id: string; userId: string; domainId: string; controller: AbortController };
type FollowUpStreamStore = {
  appendJson(runId: string, data: AnalysisFollowUpEvent, terminal?: boolean): unknown;
  finishRun(runId: string, status: "completed" | "failed" | "cancelled"): void;
};

export async function runAnalysisFollowUp(
  message: string,
  threadId: string,
  agentId: string,
  run: FollowUpRun,
  runStreamStore: FollowUpStreamStore
): Promise<void> {
  try {
    let analysisContext = "";
    try {
      const latestTask = await getAnalysisTaskService().getLatestTaskByThread(
        threadId,
        run.domainId
      );
      const deepAnalysis = latestTask?.analysisPayload;
      if (deepAnalysis) {
        const contextParts: string[] = [];
        contextParts.push(tApp("analysis.follow-up.197"));
        for (const activity of deepAnalysis.activities) {
          for (const q of activity.questions || []) {
            const marker = q.status === "completed" ? "✓" : q.status === "failed" ? "✗" : "○";
            contextParts.push(`- ${marker} ${q.question}${q.error ? tApp("analysis.follow-up.198", { error: q.error }) : ""}`);
          }
        }
        for (const section of [...deepAnalysis.sections].sort((a, b) => a.order - b.order)) {
          if (section.title) contextParts.push(`## ${section.title}`);
          contextParts.push(section.markdown, "");
        }
        if (deepAnalysis.finalAnswer) contextParts.push(deepAnalysis.finalAnswer);
        analysisContext = contextParts.join("\n");
      }
    } catch (err) {
      logger.warn(tApp("analysis.follow-up.199"), { error: err });
    }
    if (!analysisContext) {
      logger.warn(tApp("analysis.follow-up.200"));
    }
    const systemPrompt = analysisContext
      ? renderPrompt("analysis-agent.follow-up.with-context.system", { analysisContext })
      : renderPrompt("analysis-agent.follow-up.without-context.system");
    const model = await createModel({ agentName: modelAgentName("followUp"), temperature: 0.7, stream: true });
    let fullResponse = "";
    const stream = await model.stream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      { signal: run.controller.signal }
    );
    for await (const chunk of stream) {
      if (run.controller.signal.aborted) break;
      const content = typeof chunk.content === "string" ? chunk.content : "";
      if (!content) continue;
      fullResponse += content;
      runStreamStore.appendJson(run.id, { type: "follow_up_chunk", content });
    }

    if (run.controller.signal.aborted) {
      logger.info(tApp("analysis.follow-up.201"), { threadId, agentId });
      runStreamStore.finishRun(run.id, "cancelled");
      return;
    }

    runStreamStore.appendJson(
      run.id,
      {
        type: "workflow_complete",
        timestamp: Date.now(),
      },
      true
    );
    runStreamStore.finishRun(run.id, "completed");

    if (fullResponse) {
      try {
        const requestSeq = await allocateRequestSeq(threadId);
        await upsertChatRenderSnapshot({
          threadId,
          requestSeq,
          snapshot: {
            mode: "follow-up",
            status: "completed",
            primaryText: fullResponse,
            followUpUserMessage: message,
          },
          source: "runtime",
        });
        logger.info(tApp("analysis.follow-up.202"), { threadId });
      } catch (err) {
        logger.warn(tApp("analysis.follow-up.203"), { error: err });
      }
    }

    logger.info(tApp("analysis.follow-up.204"), { threadId, responseLength: fullResponse.length });
  } catch (error: unknown) {
    if (run.controller.signal.aborted) {
      logger.info(tApp("analysis.follow-up.201"), { threadId, agentId });
      runStreamStore.finishRun(run.id, "cancelled");
      return;
    }
    logger.error(tApp("analysis.follow-up.205"), error);
    runStreamStore.appendJson(run.id, createSseErrorEvent(error), true);
    runStreamStore.finishRun(run.id, "failed");
  }
}
