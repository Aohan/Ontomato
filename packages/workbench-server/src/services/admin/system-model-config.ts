import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { SystemModelEntry } from "@ontomato/contracts/system-model";
import { normalizeCustomRequestParameters } from "../../config/custom-request-parameters";
import {
  DEFAULT_TIMEOUT_SECONDS,
  SYSTEM_MODEL_MAX_TOKENS,
  validateSystemModelApiKey,
} from "../../config/system-model";
import { useApproximateTokenCounter } from "../../utils/langchain-token-counter.js";
import {
  createChatCompletionsOverrideFetch,
  createEmptyChatStreamError,
} from "../../utils/chat-completions-body-override.js";

export async function runSystemModelProbe(
  body: any,
  onReady: () => void,
  onChunk: (content: string) => void
): Promise<string> {
  const draft = (body || {}) as Partial<SystemModelEntry>;
  const apiKey = draft.apiKey;
  validateSystemModelApiKey(apiKey);
  const customRequestParameters = normalizeCustomRequestParameters(
    draft.customRequestParameters ?? {}
  );
  const overrideFetch = createChatCompletionsOverrideFetch(customRequestParameters);
  const model = useApproximateTokenCounter(
    new ChatOpenAI({
      model: draft.modelName || "",
      configuration: {
        baseURL: draft.baseUrl || "",
        apiKey,
        defaultHeaders: { "Content-Type": "application/json" },
        ...(overrideFetch ? { fetch: overrideFetch } : {}),
      },
      temperature: 0,
      maxTokens: SYSTEM_MODEL_MAX_TOKENS,
      maxRetries: 1,
      timeout: (draft.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
    })
  );
  const testMessage = body.userContent || "Hello, please respond with 'ok'.";
  onReady();
  const stream = await model.stream([new HumanMessage(testMessage)]);
  let modelNameResolved = "";

  let chunkCount = 0;
  for await (const chunk of stream) {
    chunkCount += 1;
    const chunkText = typeof chunk.content === "string" ? chunk.content : "";
    if (chunkText) {
      onChunk(chunkText);
    }
    if (chunk.response_metadata?.model_name && !modelNameResolved) {
      modelNameResolved = chunk.response_metadata.model_name as string;
    }
  }
  // Same observed mismatch as the other two paths: zero chunks is an error,
  // so the route reports a failure instead of a successful empty test.
  if (chunkCount === 0) throw createEmptyChatStreamError();

  return modelNameResolved || draft.modelName || "";
}
