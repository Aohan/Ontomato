import type { AnalysisTaskRun } from "@ontomato/contracts/analysis-task";
import { isAnalysisTaskTerminalStatus } from "./events";
import { tApp } from "../../../i18n";


/**
 * Stable identity of one run: a report run generates its run ID at acceptance, and a regular-session turn records its acceptance sequence at the same time.
 * Terminal states and artifact updates locate their own history record through it and confirm the current task facts are still writable.
 */
export interface AnalysisRunIdentity {
  runId?: string;
  requestSeq?: number;
}

/** The last run record is the most recently accepted run; absent means no run has been accepted. */
export function currentAnalysisRunId(runs: AnalysisTaskRun[] | undefined): string | undefined {
  return runs?.[runs.length - 1]?.id;
}

/**
 * Run identity captured at acceptance: prefer the latest run record; a regular session falls back to the turn sequence while the task row has not been read back.
 * With no accepted run there is no attributable identity, and run-attribution writes must not happen.
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
 * The task's run-history column is a non-empty JSONB array; a non-array means persisted content contradicts the contract,
 * so it throws instead of being treated as "identity mismatch", keeping bad data from being silently read as a no-op.
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

/** Whether the identity points at the most recently accepted run; only that run may still rewrite the task's current state and artifacts. */
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
 * Terminal-state/artifact updates rewrite in place only the history record whose identity matches.
 *
 * When the identity is absent or matches nothing it returns undefined (leave as-is): it never rewrites another run and never fabricates a run.
 * Appending run records happens only at start acceptance (tryStartTask / claimConversationTurn).
 * Duplicate writes of the same terminal state therefore never stack; a late write stays on its own run record and cannot reach the new run.
 * Terminal states are monotonic: once a record is terminal it only accepts completion of the same terminal state (summary/body), never a state regression or a different terminal state.
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
