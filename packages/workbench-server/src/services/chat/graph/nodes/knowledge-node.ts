import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { buildUrl, getApiConfig } from "../../../../config/data-query-api";
import { t, tApp } from "../../../../i18n";
import { backendPost } from "../../../../utils/backend-client";
import { createLogger } from "../../../../logging/logger";
import type { GraphState, GraphUpdate } from "../state";
import { upsertChatRenderSnapshot } from "../../chat-snapshot-store";
import { resolveAgentPromptHistory } from "../utils/conversation-context";

const logger = createLogger("knowledge-node");
const CREATE_KNOWLEDGE_ENDPOINT = "/knowledge/createknowledgeai";
const CreateKnowledgeResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.array(
      z.object({
        title: z.string().optional().default(""),
        knowledge: z.string(),
      })
    ),
  }),
  z.object({
    success: z.literal(false),
    message: z.string().optional(),
  }),
]);

function buildKnowledgeMessages(state: GraphState, config?: any) {
  if (state.taskPlannerResult?.status !== "knowledge") {
    throw new Error(tApp("queryFixed.32"));
  }

  const history = resolveAgentPromptHistory(config, state.messages || []);
  const priorMessages = history.historyIncludesCurrentTurn
    ? history.messages.slice(0, -1)
    : history.messages;
  const messages = priorMessages
    .filter((message) => message._getType() === "human" || message._getType() === "ai")
    .map((message) => ({
      role: (message._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
      content: String(message.content || ""),
    }))
    .filter((message) => message.content.trim());

  return [...messages, { role: "user", content: state.userDisplayQuestion || state.userQuestion }];
}

function formatKnowledgeResult(items: Array<{ title: string; knowledge: string }>): string {
  const details = items
    .map((item) => (item.title.trim() ? `**${item.title}**\n${item.knowledge}` : item.knowledge))
    .join("\n\n");
  return details ? `${t("knowledge.created")}\n\n${details}` : t("knowledge.created");
}

function buildSnapshot(primaryText: string, status: "completed" | "failed") {
  return {
    mode: "standard" as const,
    status,
    primaryText,
  };
}

export async function knowledgeNode(state: GraphState, config?: any): Promise<GraphUpdate> {
  const onEvent = config?.configurable?.onEvent;
  const sendEvent = (event: any) => {
    if (onEvent) onEvent(event);
  };
  const requestSeq = config?.configurable?.requestSeq ?? state.requestSeq ?? 0;

  try {
    sendEvent({
      type: "progress" as const,
      node: "knowledge" as const,
      content: t("knowledge.creating"),
      timestamp: Date.now(),
    });

    const apiConfig = getApiConfig();
    const response = await backendPost(
      CREATE_KNOWLEDGE_ENDPOINT,
      buildUrl(apiConfig, CREATE_KNOWLEDGE_ENDPOINT),
      buildKnowledgeMessages(state, config),
      {
        token: config?.configurable?.token,
        apiKey: config?.configurable?.apiKey,
        userId: state.userId,
        locale: config?.configurable?.locale,
        signal: config?.signal || config?.configurable?.signal,
      }
    );
    const result = CreateKnowledgeResponseSchema.parse(JSON.parse(response.text));
    if (!result.success) {
      throw new Error(result.message || t("knowledge.creationFailed"));
    }
    const items = result.data;
    const responseText = formatKnowledgeResult(items);

    sendEvent({
      type: "token" as const,
      node: "knowledge" as const,
      content: responseText,
      timestamp: Date.now(),
    });

    const aiMessage = new AIMessage({
      content: responseText,
      additional_kwargs: { requestSeq },
    });
    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildSnapshot(responseText, "completed"),
      source: "runtime",
    });

    logger.info(tApp("queryFixed.33"), {
      threadId: state.threadId,
      requestSeq,
      itemCount: items.length,
    });
    return { messages: [aiMessage] };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const failureText = t("knowledge.creationFailed");
    logger.error(tApp("queryFixed.34"), {
      threadId: state.threadId,
      requestSeq,
      error: normalizedError.message,
    });
    sendEvent({
      type: "error" as const,
      node: "knowledge" as const,
      content: failureText,
      timestamp: Date.now(),
    });
    const aiMessage = new AIMessage({
      content: failureText,
      additional_kwargs: { requestSeq },
    });
    await upsertChatRenderSnapshot({
      threadId: state.threadId,
      requestSeq,
      snapshot: buildSnapshot(failureText, "failed"),
      source: "runtime",
    });
    return {
      messages: [aiMessage],
      errors: [{ node: "knowledge", message: normalizedError.message, timestamp: Date.now() }],
    };
  }
}
