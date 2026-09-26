import { createHarnessRun } from "../../../core/agent-loop/session-run";
import type { CompactionPromptKeys } from "../../../core/agent-loop/compaction/types";
import { harnessSessions } from "../../../infrastructure/harness-sessions";
import type { AnalysisLoopSubagentReference } from "../task-types";
import type { EgressTextContent as TextContent } from "@ontomato/contracts/agent-egress";
/**
 * 循环形态的派遣能力。
 *
 * 主管把一个独立课题交给工人（子 Agent）在隔离上下文中完成，工人用同一套共享骨架
 * 新建实例。工具集即权限：工人只拿到派遣定义授予的工具（取证与笔记本读写），拿不到
 * 派遣工具本身，因此嵌套只有一层。工人的取证走与主循环同一条证据记录路径（同任务、
 * 同稳定身份规则、query_runs 同池），正文直接写进报告笔记本，只把简介返回主管，
 * 过程作为任务内部审计持久化。
 *
 * 派遣并发执行：工具不声明 sequential，主管同轮发出的多个派遣由底座并行调度，
 * 总时延约等于最慢的工人；单个派遣失败或取消收敛为该次派遣的失败结果。
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
  /** 是否挂载报告交付件；决定工人的工具与交回语义 */
  reportDeliverableEnabled: boolean;
  /** 子 Agent 的系统提示词 */
  systemPrompt: string;
  /**
   * 按派遣活动身份构造子 Agent 的工具集。工具集即权限，调用方决定授予什么；
   * 派遣工具本身不在其中。
   */
  createChildTools: (dispatchActivityId: string) => AgentTool[];
  /** 子 Agent 过程审计持久化 */
  saveAudit: (audit: AnalysisLoopSubagentReference) => void | Promise<void>;
}

/** 装配派遣工具、工人系统提示词、工人工具面和子轨迹审计。 */
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
  /** 受理一次派遣时回调，用于登记轨迹活动 */
  onAccepted: (topic: string) => string;
  /** 派遣结算时回调，用于结算轨迹活动 */
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
