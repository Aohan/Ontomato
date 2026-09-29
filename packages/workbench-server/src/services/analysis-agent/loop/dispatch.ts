import { createHarnessRun } from "../../../core/agent-loop/session-run";
import type { CompactionPromptKeys } from "../../../core/agent-loop/compaction/types";
import { harnessSessions } from "../../../infrastructure/harness-sessions";
import type { AnalysisLoopSubagentReference } from "../task-types";
import type { EgressTextContent as TextContent } from "@ontomato/contracts/agent-egress";
/**
 * Dispatch capability of the loop form.
 *
 * The supervisor hands one self-contained topic to a worker (sub-agent) that works in an isolated context, instantiated from the same shared skeleton.
 * The tool set is the permission: a worker only gets the tools granted by the dispatch definition (evidence collection and notebook read/write),
 * never the dispatch tool itself, so nesting is exactly one level deep. Worker evidence collection goes through the same evidence recording path as the
 * main loop (same task, same stable identity rules, same query_runs pool); the body is written straight into the report notebook, only the summary
 * returns to the supervisor, and the process is persisted as internal task audit.
 *
 * Dispatches run concurrently: the tools do not declare sequential, so multiple dispatches the supervisor issues in one turn are scheduled in
 * parallel by the base; total latency approximates the slowest worker. A single dispatch failing or being cancelled converges into that dispatch's failed result.
 */

import { v4 as uuidv4 } from "uuid";
import { modelAgentName } from "../../../logging/model-agents";
import { Agent } from "../../../core/agent-loop/agent";
import type {
  AgentMessage,
  AgentTool,
  AgentToolResult,
  ModelConfig,
} from "../../../core/agent-loop/types";
import { renderPrompt } from "../../../core/prompts/loader";
import { createLogger } from "../../../logging/logger";
import type { AnalysisTaskService } from "../task/task-service";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { ANALYSIS_LOOP_SUBAGENT_SOURCE_KIND, type AnalysisLoopSubagentAudit } from "../task-types";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-dispatch");

const DISPATCH_ANALYST_TOOL_NAME = "dispatch_analyst";

export interface LoopDispatchDeps {
  modelConfig: ModelConfig;
  parentSessionId: string;
  contextWindow: number;
  compactionPromptKeys: CompactionPromptKeys;
  compactionPromptVariables: Record<string, string>;
  /** Whether a report deliverable is attached; decides the worker's tools and hand-back semantics */
  reportDeliverableEnabled: boolean;
  /** The sub-agent's system prompt */
  systemPrompt: string;
  /**
   * Builds the sub-agent's tool set from the dispatch activity identity. The tool set is the permission and the caller decides what to grant;
   * the dispatch tool itself is never included.
   */
  createChildTools: (dispatchActivityId: string) => AgentTool[];
  /** Persistence for the sub-agent's process audit */
  saveAudit: (audit: AnalysisLoopSubagentReference) => void | Promise<void>;
}

/** Assembles the dispatch tool, worker system prompt, worker tool surface, and sub-trajectory audit. */
export function assembleLoopDispatchCapability(params: {
  modelConfig: ModelConfig;
  parentSessionId: string;
  contextWindow: number;
  compactionPromptKeys: CompactionPromptKeys;
  compactionPromptVariables: Record<string, string>;
  reportDeliverableEnabled: boolean;
  workerPrompt: {
    datasetSchema: string;
    dataProbeCapability: string;
    skillCapability: string;
    deliverableCapability: string;
  };
  workerTools: {
    evidence: (dispatchActivityId: string) => AgentTool;
    probe: (dispatchActivityId: string) => AgentTool[];
    skills: AgentTool[];
    notebook: (dispatchActivityId: string) => AgentTool[];
  };
  taskId?: string;
  taskService: Pick<AnalysisTaskService, "upsertTaskEvent">;
  trajectory: DeepAnalysisArtifactStore;
}): AgentTool {
  const persistSubagentAudit = async (audit: AnalysisLoopSubagentReference): Promise<void> => {
    if (!params.taskId) return;
    const activity = params.trajectory
      .current()
      .activities.find((item) => item.activityId === audit.activityId);
    await params.taskService.upsertTaskEvent({
      taskId: params.taskId,
      eventSeq: activity?.seq ?? 0,
      eventType: "loop_subagent",
      eventName: "dispatch",
      phase: "loop",
      sourceKind: ANALYSIS_LOOP_SUBAGENT_SOURCE_KIND,
      sourceRef: audit.activityId,
      payload: audit,
    });
  };

  return createDispatchAnalystTool({
    deps: {
      modelConfig: params.modelConfig,
      parentSessionId: params.parentSessionId,
      contextWindow: params.contextWindow,
      compactionPromptKeys: params.compactionPromptKeys,
      compactionPromptVariables: params.compactionPromptVariables,
      reportDeliverableEnabled: params.reportDeliverableEnabled,
      systemPrompt: renderPrompt("analysis-agent.loop.subagent.system", params.workerPrompt),
      createChildTools: (dispatchActivityId) => [
        params.workerTools.evidence(dispatchActivityId),
        ...params.workerTools.probe(dispatchActivityId),
        ...params.workerTools.skills,
        ...params.workerTools.notebook(dispatchActivityId),
      ],
      saveAudit: persistSubagentAudit,
    },
    onAccepted: (topic) => params.trajectory.start("dispatch", { topic }),
    onSettled: (activityId, status, fields) => params.trajectory.settle(activityId, status, fields),
  });
}

