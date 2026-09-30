import type { EgressToolCallContent as ToolCallContent } from "@ontomato/contracts/agent-egress";
import { createLogger } from "../../logging/logger";
import { compactContext } from "./compaction/compact-messages";
import { streamChatCompletion } from "./llm-stream";
import type { HarnessRun } from "./session-run";
import type {
  AgentState,
  ModelConfig,
  AgentEventListener,
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
  AgentTool,
  AgentToolResult,
} from "./types";

const logger = createLogger("agent-loop");

export interface AgentLoopHooks {
  /**
   * Called before every model turn, including the first, after the current
   * user message or tool results are already in the context. Callers use it
   * for their own prompt refresh. Context compaction is not a hook.
   */
  beforeTurn?: (state: AgentState) => Promise<void>;
  /** Present for every production agent. Persistence and the 80% check run inside the loop. */
  session?: HarnessRun;
}

/**
 * Run the agent loop: send a user prompt, stream the LLM response,
 * execute tool calls if any, repeat until the LLM stops calling tools.
 */
export async function runAgentLoop(
  prompt: string,
  state: AgentState,
  config: ModelConfig,
  emit: AgentEventListener,
  signal?: AbortSignal,
  hooks?: AgentLoopHooks
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [];
  const session = hooks?.session;
  if (session) {
    state.messages = [...session.context.messages];
  }
  const seqs: Array<number | null> = session ? [...session.context.seqs] : [];

  const userMessage: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: prompt }],
    timestamp: Date.now(),
  };
  state.messages.push(userMessage);
  newMessages.push(userMessage);
  if (session) seqs.push(await session.journal.appendMessage(userMessage));

  emit({ type: "agent_start" });
  emit({ type: "turn_start" });
  emit({ type: "message_start", message: userMessage });
  emit({ type: "message_end", message: userMessage });

  state.isStreaming = true;

  try {
    // Inner loop: keep going while the LLM returns tool calls
    while (true) {
      if (signal?.aborted) break;

      if (hooks?.beforeTurn) {
        await hooks.beforeTurn(state);
        if (signal?.aborted) break;
      }
      if (session) {
        const compacted = await compactContext({
          messages: state.messages,
          seqs,
          config,
          contextWindow: session.contextWindow,
          systemPrompt: state.systemPrompt,
          tools: state.tools,
          promptKeys: session.promptKeys,
          promptVariables: session.promptVariables,
          previousSummary: session.context.previousSummary,
          summaryNote: session.summaryNote,
          signal,
        });
        if (compacted.compacted) {
          await session.journal.writeCompaction({
            summary: compacted.previousSummary,
            coveredThroughSeq: compacted.coveredThroughSeq,
          });
          session.context.previousSummary = compacted.previousSummary;
          state.messages = compacted.messages;
          seqs.length = 0;
          seqs.push(...compacted.seqs);
        }
        if (signal?.aborted) break;
      }

      const stream = streamChatCompletion(
        config,
        state.systemPrompt,
        state.messages,
        state.tools,
        signal,
        session && config.maxTokens !== undefined
          ? Math.max(1, Math.floor(session.contextWindow * 0.2))
          : undefined
      );

      // Stream the assistant's response
      let assistantMsg: AssistantMessage | undefined;
      while (true) {
        const { done, value } = await stream.next();
        if (done) {
          assistantMsg = value;
          break;
        }
        // value is an AssistantStreamEvent delta
        if (value.partial) {
          emit({
            type: "message_update",
            message: value.partial,
            assistantMessageEvent: value,
          });
        }
      }

      if (!assistantMsg) {
        assistantMsg = {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          stopReason: "error",
          errorMessage: "No response from LLM",
          timestamp: Date.now(),
        };
      }

      state.messages.push(assistantMsg);
      newMessages.push(assistantMsg);
      if (session) seqs.push(await session.journal.appendMessage(assistantMsg));
      emit({ type: "message_end", message: assistantMsg });

      // If no tool calls or error/abort, we're done
      const toolCalls = assistantMsg.content.filter(
        (c): c is ToolCallContent => c.type === "toolCall"
      );

      if (
        toolCalls.length === 0 ||
        assistantMsg.stopReason === "error" ||
        assistantMsg.stopReason === "aborted"
      ) {
        emit({
          type: "turn_end",
          message: assistantMsg,
          toolResults: [],
        });
        break;
      }

      // Execute tool calls
      const toolResults = await executeToolCalls(toolCalls, state.tools, emit, signal);

      for (const tr of toolResults) {
        state.messages.push(tr);
        newMessages.push(tr);
        if (session) seqs.push(await session.journal.appendMessage(tr));
      }

      // Check if any tool requested termination via AgentToolResult.terminate.
      // If so, finish this turn (turn_end is still emitted below) and stop the
      // ReAct loop instead of feeding the results back to the LLM.
      const shouldStop = toolResults.some((tr) => tr.terminate);

      emit({
        type: "turn_end",
        message: assistantMsg,
        toolResults,
      });

      if (shouldStop || signal?.aborted) break;

      // Continue the loop: the LLM will see the tool results and respond
      emit({ type: "turn_start" });
    }
  } finally {
    state.isStreaming = false;
    if (session) {
      session.context = {
        messages: [...state.messages],
        seqs: [...seqs],
        previousSummary: session.context.previousSummary,
      };
    }
  }

  emit({ type: "agent_end", messages: newMessages });
  return newMessages;
}

