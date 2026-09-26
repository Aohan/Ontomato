import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import type { AnalysisActivity } from "@ontomato/contracts/analysis-presentation";
import type { AnalysisTaskDetail, LoopSubagentTrace } from "@ontomato/contracts/analysis-task";
import { toEgressMessages } from "../../../core/agent-loop/index";
import { buildTurnKey } from "../../../logging/log-context";
import { getQueryRunBySource } from "../../data-query/query-run-store";
import { toDisplayFact, toQueryExecutionFact } from "../../data-query/query-fact";
import type { AnalysisTask, AnalysisLoopSubagentAudit } from "../task-types";
import { tApp } from "../../../i18n";


export function toClientTask(task: AnalysisTask): AnalysisTaskDetail {
  const {
    analysisPayload,
    token: _token,
    requestSeq: _requestSeq,
    domainId: _domainId,
    ...clientTask
  } = task;
  return { ...clientTask, ...analysisPayload };
}

/** 底座出口视图之上只叠加分析业务拥有的探测正文策略。 */
export function toSubagentAuditEgress(audit: AnalysisLoopSubagentAudit): LoopSubagentTrace {
  return {
    ...audit,
    messages: toEgressMessages(audit.messages, {
      thinking: "omit",
      toolResultContent: "full",
    }).map((message): EgressMessage => {
      if (message.role === "toolResult") {
        if (message.toolName === "probe_classes" || message.toolName === "probe_class_data") {
          return {
            ...message,
            content: [{ type: "text", text: tApp("analysis.task.task-read-model.412") }],
          };
        }
      }
      return message;
    }),
  };
}

export async function buildTaskProvenance(task: AnalysisTask) {
  const payload = task.analysisPayload;
  if (!payload) return null;
  const { requestSeq, threadId } = task;
  const canRead = !!threadId && requestSeq !== undefined;
  const activities = await attachQuestionExecution(payload.activities, { threadId, requestSeq });
  return {
    taskId: task.id,
    taskName: task.name,
    question: task.question || task.name,
    status: task.status,
    executionMode: payload.executionMode,
    parentTurnKey: canRead ? buildTurnKey(threadId!, requestSeq!) : undefined,
    activities,
  };
}

/**
 * 给活动里的问数问题补查询执行事实：按**本回合自己的**线程、受理序号与问题稳定身份读 query_runs。
 * 报告快照与常规会话回合共用这一条读取规则；缺记录时保持问题原有事实，不造 DSL、数据或成功结论。
 */
export async function attachQuestionExecution(
  activities: AnalysisActivity[],
  scope: { threadId?: string; requestSeq?: number }
): Promise<AnalysisActivity[]> {
  const { threadId, requestSeq } = scope;
  return Promise.all(
    activities.map(async (activity) =>
      activity.questions
        ? {
            ...activity,
            questions: await Promise.all(
              activity.questions.map(async (question) => {
                const run =
                  threadId && requestSeq !== undefined
                    ? await getQueryRunBySource({
                        threadId,
                        requestSeq,
                        sourceKind: "analysis_sub_question",
                        sourceRef: question.questionId,
                      })
                    : null;
                return {
                  ...question,
                  execution: {
                    ...question.execution,
                    ...(run ? toDisplayFact(toQueryExecutionFact(run)) : {}),
                    dataCount: run?.dataCount ?? question.dataCount ?? 0,
                    error: question.error || run?.error || undefined,
                  },
                };
              })
            ),
          }
        : activity
    )
  );
}
