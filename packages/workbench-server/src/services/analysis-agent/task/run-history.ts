import type { AnalysisTaskRun } from "@ontomato/contracts/analysis-task";
import { isAnalysisTaskTerminalStatus } from "./events";
import { tApp } from "../../../i18n";


/**
 * 一次运行的稳定身份：报告运行在受理时生成运行 ID，常规会话回合同步记录受理序号。
 * 终态与产物更新据此定位自己的历史记录，并确认是否仍可改写当前任务事实。
 */
export interface AnalysisRunIdentity {
  runId?: string;
  requestSeq?: number;
}

/** 最后一条运行记录就是最近一次受理的运行；缺省表示当前没有已受理的运行。 */
export function currentAnalysisRunId(runs: AnalysisTaskRun[] | undefined): string | undefined {
  return runs?.[runs.length - 1]?.id;
}

/**
 * 受理时捕获的运行身份：优先取最近一条运行记录，常规会话在任务行尚未回读时用回合序号。
 * 没有已受理的运行就没有可归属的身份，运行归属的写入不得发生。
 */
export function currentAnalysisRunIdentity(
  runs: AnalysisTaskRun[] | undefined,
  fallbackRequestSeq?: number
): AnalysisRunIdentity | undefined {
  const last = runs?.[runs.length - 1];
  if (last?.id) {
    return last.requestSeq !== undefined
      ? { runId: last.id, requestSeq: last.requestSeq }
      : { runId: last.id };
  }
  if (fallbackRequestSeq !== undefined) return { requestSeq: fallbackRequestSeq };
  return undefined;
}

/**
 * 任务的运行历史列是 JSONB 非空数组；非数组说明持久化内容与契约不符，
 * 抛出而不是当成“身份不匹配”，避免坏数据被静默当作无操作。
 */
export function readAnalysisRunHistory(value: unknown): AnalysisTaskRun[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(tApp("analysis.task.run-history.406"));
  }
  return value as AnalysisTaskRun[];
}

function findRunIndex(history: readonly AnalysisTaskRun[], identity: AnalysisRunIdentity): number {
  if (identity.runId !== undefined) {
    return history.findIndex((run) => run.id === identity.runId);
  }
  if (identity.requestSeq !== undefined) {
    return history.findIndex((run) => run.requestSeq === identity.requestSeq);
  }
  return -1;
}

/** 身份是否指向最近一次受理的运行；只有它仍可改写任务的当前状态与产物。 */
export function isCurrentAnalysisRun(
  history: readonly AnalysisTaskRun[],
  identity: AnalysisRunIdentity
): boolean {
  const last = history[history.length - 1];
  if (!last) return false;
  if (identity.runId !== undefined) return last.id === identity.runId;
  if (identity.requestSeq !== undefined) return last.requestSeq === identity.requestSeq;
  return false;
}

/**
 * 终态/产物更新只原地改写身份匹配的那条历史记录。
 *
 * 身份缺省或匹配不到时返回 undefined（保持原样），既不改写别的运行，也不补造运行：
 * 追加运行记录只发生在启动受理（tryStartTask / claimConversationTurn）。
 * 因此同一终态的重复写入不叠加，迟到写入留在自己的运行记录上，覆盖不到新运行。
 * 终态单调：记录已终态后只接受同一终态的补齐（摘要/正文），不接受状态回退或被换成别的终态。
 */
export function applyAnalysisRunUpdate(
  history: readonly AnalysisTaskRun[],
  identity: AnalysisRunIdentity,
  patch: Partial<AnalysisTaskRun>
): AnalysisTaskRun[] | undefined {
  const index = findRunIndex(history, identity);
  if (index < 0) return undefined;
  const record = history[index];
  const terminal = isAnalysisTaskTerminalStatus(record.status);
  if (terminal && patch.status !== undefined && patch.status !== record.status) return undefined;
  const merged: AnalysisTaskRun = { ...record, ...patch };
  if (terminal) merged.status = record.status;
  const next = history.slice();
  next[index] = merged;
  return next;
}