async function executeToolCalls(
  toolCalls: ToolCallContent[],
  tools: AgentTool[],
  emit: AgentEventListener,
  signal?: AbortSignal
): Promise<ToolResultMessage[]> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Check if any tool requires sequential execution
  const hasSequential = toolCalls.some((tc) => {
    const tool = toolMap.get(tc.name);
    return tool?.executionMode === "sequential";
  });

  if (hasSequential || toolCalls.length === 1) {
    return executeToolCallsSequential(toolCalls, toolMap, emit, signal);
  }

  return executeToolCallsParallel(toolCalls, toolMap, emit, signal);
}

async function executeToolCallsSequential(
  toolCalls: ToolCallContent[],
  toolMap: Map<string, AgentTool>,
  emit: AgentEventListener,
  signal?: AbortSignal
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];

  for (const tc of toolCalls) {
    if (signal?.aborted) break;
    const result = await executeSingleToolCall(tc, toolMap, emit, signal);
    results.push(result);
  }

  return results;
}

async function executeToolCallsParallel(
  toolCalls: ToolCallContent[],
  toolMap: Map<string, AgentTool>,
  emit: AgentEventListener,
  signal?: AbortSignal
): Promise<ToolResultMessage[]> {
  const promises = toolCalls.map((tc) => executeSingleToolCall(tc, toolMap, emit, signal));
  return Promise.all(promises);
}

async function executeSingleToolCall(
  tc: ToolCallContent,
  toolMap: Map<string, AgentTool>,
  emit: AgentEventListener,
  signal?: AbortSignal
): Promise<ToolResultMessage> {
  const tool = toolMap.get(tc.name);

  emit({
    type: "tool_execution_start",
    toolCallId: tc.id,
    toolName: tc.name,
    args: tc.arguments,
  });

  if (!tool) {
    const errorResult: AgentToolResult = {
      content: [{ type: "text", text: `Unknown tool: ${tc.name}` }],
    };
    emit({
      type: "tool_execution_end",
      toolCallId: tc.id,
      toolName: tc.name,
      result: errorResult,
      isError: true,
    });
    return {
      role: "toolResult",
      toolCallId: tc.id,
      toolName: tc.name,
      content: errorResult.content,
      isError: true,
      timestamp: Date.now(),
    };
  }

  try {
    const result = await tool.execute(tc.id, tc.arguments, signal, (partialResult) => {
      emit({
        type: "tool_execution_update",
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.arguments,
        partialResult,
      });
    });

    emit({
      type: "tool_execution_end",
      toolCallId: tc.id,
      toolName: tc.name,
      result,
      isError: false,
    });

    return {
      role: "toolResult",
      toolCallId: tc.id,
      toolName: tc.name,
      content: result.content,
      isError: false,
      terminate: result.terminate,
      timestamp: Date.now(),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("Tool execution failed", {
      tool: tc.name,
      toolCallId: tc.id,
      error: errMsg,
    });

    const errorResult: AgentToolResult = {
      content: [{ type: "text", text: `Tool error: ${errMsg}` }],
    };

    emit({
      type: "tool_execution_end",
      toolCallId: tc.id,
      toolName: tc.name,
      result: errorResult,
      isError: true,
    });

    return {
      role: "toolResult",
      toolCallId: tc.id,
      toolName: tc.name,
      content: errorResult.content,
      isError: true,
      timestamp: Date.now(),
    };
  }
}
