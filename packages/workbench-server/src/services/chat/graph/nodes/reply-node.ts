import { createModel } from "../../../../config/model-factory";
import { modelAgentName } from "../../../../logging/model-agents";
import { GraphState, GraphUpdate } from "../state";
import { createLogger } from "../../../../logging/logger";
import { t, tApp } from "../../../../i18n";
import { AIMessage } from "@langchain/core/messages";
import { buildAgentPromptMessages, resolveAgentPromptHistory } from "../utils/conversation-context";
import { estimateMessagesSize } from "../../../../utils/prompt-context";
import { upsertChatRenderSnapshot } from "../../chat-snapshot-store";
import { renderPrompt } from "../../../../core/prompts/loader";
import { datasetSchemaService } from "../../../data-query/dataset-schema";

const logger = createLogger("reply-node");

function buildDirectResponseSnapshot(primaryText: string, status: "completed" | "failed") {
  return {
    mode: "standard" as const,
    status,
    primaryText,
  };
}

export async function replyNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  const onEvent = config?.configurable?.onEvent;

  const sendEvent = (event: any) => {
    if (onEvent) {
      onEvent(event);
    }
  };

  try {
    const userQuestion = state.userQuestion;
    const token = config?.configurable?.token;
    const apiKey = config?.configurable?.apiKey;
    const taskReply = state.taskPlannerResult?.status === "reply" ? state.taskPlannerResult : null;

    const shouldIncludeDataset =
      taskReply?.replyKind === "capability" || taskReply?.replyKind === "direct_explanation";

    const datasetSchema = shouldIncludeDataset
      ? await datasetSchemaService.getSchemaForQuestion(userQuestion, token, apiKey)
      : "";
    const model = await createModel({ agentName: modelAgentName("reply") });
    const replyPrompt = renderPrompt("standard-chat.reply-task.system", {
      userQuestion,
      replyKind: taskReply?.replyKind || "direct_explanation",
      replyInstruction: taskReply?.replyInstruction || tApp("queryFixed.43"),
      datasetSection: datasetSchema.trim() ? `\n${datasetSchema.trim()}\n` : tApp("queryFixed.44"),
    });

    const promptHistory = resolveAgentPromptHistory(config, state.messages || []);
    const messagesForLLM = buildAgentPromptMessages({
      systemPrompt: replyPrompt,
      currentUserContent: userQuestion,
      priorMessages: promptHistory.messages,
      historyIncludesCurrentTurn: promptHistory.historyIncludesCurrentTurn,
      historyMode: "user-only",
    });

    logger.debug(tApp("queryFixed.45"), {
      promptLength: replyPrompt.length,
      messageCount: messagesForLLM.length,
      messagesLength: estimateMessagesSize(messagesForLLM),
    });

    const stream = await model.stream(messagesForLLM);

    let fullResponse = "";
    for await (const chunk of stream) {
      const chunkText = (chunk.content as string) || "";
      if (chunkText) {
        fullResponse += chunkText;
        sendEvent({
          type: "token" as const,
          node: "reply" as const,
          content: chunkText,
          timestamp: Date.now(),
        });
      }
    }

    fullResponse = fullResponse.trim();
    if (!fullResponse) {
      fullResponse = t("reply.defaultWelcomeMsg");
      sendEvent({
        type: "token" as const,
        node: "reply" as const,
        content: fullResponse,
        timestamp: Date.now(),
      });
    }

    logger.debug(tApp("queryFixed.42", { v0: (fullResponse.length) }));

    const requestSeq = config?.configurable?.requestSeq ?? 0;
    const aiMessage = new AIMessage({
      content: fullResponse,
      additional_kwargs: { requestSeq },
    });

    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildDirectResponseSnapshot(fullResponse, "completed"),
      source: "runtime",
    });

    return {
      messages: [aiMessage],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(tApp("queryFixed.46"), { error: errorMsg, threadId: config?.configurable?.thread_id });

    const fallbackText = t("reply.defaultErrorMsg");

    sendEvent({
      type: "error" as const,
      node: "reply" as const,
      content: t("reply.generationFailed", { error: errorMsg }),
      timestamp: Date.now(),
    });

    sendEvent({
      type: "token" as const,
      node: "reply" as const,
      content: fallbackText,
      timestamp: Date.now(),
    });

    const requestSeq = config?.configurable?.requestSeq ?? 0;
    const aiMessage = new AIMessage({
      content: fallbackText,
      additional_kwargs: { requestSeq },
    });

    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildDirectResponseSnapshot(fallbackText, "failed"),
      source: "runtime",
    });

    return {
      messages: [aiMessage],
      errors: [{ node: "reply", message: errorMsg, timestamp: Date.now() }],
    };
  }
}
