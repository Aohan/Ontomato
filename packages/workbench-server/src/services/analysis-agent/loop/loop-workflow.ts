/**
 * 循环执行形态的运行时。
 *
 * 主 Agent 是主管：在响应循环中自行决定取证、派遣工人与交付，直到判断任务完成或
 * 用户取消。报告交付件由智能体布尔配置决定是否装配；循环底座本身只负责响应循环、
 * 通用工具、分析轨迹与任务收口。
 *
 * 报告正文只经报告笔记本产生：定稿一章就把已定稿章节按章节顺序整体重排推送；
 * 终态兜底组装全部非空章节，漏定稿不丢内容，笔记本全空才判没有可交付报告。
 *
 * 循环路径不做热卡匹配、不沉淀待审核卡片；分析技能经受控工具由模型按需使用。
 */

import { v4 as uuidv4 } from "uuid";
import { modelAgentName } from "../../../logging/model-agents";
import { runAgentLoop } from "../../../core/agent-loop/agent-loop";
import { createHarnessRun } from "../../../core/agent-loop/session-run";
import { harnessSessions } from "../../../infrastructure/harness-sessions";
import { type CompactionPromptKeys } from "../../../core/agent-loop/compaction/types";
import type { AgentEvent, AgentState, ModelConfig } from "../../../core/agent-loop/types";
import { resolveSystemModel } from "../../../config/system-model";
import { initializeConnection } from "../../../infrastructure/connection";
import { renderPrompt } from "../../../core/prompts/loader";
import { t } from "../../../i18n";
import { buildTurnIdentity, runWithLogContext } from "../../../logging/log-context";
import { createLogger } from "../../../logging/logger";
import { recordTurnRunFinish, recordTurnRunStart } from "../../turn-run/turn-run-store";
import { allocateRequestSeq } from "../../chat/thread-store";
import type { AnalysisRunIdentity } from "../task/run-history";
import { datasetSchemaService } from "../../data-query/dataset-schema";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";
import { getAnalysisAgentService } from "../config/agent-service";
import { getAnalysisTaskService } from "../task/task-service";
import type { AnalysisConversationTurnRecord } from "../task/conversation-types";
import { getQueryRunBySource } from "../../data-query/query-run-store";

import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import { assembleLoopChartCapability } from "./chart";
import { assembleLoopDispatchCapability, lastAssistantText } from "./dispatch";
import { assembleLoopEvidenceCapability } from "./evidence";
import { assembleLoopExternalMcpCapability } from "./external-mcp";
import { assembleLoopNotebookCapability } from "./notebook";
import { assembleLoopDataProbeCapability } from "./probe";
import { assembleLoopSkillCapability } from "./skills";
import { createDeepAnalysisArtifactStore } from "../task/artifacts";
import {
  expandQueryResultDatasetEntries,
  type QueryResultDatasetEntry,
} from "../runtime/query-result";
import { tApp } from "../../../i18n";


const logger = createLogger("analysis-loop-workflow");

/** 循环形态共用一套压缩模板，报告交付件相关要求由运行时变量条件化。 */
export const ANALYSIS_LOOP_COMPACTION_PROMPT_KEYS: CompactionPromptKeys = {
  system: "analysis-agent.compaction.system",
  summarize: "analysis-agent.compaction.summarize.user",
  update: "analysis-agent.compaction.update.user",
};

export interface RunAnalysisLoopParams {
  userQuestion: string;
  userId: string;
  threadId: string;
  taskId?: string;
  /** 受理时捕获的运行身份；产物与终态据此确认是否仍可写当前任务。 */
  identity?: AnalysisRunIdentity;
  agentId: string;
  domainId: string;
  token: string;
  apiKey?: string;
  locale?: string;
  onEvent?: (event: DeepAnalysisEmittedEvent) => void;
  signal?: AbortSignal;
  /** 常规会话的当前轮；提供时逐轮持久化消息、活动与最终回复，并且不交付报告正文。 */
  conversationTurn?: AnalysisConversationTurnRecord;
  /** 入口对报告交付件的覆盖；不提供时使用智能体配置。 */
  reportDeliverableEnabled?: boolean;
}

