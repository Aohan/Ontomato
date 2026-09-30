export interface LlmLogToolCall {
  id?: string;
  name?: string;
  arguments?: string;
}

export interface LlmLogMessage {
  role: string;
  reasoningContent?: string;
  text?: string;
  toolCalls?: LlmLogToolCall[];
  toolCallId?: string;
  toolName?: string;
  truncated?: boolean;
}

export interface LlmLogOutput {
  reasoningContent?: string;
  text?: string;
  toolCalls: LlmLogToolCall[];
  finishReason?: string;
}

export function normalizeLlmInputMessages(input: unknown): LlmLogMessage[] {
  if (isPromptValue(input)) {
    try {
      return normalizeLlmInputMessages(input.toChatMessages());
    } catch {
      return [{ role: "user", text: serializeLlmValue(input) }];
    }
  }

  if (Array.isArray(input)) {
    return input.map((item) => normalizeMessageLike(item));
  }

  if (typeof input === "string") {
    return [{ role: "user", text: input }];
  }

  if (input && typeof input === "object" && ("content" in input || "text" in input)) {
    return [normalizeMessageLike(input)];
  }

  return [{ role: "user", text: serializeLlmValue(input) }];
}

export function normalizeLlmOutput(result: unknown): LlmLogOutput {
  if (isNormalizedOutput(result)) {
    return result;
  }

  if (typeof result === "string") {
    return { text: result, toolCalls: [] };
  }

  if (!result || typeof result !== "object") {
    return { text: serializeLlmValue(result), toolCalls: [] };
  }

  const record = result as Record<string, unknown>;
  const reasoningContent = extractReasoningContent(record);
  return {
    ...(reasoningContent !== undefined ? { reasoningContent } : {}),
    text: contentToText(record.content ?? record.text),
    toolCalls: extractToolCalls(record),
    finishReason: extractFinishReason(record),
  };
}

export function normalizeLlmStreamOutput(chunks: unknown[]): LlmLogOutput {
  const reasoningParts: string[] = [];
  const textParts: string[] = [];
  const toolCalls = new Map<string, LlmLogToolCall & { index?: number }>();
  let finishReason: string | undefined;

  chunks.forEach((chunk) => {
    const output = normalizeLlmOutput(chunk);
    if (output.reasoningContent) {
      reasoningParts.push(output.reasoningContent);
    }
    if (output.text) {
      textParts.push(output.text);
    }
    if (output.finishReason) {
      finishReason = output.finishReason;
    }

    const rawCalls = extractRawToolCalls(chunk);
    rawCalls.forEach((rawCall, rawIndex) => {
      const call = normalizeToolCall(rawCall);
      const index = extractToolCallIndex(rawCall) ?? rawIndex;
      // Streaming providers usually emit the id/name only on the first chunk.
      // The tool-call index is the stable key across all argument fragments.
      const key = `index:${index}`;
      const existing = toolCalls.get(key);
      if (!existing) {
        toolCalls.set(key, { ...call, index });
        return;
      }
      toolCalls.set(key, {
        id: existing.id ?? call.id,
        name: existing.name ?? call.name,
        arguments: `${existing.arguments ?? ""}${call.arguments ?? ""}` || undefined,
        index: existing.index ?? index,
      });
    });
  });

  const sortedToolCalls = Array.from(toolCalls.values())
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(({ index: _index, ...call }) => call);

  return {
    ...(reasoningParts.length > 0 ? { reasoningContent: reasoningParts.join("") } : {}),
    text: textParts.join("") || undefined,
    toolCalls: sortedToolCalls,
    finishReason,
  };
}

export function extractLlmTokens(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return (
    normalizeTokenObject(record.usage_metadata) ??
    normalizeTokenObject(
      (record.response_metadata as Record<string, unknown> | undefined)?.usage
    ) ??
    normalizeTokenObject(
      (record.response_metadata as Record<string, unknown> | undefined)?.tokenUsage
    ) ??
    normalizeTokenObject(record.tokens)
  );
}

function serializeLlmValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, rawValue: unknown) => {
      if (typeof rawValue === "bigint") {
        return rawValue.toString();
      }
      if (typeof rawValue === "function" || typeof rawValue === "symbol") {
        return undefined;
      }
      if (rawValue && typeof rawValue === "object") {
        if (seen.has(rawValue)) {
          return "[Circular]";
        }
        seen.add(rawValue);
      }
      return rawValue;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function getMessageRole(record: Record<string, unknown>): string | undefined {
  if (typeof record.role === "string") {
    return record.role;
  }
  if (typeof record.type === "string") {
    return record.type;
  }

  const getType = record._getType;
  if (typeof getType === "function") {
    try {
      const type = getType.call(record);
      return typeof type === "string" ? type : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function normalizeMessageLike(message: unknown): LlmLogMessage {
  if (typeof message === "string") {
    return { role: "user", text: message };
  }
  if (!message || typeof message !== "object") {
    return { role: "user", text: serializeLlmValue(message) };
  }

  const record = message as Record<string, unknown>;
  const role = normalizeRole(getMessageRole(record));
  const reasoningContent = extractReasoningContent(record);
  const text = contentToText(record.content ?? record.text);
  const toolCalls = extractToolCalls(record);
  const toolCallId = firstString(record.toolCallId, record.tool_call_id);
  const toolName = firstString(record.toolName, record.name);

  return {
    role,
    ...(reasoningContent !== undefined ? { reasoningContent } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(record.truncated === true ? { truncated: true } : {}),
  };
}

function normalizeRole(role: string | undefined): string {
  switch (role) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "function":
      return "tool";
    case "system":
    case "user":
    case "assistant":
    case "tool":
      return role;
    default:
      return role || "unknown";
  }
}

function contentToText(content: unknown): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean" || typeof content === "bigint") {
    return String(content);
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (typeof record.content === "string") return record.content;
        }
        return serializeLlmValue(item);
      })
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return serializeLlmValue(content);
}

function extractReasoningContent(record: Record<string, unknown>): string | undefined {
  const additionalKwargs = record.additional_kwargs as Record<string, unknown> | undefined;
  const kwargs = record.kwargs as Record<string, unknown> | undefined;
  const value = firstDefined(
    record.reasoningContent,
    record.reasoning_content,
    record.thinking,
    additionalKwargs?.reasoning_content,
    additionalKwargs?.reasoning,
    additionalKwargs?.reasoning_text,
    kwargs?.reasoning_content
  );
  return contentToText(value);
}

function extractToolCalls(record: Record<string, unknown>): LlmLogToolCall[] {
  return extractRawToolCalls(record).map(normalizeToolCall).filter(hasToolCallContent);
}

function extractRawToolCalls(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const additionalKwargs = record.additional_kwargs as Record<string, unknown> | undefined;
  const kwargs = record.kwargs as Record<string, unknown> | undefined;
  return firstArray(
    record.toolCalls,
    record.tool_calls,
    record.toolCallChunks,
    record.tool_call_chunks,
    additionalKwargs?.tool_calls,
    kwargs?.tool_calls
  );
}

function normalizeToolCall(rawCall: unknown): LlmLogToolCall {
  if (!rawCall || typeof rawCall !== "object") {
    return {};
  }

  const record = rawCall as Record<string, unknown>;
  const fn = record.function as Record<string, unknown> | undefined;
  const rawArguments = record.arguments ?? record.args ?? fn?.arguments;
  return {
    id: firstString(record.id, record.tool_call_id),
    name: firstString(record.name, fn?.name),
    arguments: rawArguments === undefined ? undefined : normalizeArguments(rawArguments),
  };
}

function normalizeArguments(value: unknown): string {
  if (typeof value === "string") return value;
  return serializeLlmValue(value);
}

function hasToolCallContent(call: LlmLogToolCall): boolean {
  return Boolean(call.id || call.name || call.arguments);
}

function extractToolCallIndex(rawCall: unknown): number | undefined {
  if (!rawCall || typeof rawCall !== "object") return undefined;
  const index = (rawCall as Record<string, unknown>).index;
  return typeof index === "number" && Number.isFinite(index) ? index : undefined;
}

function extractFinishReason(record: Record<string, unknown>): string | undefined {
  const responseMetadata = record.response_metadata as Record<string, unknown> | undefined;
  const additionalKwargs = record.additional_kwargs as Record<string, unknown> | undefined;
  return firstString(
    record.finishReason,
    record.finish_reason,
    responseMetadata?.finish_reason,
    responseMetadata?.finishReason,
    additionalKwargs?.finish_reason
  );
}

function normalizeTokenObject(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
    const key = normalizeTokenKey(rawKey);
    result[key] = rawValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeTokenKey(key: string): string {
  switch (key) {
    case "input_tokens":
    case "promptTokens":
    case "prompt_tokens":
      return "input";
    case "output_tokens":
    case "completionTokens":
    case "completion_tokens":
      return "output";
    case "total_tokens":
    case "totalTokens":
      return "total";
    default:
      return key;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isPromptValue(value: unknown): value is { toChatMessages: () => unknown[] } {
  const candidate = value as { toChatMessages?: unknown };
  return !!value && typeof value === "object" && typeof candidate.toChatMessages === "function";
}

function isNormalizedOutput(value: unknown): value is LlmLogOutput {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as LlmLogOutput).toolCalls) &&
    ("reasoningContent" in value ||
      "text" in value ||
      "finishReason" in value ||
      "toolCalls" in value)
  );
}
