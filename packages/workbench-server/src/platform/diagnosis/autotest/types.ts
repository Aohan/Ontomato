import type { RunCaseResult } from "@ontomato/contracts/autotest";
export interface RunConfig {
  domainId: string;
  caseSetId: string;
  /** Optional override concurrency for this run. */
  concurrency?: number;
  /** Optional number of independent server-side rounds to run. */
  rounds?: number;
  /** Optional per-case timeout override for this run. */
  caseTimeoutMs?: number;
  /** Optional user id for authentication passthrough. */
  userId?: string;
  /** Optional token for authentication passthrough. */
  tk?: string;
}

// ---- Execution Result (from strategy) --------------------------------

export interface ExecutionResult {
  turnKey?: string;
  finalAnswer?: string;
  durationMs: number;
  status: "success" | "error" | "cancelled";
  error?: string;
}

export interface CaseResult extends RunCaseResult {
  runId: string;
}
