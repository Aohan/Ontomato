export type ThinkingBranchStatus =
  | "idle"
  | "running"
  | "success"
  | "insufficient"
  | "not_found"
  | "failed"
  | "cancelled";

export interface ThinkingBranchCard {
  md: string;
  url: string;
  originQuestion?: string;
  parameterInstanceDesc?: string[];
  originSubQuery?: unknown;
  originCheckResult?: unknown;
}

export interface ThinkingBranchState {
  key: BranchKey;
  label: string;
  status: ThinkingBranchStatus;
  detail?: string;
  logs: string[];
  winner?: boolean;
  content?: string;
  cards?: ThinkingBranchCard[];
}

export interface ThinkingProgress {
  current: number;
  total: number;
  label?: string;
}

export interface ThinkingAbcStep extends ThinkingStep {
  key: string;
  label: string;
  active?: boolean;
  detail?: string;
  status: "waiting" | "running" | "done" | "failed" | "cancelled";
}

export interface ThinkingAbcState {
  status: "idle" | "running" | "success" | "failed" | "cancelled";
  steps: ThinkingAbcStep[];
  progress?: ThinkingProgress | null;
}

export interface QueryThinkingState {
  summary: string;
  headline?: string;
  status: "running" | "completed" | "failed";
  winner?: BranchKey | null;
  branches: ThinkingBranchState[];
  abc?: ThinkingAbcState;
  tailLines?: string[];
}

export interface ThinkingStep {
  text: string;
  done: boolean;
  timestamp: number;
}

export type BranchKey = "static" | "hot" | "abc";

export interface QcStepState {
  summary?: string;
  meaning?: string;
  status: "running" | "done" | "failed";
  timestamp: number;
}

export interface QcResultState {
  conclusion?: string;
  score?: number;
  fittedQuestion?: string;
}

export interface QcState {
  /** unsettled: still unresolved past the bounded time limit; neither completed nor failed */
  status: "running" | "completed" | "failed" | "unsettled";
  steps: QcStepState[];
  result?: QcResultState;
}

export interface QcStepEvent {
  summary?: string;
  meaning?: string;
  label?: string;
}

export interface QcResult {
  score?: number;
  fittedQuestion?: string;
  conclusion?: string;
  steps: QcStepEvent[];
}
