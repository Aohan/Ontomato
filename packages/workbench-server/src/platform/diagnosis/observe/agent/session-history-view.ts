import type {
  EgressTextContent as TextContent,
  EgressToolCallContent as ToolCallContent,
} from "@ontomato/contracts/agent-egress";
import type {
  SessionHistoryToolSegment,
  SessionHistoryMessage,
} from "@ontomato/contracts/diagnosis";
import type {
  AgentMessage,
  ThinkingContent,
  ToolResultMessage,
} from "../../../../core/agent-loop/index";
const DISPATCH_AGENT_TOOL = "dispatch_agent";
const PUBLIC_SUBAGENT_TOOL = "subagent";

export function messagesToSessionHistory(messages: AgentMessage[]): SessionHistoryMessage[] {
  const history: SessionHistoryMessage[] = [];
  let lastAssistant: SessionHistoryMessage | undefined;

  for (const msg of messages) {
    if (msg.role === "user") {
      history.push({ role: "user", content: extractText(msg.content) });
      lastAssistant = undefined;
      continue;
    }

    if (msg.role === "assistant") {
      const assistant = assistantToHistoryMessage(msg.content);
      history.push(assistant);
      lastAssistant = assistant;
      continue;
    }

    if (!lastAssistant) {
      lastAssistant = { role: "assistant", content: "", segments: [] };
      history.push(lastAssistant);
    }
    attachToolResult(lastAssistant, msg);
  }

  return history;
}

function assistantToHistoryMessage(
  content: (TextContent | ThinkingContent | ToolCallContent)[]
): SessionHistoryMessage {
  const segments: NonNullable<SessionHistoryMessage["segments"]> = [];

  for (const block of content) {
    if (block.type === "text") {
      segments.push({ type: "text", content: block.text });
    } else if (block.type === "thinking") {
      segments.push({ type: "thinking", content: block.text });
    } else if (block.type === "toolCall") {
      const isSubagent = block.name === DISPATCH_AGENT_TOOL;
      segments.push({
        type: "tool_call",
        toolCallId: block.id,
        tool: isSubagent ? PUBLIC_SUBAGENT_TOOL : block.name,
        args: isSubagent ? "" : stringifyToolArgs(block.arguments),
        status: "running",
      });
    }
  }

  const contentText = content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    role: "assistant",
    content: contentText,
    ...(segments.length > 0 ? { segments } : {}),
  };
}

function attachToolResult(assistant: SessionHistoryMessage, msg: ToolResultMessage): void {
  if (!assistant.segments) assistant.segments = [];

  let seg = assistant.segments.find(
    (item): item is SessionHistoryToolSegment =>
      item.type === "tool_call" && item.toolCallId === msg.toolCallId
  );
  if (!seg) {
    const isSubagent = msg.toolName === DISPATCH_AGENT_TOOL;
    seg = {
      type: "tool_call",
      toolCallId: msg.toolCallId,
      tool: isSubagent ? PUBLIC_SUBAGENT_TOOL : msg.toolName,
      args: "",
      status: "running",
    };
    assistant.segments.push(seg);
  }

  seg.result =
    msg.toolName === DISPATCH_AGENT_TOOL
      ? { status: msg.isError ? "failed" : "completed" }
      : {
          content: msg.content,
          ...(msg.terminate != null ? { terminate: msg.terminate } : {}),
        };
  seg.isError = msg.isError;
  seg.status = "done";
}

function stringifyToolArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args ?? {}, null, 2);
  } catch {
    return String(args);
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: { type: string }) => c.type === "text")
    .map((c: TextContent) => c.text ?? "")
    .join("");
}