function parseTopic(params: Record<string, unknown>): string {
  const topic = typeof params.topic === "string" ? params.topic.trim() : "";
  if (!topic) {
    throw new Error(tApp("analysis.loop.dispatch.238"));
  }
  return topic;
}

export function lastAssistantText(messages: AgentMessage[]): {
  text: string;
  stopReason?: string;
  errorMessage?: string;
} {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    return {
      text: message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim(),
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    };
  }
  return { text: "" };
}

export function createDispatchAnalystTool(params: {
  deps: LoopDispatchDeps;
  /** Invoked when a dispatch is accepted, to register the trajectory activity */
  onAccepted: (topic: string) => string;
  /** Invoked when a dispatch settles, to finalize the trajectory activity */
  onSettled: (
    activityId: string,
    status: "completed" | "failed" | "cancelled",
    fields: { workerSummary?: string; error?: string }
  ) => void;
}): AgentTool {
  const { deps } = params;

  return {
    name: DISPATCH_ANALYST_TOOL_NAME,
    description: deps.reportDeliverableEnabled
      ? tApp("analysis.loop.dispatch.239")
      : tApp("analysis.loop.dispatch.240"),
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: deps.reportDeliverableEnabled
            ? tApp("analysis.loop.dispatch.241")
            : tApp("analysis.loop.dispatch.242"),
        },
      },
      required: ["topic"],
    },
    async execute(_toolCallId: string, toolParams: Record<string, unknown>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const topic = parseTopic(toolParams);
      const activityId = params.onAccepted(topic);

      const childSessionId = uuidv4();
      await harnessSessions.create(childSessionId, deps.parentSessionId, _toolCallId);
      const turn = await harnessSessions.beginTurn(childSessionId);
      let child: Agent | undefined;
      const settle = async (
        status: Exclude<AnalysisLoopSubagentAudit["status"], "running">,
        error?: string
      ) => {
        await harnessSessions.finishTurn(childSessionId, turn.turnId, status);
        await deps.saveAudit({
          activityId,
          topic,
          sessionId: childSessionId,
          ...(error ? { error } : {}),
        });
      };
      try {
        await deps.saveAudit({ activityId, topic, sessionId: childSessionId });
        child = new Agent(
          {
            ...deps.modelConfig,
            llmLog: { agentName: modelAgentName("analysisLoopSubAgent"), agentRunId: uuidv4() },
          },
          {
            systemPrompt: deps.systemPrompt,
            tools: deps.createChildTools(activityId),
            session: await createHarnessRun(harnessSessions, {
              sessionId: childSessionId,
              turnId: turn.turnId,
              contextWindow: deps.contextWindow,
              promptKeys: deps.compactionPromptKeys,
              promptVariables: deps.compactionPromptVariables,
            }),
          }
        );
        await child.prompt(topic, signal);

        const last = lastAssistantText(child.state.messages);
        if (signal?.aborted || last.stopReason === "aborted") {
          await settle("cancelled", tApp("analysis.loop.dispatch.243"));
          params.onSettled(activityId, "cancelled", { error: tApp("analysis.loop.dispatch.243") });
          return {
            content: [{ type: "text", text: tApp("analysis.loop.dispatch.244") }],
          } satisfies AgentToolResult;
        }
        if (last.stopReason === "error") {
          const message = last.errorMessage || tApp("analysis.loop.dispatch.245");
          await settle("failed", message);
          params.onSettled(activityId, "failed", { error: message });
          return {
            content: [
              { type: "text", text: tApp("analysis.loop.dispatch.246", { message: message }) },
            ],
          } satisfies AgentToolResult;
        }

        const workerSummary =
          last.text ||
          (deps.reportDeliverableEnabled
            ? tApp("analysis.loop.dispatch.247")
            : tApp("analysis.loop.dispatch.248"));
        await settle("completed");
        params.onSettled(activityId, "completed", { workerSummary });
        return {
          content: [{ type: "text", text: workerSummary }],
        } satisfies AgentToolResult;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(tApp("analysis.loop.dispatch.249"), { activityId, error: message });
        const failedStatus = signal?.aborted ? "cancelled" : "failed";
        await settle(failedStatus, message);
        params.onSettled(activityId, failedStatus, { error: message });
        return {
          content: [
            { type: "text", text: tApp("analysis.loop.dispatch.246", { message: message }) },
          ],
        } satisfies AgentToolResult;
      } finally {
        child?.dispose();
      }
    },
  };
}
