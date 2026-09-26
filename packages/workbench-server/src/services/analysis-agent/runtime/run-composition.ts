/**
 * 一次分析任务运行由哪些问数问题组成，以及它的可读最终回复。
 *
 * 分析任务是"复合运行"的实例：一次运行 = 自身证据 + 若干子 Turn 证据。
 * 子 Turn 列表统一从任务活动中的问题展开；调用方不依赖执行形态。
 */

import { parseTurnKey } from "../../../logging/log-context";
import { getAnalysisTaskService } from "../task/task-service";
import { buildDeepAnalysisTaskSnapshot } from "../task/task-result";

import type { AnalysisTask } from "../task-types";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";

/** 一次运行中的单个问数问题：稳定身份、展示文案与业务执行状态。 */
export interface AnalysisRunQuestion {
  /** 稳定身份，与查询运行的 sourceRef 一致 */
  questionId: string;
  /** 展示文案，不参与关联 */
  question: string;
  /** 问题的业务执行状态，与诊断产物状态无关 */
  status: string;
}

/** 一次分析任务运行的组成。 */
export interface AnalysisRunComposition {
  taskId: string;
  agentId: string;
  threadId: string;
  requestSeq: number;
  /** 本次运行的用户问题 */
  question: string;
  /** 本次运行的可读最终回复；没有可读报告时为空 */
  report?: string;
  /** 按受理顺序排列的问数问题 */
  questions: AnalysisRunQuestion[];
}

/**
 * 解析一个 Turn 是否是分析任务运行；不是则返回 null。
 * 子 Turn 身份（带来源类型的 turnKey）不是运行入口，一律返回 null。
 */
export async function resolveAnalysisRunComposition(
  turnKey: string
): Promise<AnalysisRunComposition | null> {
  const identity = parseTurnKey(turnKey);
  if (!identity || identity.sourceKind) return null;

  const task = await getAnalysisTaskService().getTaskByThreadAndRequestSeq(
    identity.threadId,
    identity.requestSeq
  );
  if (!task) return null;

  const payload = task.analysisPayload;
  const questions =
    payload?.activities.flatMap((activity) =>
      (activity.questions || []).map(({ questionId, question, status }) => ({
        questionId,
        question,
        status,
      }))
    ) || [];

  return {
    taskId: task.id,
    agentId: task.agentId,
    threadId: identity.threadId,
    requestSeq: identity.requestSeq,
    question: task.question || task.name || "",
    report: resolveReport(task, payload),
    questions,
  };
}

/** 可读最终回复取任务域既有的回看构造，不从线程消息或回复快照推断。 */
function resolveReport(task: AnalysisTask, payload?: DeepAnalysisTaskPayload): string | undefined {
  if (!payload) return undefined;
  const snapshot = buildDeepAnalysisTaskSnapshot({
    taskId: task.id,
    threadId: task.threadId,
    status: task.status,
    requestSeq: task.requestSeq,
    payload,
    fallbackText: task.resultReport || task.resultSummary,
  });
  return snapshot.primaryText || undefined;
}
