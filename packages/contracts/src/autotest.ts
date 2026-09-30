import type { ArtifactRetention } from "./observe";
export type RunEvent = { runId: string; timestamp: number } & (
  | { type: "case_start"; data: { caseId: string; question: string; index: number } }
  | { type: "case_log"; data: { caseId: string; label: string } }
  | {
      type: "case_end";
      data: {
        caseId: string;
        status: CaseStatus;
        verdict: CaseVerdict;
        verdictReason: string;
        durationMs?: number;
        error?: string;
      };
    }
  | {
      type: "progress";
      data: { completed: number; total: number; percent: number; summary?: RunSummary };
    }
  | { type: "status_change"; data: { status: RunStatus } }
  | { type: "run_complete"; data: { summary: RunSummary; status?: RunStatus; error?: string } }
);

export type RunEventType = RunEvent["type"];

// ---- Run ------------------------------------------------------------

export type RunStatus = "queued" | "running" | "stopping" | "completed" | "failed" | "cancelled";

export type CaseStatus = "queued" | "running" | "success" | "failed" | "error" | "cancelled";

export interface RunSummary {
  total: number;
  correct: number;
  wrong: number;
  abnormal: number;
}

export interface TestCase {
  caseId: string;
  question: string;
  expectedAnswer?: string;
  expectedLogic?: string;
  judgment?: string;
}

export interface CaseSet {
  id: string;
  name: string;
  cases: TestCase[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseSetListItem extends Omit<CaseSet, "cases"> {
  caseCount: number;
}

export interface RunMeta {
  domainId?: string;
  runId: string;
  caseSetId: string;
  caseSetName: string;
  status: RunStatus;
  summary: RunSummary;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface EvaluationResult {
  /** undefined means evaluation itself failed (distinct from false = evaluated but not passed). */
  passed?: boolean;
  answerSummary?: string;
  analysis?: string;
  error?: string;
}

export interface RunCaseResult {
  caseId: string;
  threadId: string;
  status: CaseStatus;
  question: string;
  finalAnswer?: string;
  turnKey?: string;
  durationMs?: number;
  error?: string;
  answerEvaluation?: EvaluationResult;
}

export interface CaseSetImportResult {
  id: string;
  name: string;
  caseCount: number;
  warnings: string[];
}

export type RetainedRunMeta = RunMeta & ArtifactRetention;

export interface RunResults {
  runId: string;
  summary: RunSummary;
  results: RunCaseResult[];
}

export type CaseVerdict = "correct" | "wrong" | "abnormal";
