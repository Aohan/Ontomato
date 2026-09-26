import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { BranchKey, ThinkingAbcState } from "@ontomato/contracts/query-thinking";
import type { HotCard, HotJudgeResult } from "../hot-data/hot-data-utils";
import type { FetchedCardResult } from "../hot-data/hot-data-fetcher";
import type { Dataset } from "../adapter";
import type { ThinkingBranchView } from "../thinking/thinking-buffer";

import type { HotReportReplayPlan, OutKeyRef } from "../replay-plan";

export interface BaseQueryOutput {
  content: string;
  datasets: Dataset[];
  sessionId?: string;
  backendNodeId?: string;
  nodeIds?: string[];
  subQuestions?: string[];
  abcDsls?: unknown[];
  abcCodes?: string[];
  abcOutKeyRefs?: OutKeyRef[][];
  replayPlan?: HotReportReplayPlan;
  errors?: string[];
}

export interface QueryBackendLocation {
  sessionId?: string;
  backendNodeId?: string;
}

export interface BranchContext<K extends BranchKey> {
  queryQuestion: string;
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
  abcQuestionMode: AbcQuestionMode;
  classNames?: string[];
  pushEvent: (event: any) => void;
  thinking: ThinkingBranchView<K>;
  signal: AbortSignal;
  /** 分支拿到自己的后端会话位置即上报；是否仍活跃由执行器判定 */
  reportBackendLocation: (location: QueryBackendLocation) => void;
}

export interface AbcBranchContext extends BranchContext<"abc"> {
  reportFallback: (output: BaseQueryOutput) => void;
  setAbcThinking: (state?: ThinkingAbcState) => void;
}

export type { HotCard, HotJudgeResult, FetchedCardResult, Dataset, OutKeyRef };
