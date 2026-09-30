import type {
  SessionHistoryMessage as AgentChatMessage,
  SessionHistorySegment as MessageSegment,
  SessionHistoryToolSegment as ToolCallSegment,
  DiagnosisStreamEvent,
} from "@ontomato/contracts/diagnosis";
import type { DiagnosisResponseStatus } from "../types/agent-chat";
export interface DiagnosisLiveTail {
  messages: AgentChatMessage[];
  status: DiagnosisResponseStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

export function parseDiagnosisStreamEvent(value: unknown): DiagnosisStreamEvent | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  switch (value.type) {
    case "response_started":
      return hasString(value, "message")
        ? { type: "response_started", message: value.message as string }
        : undefined;
    case "token":
    case "thinking":
      return hasString(value, "content")
        ? { type: value.type, content: value.content as string }
        : undefined;
    case "tool_start":
      return hasString(value, "toolCallId") && hasString(value, "tool") && isRecord(value.args)
        ? {
            type: "tool_start",
            toolCallId: value.toolCallId as string,
            tool: value.tool as string,
            args: value.args,
          }
        : undefined;
    case "tool_end":
      return hasString(value, "toolCallId") &&
        hasString(value, "tool") &&
        typeof value.isError === "boolean"
        ? {
            type: "tool_end",
            toolCallId: value.toolCallId as string,
            tool: value.tool as string,
            result: value.result,
            isError: value.isError,
          }
        : undefined;
    case "response_end": {
      const status = value.status;
      if (status !== "completed" && status !== "cancelled") {
        return undefined;
      }
      return {
        type: "response_end",
        status,
      };
    }
    case "error":
      return hasString(value, "error") && typeof value.timestamp === "number"
        ? { type: "error", error: value.error as string, timestamp: value.timestamp }
        : undefined;
    case "response_unavailable":
      return { type: "response_unavailable" };
    default:
      return undefined;
  }
}

function cloneSegments(segments: MessageSegment[] | undefined): MessageSegment[] {
  return (segments ?? []).map((segment) => ({ ...segment }));
}

function updateAssistant(
  messages: AgentChatMessage[],
  update: (assistant: AgentChatMessage, segments: MessageSegment[]) => void
): AgentChatMessage[] {
  const next = messages.map((message) => ({
    ...message,
    ...(message.segments ? { segments: cloneSegments(message.segments) } : {}),
  }));
  let index = next.length - 1;
  if (index < 0 || next[index]!.role !== "assistant") {
    next.push({ role: "assistant", content: "", segments: [] });
    index = next.length - 1;
  }
  const assistant = next[index]!;
  const segments = assistant.segments ?? [];
  assistant.segments = segments;
  update(assistant, segments);
  return next;
}

function findTool(segments: MessageSegment[], toolCallId: string): ToolCallSegment | undefined {
  return segments.find(
    (segment): segment is ToolCallSegment =>
      segment.type === "tool_call" && segment.toolCallId === toolCallId
  );
}

function upsertTool(segments: MessageSegment[], toolCallId: string, tool: string): ToolCallSegment {
  const existing = findTool(segments, toolCallId);
  if (existing) return existing;
  const created: ToolCallSegment = {
    type: "tool_call",
    toolCallId,
    tool,
    args: "",
    status: "running",
  };
  segments.push(created);
  return created;
}

export function reduceDiagnosisLiveTail(
  state: DiagnosisLiveTail,
  event: DiagnosisStreamEvent
): DiagnosisLiveTail {
  if (event.type === "response_started") {
    if (state.status === "running" && state.messages[0]?.content === event.message) return state;
    return {
      status: "running",
      messages: [
        { role: "user", content: event.message },
        { role: "assistant", content: "", segments: [] },
      ],
    };
  }

  if (event.type === "response_end") return { ...state, status: event.status };
  if (event.type === "error") return { ...state, status: "failed" };
  if (event.type === "response_unavailable") return { messages: [], status: "idle" };

  const messages = updateAssistant(state.messages, (assistant, segments) => {
    if (event.type === "token") {
      const last = segments[segments.length - 1];
      if (last?.type === "text") last.content += event.content;
      else segments.push({ type: "text", content: event.content });
      assistant.content += event.content;
    } else if (event.type === "thinking") {
      const last = segments[segments.length - 1];
      if (last?.type === "thinking") last.content += event.content;
      else segments.push({ type: "thinking", content: event.content });
    } else if (event.type === "tool_start") {
      const tool = upsertTool(segments, event.toolCallId, event.tool);
      tool.args = JSON.stringify(event.args, null, 2);
      tool.status = "running";
    } else if (event.type === "tool_end") {
      const tool = upsertTool(segments, event.toolCallId, event.tool);
      tool.result = event.result;
      tool.isError = event.isError;
      tool.status = "done";
    }
  });

  return { messages, status: state.status === "starting" ? "running" : state.status };
}
