/**
 * Chat Completions final-body top-level override at the SDK fetch boundary.
 *
 * The configured custom parameters replace whole top-level fields of the
 * request body LangChain already assembled: objects/arrays are replaced as
 * single values (no deep merge), `null` is sent as-is, absent fields keep the
 * system-generated value. Spreading own fields is enough: both sides are
 * plain JSON, so no prototype handling is needed.
 *
 * This fetch is installed on a ChatOpenAI client (`configuration.fetch`),
 * which only sends Chat Completions JSON bodies. Anything else is a real
 * error and surfaces instead of silently skipping the override.
 *
 * Chain this wrapper inside the reasoning-replay fetch: reasoning patches
 * the SDK-generated `messages` first, then a custom `messages` array wins
 * as a whole, while without custom `messages` the replay survives.
 */
export function createChatCompletionsOverrideFetch(
  customRequestParameters: Record<string, unknown> | undefined
): typeof fetch | undefined {
  const overrides: Record<string, unknown> = { ...customRequestParameters };
  if (Object.keys(overrides).length === 0) return undefined;
  return async (input, init) => {
    const requestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return globalThis.fetch(input, {
      ...init,
      body: JSON.stringify({ ...requestBody, ...overrides }),
    });
  };
}

import { tApp } from "../i18n";

/**
 * Explicit error for a stream that ends normally without any chunk. Thrown
 * at the stream consumption boundary, never inside fetch (where the OpenAI
 * SDK would wrap it as a retried Connection error).
 */
export function createEmptyChatStreamError(): Error {
  return new Error(tApp("foundation.model.emptyStream"));
}