function buildSystemPrompt(params: {
  datasetSchema: string;
  loopPrompt?: string;
  dataProbeCapability: string;
  deliverableCapability: string;
  completionInstruction: string;
  chartCapability: string;
  skillCapability: string;
  externalMcpCapability: string;
}): string {
  const trimmed = params.loopPrompt?.trim();
  return renderPrompt("analysis-agent.loop.system", {
    datasetSchema: params.datasetSchema,
    loopPromptContext: trimmed ? tApp("analysis.loop.loop-workflow.266", { trimmed: trimmed }) : "",
    dataProbeCapability: params.dataProbeCapability,
    deliverableCapability: params.deliverableCapability,
    completionInstruction: params.completionInstruction,
    chartCapability: params.chartCapability,
    skillCapability: params.skillCapability,
    externalMcpCapability: params.externalMcpCapability,
  });
}

export async function runAnalysisLoopWorkflow(
  params: RunAnalysisLoopParams
): Promise<DeepAnalysisTaskPayload> {
  const { userQuestion, userId, threadId, taskId, agentId, token, signal } = params;
  const apiKey = params.apiKey || "";

  await initializeConnection();

  const agentService = await getAnalysisAgentService();
  const domainId = params.domainId;
  const agent = await agentService.getAgent(agentId, domainId);
  if (!agent) {
    throw new Error(t("analysis.agentNotFound", { agentId }));
  }
  // 常规会话只交付每轮最终回复；报告任务按智能体配置或入口覆盖装配报告交付件。
  const reportDeliverableEnabled = params.conversationTurn
    ? false
    : (params.reportDeliverableEnabled ?? agent.reportDeliverableEnabled) !== false;

  const conversationTurn = params.conversationTurn;
  const requestSeq = conversationTurn?.requestSeq ?? (await allocateRequestSeq(threadId));
  await recordTurnRunStart({ threadId, requestSeq, source: "analysis" });
  const turn = buildTurnIdentity(threadId, requestSeq);

  return runWithLogContext({ domainId, turn }, async () => {
    const taskService = getAnalysisTaskService();
    let state: AgentState | undefined;
    let sessionId: string | undefined;
    let harnessTurnId: string | undefined;
    let harnessStatus: "completed" | "failed" | "cancelled" = "failed";
    let turnSaveQueue = Promise.resolve();
    /** 中间过程随事件写入回合；失败只记日志，终态仍保存完整回合。 */
    const saveTurnProgress = () => {
      if (!conversationTurn || !taskId) return;
      const payload = trajectory.current();
      conversationTurn.activities = payload.activities;
      conversationTurn.charts = payload.charts;
      conversationTurn.chartDiagnostics = payload.chartDiagnostics;
      const snapshot = structuredClone(conversationTurn);
      turnSaveQueue = turnSaveQueue
        .then(() => taskService.saveConversationTurn(taskId, snapshot))
        .catch((error) =>
          logger.error(tApp("analysis.loop.loop-workflow.267"), {
            taskId,
            requestSeq,
            error,
          })
        );
    };
    const sendEvent = (event: DeepAnalysisEmittedEvent) => {
      saveTurnProgress();
      params.onEvent?.({ ...event, requestSeq });
    };
    const loopSignal = signal || new AbortController().signal;

    const trajectory = createDeepAnalysisArtifactStore({
      taskId,
      identity: params.identity,
      requestSeq,
      executionMode: "loop",
      emit: sendEvent,
    });
    let notebook: ReturnType<typeof assembleLoopNotebookCapability>["notebook"];
    const persistArtifacts = async (
      status: "completed" | "failed" | "cancelled",
      report: string,
      finalAnswer?: string,
      error?: string
    ) => {
      harnessStatus = status;
      if (reportDeliverableEnabled)
        trajectory.section({
          sectionId: "report",
          markdown: report,
          mode: "replace",
          status: report.trim() ? "success" : "failed",
          error,
        });
      const payload = await trajectory.finish(status, error, finalAnswer);
      if (conversationTurn && taskId) {
        Object.assign(conversationTurn, {
          status,
          finalAnswer,
          error,
          activities: payload.activities,
          charts: payload.charts,
          chartDiagnostics: payload.chartDiagnostics,
        });
        await turnSaveQueue;
        await taskService.saveConversationTurn(taskId, conversationTurn);
      }
      return payload;
    };

    try {
      loopSignal.throwIfAborted();
      if (taskId) {
        sessionId = await taskService.openHarnessSession(
          taskId,
          !!conversationTurn,
          params.identity ?? { requestSeq }
        );
      } else {
        sessionId = uuidv4();
        await harnessSessions.create(sessionId);
      }
      harnessTurnId = (await harnessSessions.beginTurn(sessionId)).turnId;
      if (conversationTurn && taskId) {
        await taskService.bindHarnessTurn(taskId, requestSeq, harnessTurnId);
        conversationTurn.harnessTurnId = harnessTurnId;
      }
      const previousTurns =
        conversationTurn && taskId
          ? (await taskService.listConversationTurns(taskId)).filter(
              (previous) => previous.requestSeq < requestSeq
            )
          : [];
      const initialEvidence = new Map<
        string,
        { question: string; entries: QueryResultDatasetEntry[] }
      >();
      for (const ref of previousTurns.flatMap((previous) => previous.evidenceRefs)) {
        const query = await getQueryRunBySource(ref);
        if (!query) continue;
        initialEvidence.set(ref.questionId, {
          question: ref.question,
          entries: expandQueryResultDatasetEntries({
            data: query.dataPayload,
            datasets: query.datasetsPayload,
            dsl: query.dslPayload,
            baseTitle: ref.question,
          }),
        });
      }
      const enabledMcpServiceNames = agent.enabledMcpServiceNames || [];
      const externalMcpCapability = await assembleLoopExternalMcpCapability({
        selectedServiceNames: enabledMcpServiceNames,
        domainId,
        signal: loopSignal,
        trajectory,
      });

      const notebookCapability = assembleLoopNotebookCapability({
        reportDeliverableEnabled,
        dirKey: taskId || `${threadId}-${requestSeq}`,
        trajectory,
      });
      notebook = notebookCapability.notebook;
      const evidenceCapability = assembleLoopEvidenceCapability({
        threadId,
        requestSeq,
        token,
        apiKey,
        userId,
        locale: params.locale,
        classNames: agent.classNames,
        signal: loopSignal,
        trajectory,
        initialEvidence,
        onEvidence: (questionId, question) => {
          if (!conversationTurn) return;
          conversationTurn.evidenceRefs.push({
            questionId,
            question,
            threadId,
            requestSeq,
            sourceKind: "analysis_sub_question",
            sourceRef: questionId,
          });
          saveTurnProgress();
        },
      });
      const dataProbeCapability = assembleLoopDataProbeCapability({
        token,
        apiKey,
        userId,
        locale: params.locale,
        classNames: agent.classNames,
        signal: loopSignal,
        trajectory,
      });

      const datasetSchema = await datasetSchemaService.getSchemaForQuestion(
        userQuestion,
        token,
        apiKey,
        agent.classNames
      );

      const selectedSkillIds = agent.enabledSkillIds || [];
      const skillCapability = await assembleLoopSkillCapability({
        domainId,
        selectedSkillIds,
        resolveEvidence: evidenceCapability.resolveEvidence,
        trajectory,
      });

      const systemModel = resolveSystemModel(domainId);
      const modelConfig: ModelConfig = {
        baseUrl: systemModel.baseUrl,
        apiKey: systemModel.apiKey,
        modelName: systemModel.modelName,
        modelKwargs: systemModel.customRequestParameters,
        llmLog: { agentName: modelAgentName("analysisLoop"), agentRunId: uuidv4() },
      };

      const dispatchTool = assembleLoopDispatchCapability({
        modelConfig,
        parentSessionId: sessionId,
        contextWindow: systemModel.contextWindow,
        compactionPromptKeys: ANALYSIS_LOOP_COMPACTION_PROMPT_KEYS,
        compactionPromptVariables: notebookCapability.compactionPromptVariables,
        reportDeliverableEnabled,
        workerPrompt: {
          datasetSchema,
          dataProbeCapability: dataProbeCapability.prompt,
          skillCapability: skillCapability.prompt,
          deliverableCapability: notebookCapability.workerPrompt,
        },
        workerTools: {
          evidence: evidenceCapability.createWorkerTool,
          probe: dataProbeCapability.createWorkerTools,
          skills: skillCapability.workerTools,
          notebook: notebookCapability.createWorkerTools,
        },
        taskId,
        taskService,
        trajectory,
      });

      const chartCapability = assembleLoopChartCapability({
        domainId,
        userQuestion,
        visualizationSkillIds: agent.enabledVisualizationSkillIds || [],
        reportDeliverableEnabled,
        resolveCandidates: evidenceCapability.resolveChartCandidates,
        trajectory,
      });

      const tools = [
        evidenceCapability.supervisorTool,
        dispatchTool,
        ...dataProbeCapability.supervisorTools,
        ...skillCapability.supervisorTools,
        ...externalMcpCapability.supervisorTools,
        ...notebookCapability.supervisorTools,
        ...chartCapability.supervisorTools,
      ];

      state = {
        systemPrompt: buildSystemPrompt({
          datasetSchema,
          loopPrompt: agent.loopPrompt,
          dataProbeCapability: dataProbeCapability.prompt,
          deliverableCapability: notebookCapability.supervisorPrompt,
          completionInstruction: notebookCapability.completionInstruction,
          chartCapability: chartCapability.prompt,
          skillCapability: skillCapability.prompt,
          externalMcpCapability: externalMcpCapability.prompt,
        }),
        messages: [],
        tools,
        isStreaming: false,
      };

      const compactionPromptVariables = notebookCapability.compactionPromptVariables;
      let narrativeActivityId: string | undefined;
      let streamedNarrative = "";

      const recordNarrativeEvent = (event: AgentEvent) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          streamedNarrative += event.assistantMessageEvent.delta || "";
          if (!streamedNarrative.trim()) return;
          if (narrativeActivityId) {
            trajectory.update(narrativeActivityId, { narrative: streamedNarrative });
          } else {
            narrativeActivityId = trajectory.start("narrative", { narrative: streamedNarrative });
          }
          return;
        }

        if (event.type !== "message_end" || event.message.role !== "assistant") return;
        const narrative = lastAssistantText([event.message]).text || streamedNarrative.trim();
        if (narrative) {
          narrativeActivityId ||= trajectory.start("narrative", { narrative });
          trajectory.settle(narrativeActivityId, "completed", { narrative });
        }
        narrativeActivityId = undefined;
        streamedNarrative = "";
      };

      await runAgentLoop(userQuestion, state, modelConfig, recordNarrativeEvent, loopSignal, {
        session: await createHarnessRun(harnessSessions, {
          sessionId,
          turnId: harnessTurnId,
          contextWindow: systemModel.contextWindow,
          promptKeys: ANALYSIS_LOOP_COMPACTION_PROMPT_KEYS,
          promptVariables: compactionPromptVariables,
        }),
      });

      // 报告件兜底组装全部非空部分；无报告件以最后一条助手文本直接交付。
      const report = notebook?.assembleAll() || "";
      const finalAnswer = reportDeliverableEnabled
        ? undefined
        : lastAssistantText(state.messages).text;

      if (loopSignal.aborted) {
        logger.info(tApp("analysis.loop.loop-workflow.268"), {
          taskId,
          reportLength: report.length,
          finalAnswerLength: finalAnswer?.length || 0,
        });
        const payload = await persistArtifacts("cancelled", report, finalAnswer);
        await recordTurnRunFinish({ threadId, requestSeq, status: "cancelled" });
        return payload;
      }

      if (reportDeliverableEnabled && !report.trim()) {
        await persistArtifacts("failed", report);
        await recordTurnRunFinish({ threadId, requestSeq, status: "failed" });
        throw new Error(tApp("analysis.loop.loop-workflow.269"));
      }

      const payload = await persistArtifacts("completed", report, finalAnswer);
      await recordTurnRunFinish({ threadId, requestSeq, status: "completed" });

      logger.info(tApp("analysis.loop.loop-workflow.270"), {
        taskId,
        agentId,
        reportLength: report.length,
        finalAnswerLength: finalAnswer?.length || 0,
        chapterCount: notebook?.chapters().length || 0,
        activityCount: trajectory.current().activities.length,
      });

      return payload;
    } catch (error) {
      const status = loopSignal.aborted ? "cancelled" : "failed";
      const message = error instanceof Error ? error.message : String(error);
      await persistArtifacts(
        status,
        notebook?.assembleAll() || "",
        reportDeliverableEnabled ? undefined : lastAssistantText(state?.messages || []).text,
        message
      );
      await recordTurnRunFinish({ threadId, requestSeq, status });
      if (status === "cancelled") return trajectory.current();
      throw error;
    } finally {
      // 文件只是过程载体，终态产物已写入唯一权威存储，工作目录随本次运行清理。
      try {
        if (sessionId && harnessTurnId)
          await harnessSessions.finishTurn(sessionId, harnessTurnId, harnessStatus);
      } finally {
        notebook?.dispose();
      }
    }
  });
}
