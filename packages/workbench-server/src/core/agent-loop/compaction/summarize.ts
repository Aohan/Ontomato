/**
 * Summary generation for compaction.
 */

import { getPromptTemplate, renderPrompt } from "../../prompts/loader";
import { createLogger } from "../../../logging/logger";
import { streamChatCompletion } from "../llm-stream";
import type { AgentMessage, ModelConfig } from "../types";
import { serializeConversation } from "./serialize";
import type { CompactionPromptKeys } from "./types";

const logger = createLogger("agent-loop:compaction-summarize");

async function completeText(
  config: ModelConfig,
  systemPrompt: string,
  promptText: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() },
  ];

  const stream = streamChatCompletion(config, systemPrompt, messages, [], signal, maxTokens);

  let result: AgentMessage | undefined;
  while (true) {
    const { done, value } = await stream.next();
    if (done) {
      result = value;
      break;
    }
  }

  if (!result || result.role !== "assistant") {
    throw new Error("Summarization produced no assistant message");
  }
  if (result.stopReason === "aborted") {
    throw new Error("Summarization aborted");
  }
  if (result.stopReason === "error") {
    throw new Error(`Summarization failed: ${result.errorMessage || "Unknown error"}`);
  }

  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function buildPrompt(
  messages: AgentMessage[],
  promptKeys: CompactionPromptKeys,
  previousSummary?: string,
  promptVariables?: Record<string, string>
): string {
  const promptKey = previousSummary ? promptKeys.update : promptKeys.summarize;
  const basePrompt = promptVariables
    ? renderPrompt(promptKey, promptVariables)
    : getPromptTemplate(promptKey);
  const conversationText = serializeConversation(messages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;
  return promptText;
}

/**
 * Compaction is a distinct agent inside the same run: it keeps the loop's Run
 * identity but gets its own stable agent name, so its calls never mix with the
 * loop's own turns in the agent-llm log.
 */
function compactionModelConfig(config: ModelConfig): ModelConfig {
  if (!config.llmLog) return config;
  return {
    ...config,
    llmLog: { ...config.llmLog, agentName: `${config.llmLog.agentName}Compaction` },
  };
}

export async function generateSummary(
  messages: AgentMessage[],
  config: ModelConfig,
  reserveTokens: number,
  promptKeys: CompactionPromptKeys,
  previousSummary?: string,
  signal?: AbortSignal,
  promptVariables?: Record<string, string>
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);
  const systemPrompt = promptVariables
    ? renderPrompt(promptKeys.system, promptVariables)
    : getPromptTemplate(promptKeys.system);
  const promptText = buildPrompt(messages, promptKeys, previousSummary, promptVariables);
  logger.debug("Generating compaction summary", {
    messageCount: messages.length,
    isUpdate: !!previousSummary,
    maxTokens,
  });
  return completeText(compactionModelConfig(config), systemPrompt, promptText, maxTokens, signal);
}
