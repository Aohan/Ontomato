import type { BaseMessage } from "@langchain/core/messages";

/**
 * @langchain/openai 1.4.1 captures provider reasoning in additional_kwargs but
 * drops that field when it converts messages back to Chat Completions input.
 * Patch the already-serialized request at the OpenAI SDK fetch boundary.
 */
export function createReasoningReplayFetch(
  messages: BaseMessage[],
  upstreamFetch: typeof fetch = globalThis.fetch
): typeof fetch | undefined {
  const reasoningByMessageIndex = new Map<number, string>();
  messages.forEach((message, index) => {
    const reasoningContent = message.additional_kwargs.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
      reasoningByMessageIndex.set(index, reasoningContent);
    }
  });
  if (reasoningByMessageIndex.size === 0)
    return upstreamFetch === globalThis.fetch ? undefined : upstreamFetch;

  return async (input, init) => {
    if (typeof init?.body !== "string") return upstreamFetch(input, init);

    const requestBody = JSON.parse(init.body) as { messages: Array<Record<string, unknown>> };
    reasoningByMessageIndex.forEach((reasoningContent, index) => {
      requestBody.messages[index].reasoning_content = reasoningContent;
    });
    return upstreamFetch(input, { ...init, body: JSON.stringify(requestBody) });
  };
}
