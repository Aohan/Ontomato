import type {
  QueryThinkingState,
  ThinkingBranchCard,
  ThinkingBranchState,
} from "@ontomato/contracts/query-thinking";
import type {
  QueryExecutionDisplayFact,
  QueryBackendSession,
} from "@ontomato/contracts/query-execution";
/**
 * 一次问数问题的执行事实：唯一的结果模型与唯一的持久化构造。
 *
 * 标准问数与分析子问题都只是调用方——它们决定启用哪些查询分支、以及在这份事实
 * 之外叠加什么（回合级组装、或计划身份与业务执行状态），但不各自定义结果形状，
 * 也不各自决定往查询运行事实里写哪些列。
 */

import { t } from "../../i18n";
import type { QueryRun, UpsertQueryRunInput } from "./query-run-store";
import { buildThinkingSteps, buildThinkingSummary } from "./thinking/thinking-state";

import type { HotReportReplayPlan, OutKeyRef } from "./replay-plan";

/**
 * 执行事实。字段按"本次执行实际产生了什么"取值，没有产生就不存在——
 * 查询模式差异（DSL 型与程序型二级拆解）只表现为事实有无。
 */
export interface QueryExecutionFact extends QueryExecutionDisplayFact {
  abcOutKeyRefs?: OutKeyRef[][];
  /** 本次执行产生的后端会话列表，供诊断定位后端证据 */
  backendSessions?: QueryBackendSession[];
  /** 图谱中需要定位的节点 */
  nodeIds?: string[];
  dslText?: string;
  ir?: string;
  objectClasses?: string[];
  replayPlan?: HotReportReplayPlan;
  /** 命中卡片与胜出分支 */
  cards?: ThinkingBranchCard[];
}

/** 已退役的预计算分支键：只存在于退役前保存的查询运行事实里，当前执行器不再产生。 */
const RETIRED_BRANCH_KEY = "reportCard";

/**
 * 退役分支胜出的历史问数：它生成的答案与查询过程都不再展示。winner 列与思考状态
 * 都是已落盘的胜出事实（旧行的 winner 列由迁移回填），任一记为退役分支即是。
 */
export function isWonByRetiredBranch(run: QueryRun | null | undefined): boolean {
  return run?.winner === RETIRED_BRANCH_KEY || run?.thinkingState?.winner === RETIRED_BRANCH_KEY;
}

/** 落盘的分支键是字符串：退役前保存的记录里可能是已退役的分支。 */
type SavedThinkingBranch = Omit<ThinkingBranchState, "key"> & { key: string };

/** 去掉退役分支后，剩下的都是当前执行器产生过的分支。 */
function isCurrentBranch(branch: SavedThinkingBranch): branch is ThinkingBranchState {
  return branch.key !== RETIRED_BRANCH_KEY;
}

/**
 * 读回思考过程。退役前保存的思考状态含预计算分支：去掉它，并按执行器的方式重建
 * 标题、摘要与步骤，使过程只呈现当前分支；其他运行原样读回。
 */
function readThinking(run: QueryRun | null | undefined) {
  const saved = run?.thinkingState;
  // 旧行迁移只保证思考状态是对象，不保证带 branches。
  const branches: SavedThinkingBranch[] | undefined = saved?.branches;
  if (!branches || branches.every(isCurrentBranch)) {
    return { summary: run?.thinkingSummary, steps: run?.thinkingSteps, state: saved };
  }
  const state: QueryThinkingState = {
    ...saved,
    headline: t("query.thinking.parallelStart"),
    branches: branches.filter(isCurrentBranch),
  };
  state.summary = buildThinkingSummary(state);
  return { summary: state.summary, steps: buildThinkingSteps(state.summary), state };
}

/**
 * 把已保存的查询运行事实读回执行事实。与 buildQueryRunInput 成对：写入与读取
 * 各只有一处，调用方不再逐字段手抄，新增事实不会静默漏到某个读取方。
 */
export function toQueryExecutionFact(run?: QueryRun | null): QueryExecutionFact {
  if (isWonByRetiredBranch(run)) return {};
  const thinking = readThinking(run);
  return {
    // 已落盘旧运行事实没有 fullContent 值：回退到同一行的结果表格，
    // 否则这些真实结果在历史里不可见。新写入都带 fullContent。
    fullContent: run?.fullContent ?? run?.markdownTable,
    thinkingSummary: thinking.summary,
    thinkingSteps: thinking.steps,
    thinkingState: thinking.state,
    backendSessions: run?.backendSessions,
    nodeIds: run?.nodeIds,
    markdownTable: run?.markdownTable,
    data: run?.dataPayload,
    datasets: run?.datasetsPayload,
    datasetPreviews: run?.datasetPreviews,
    dsl: run?.dslPayload,
    dslText: run?.dslText,
    ir: run?.ir,
    objectClasses: run?.objectClasses,
    dataCount: run?.dataCount,
    abcSubQuestions: run?.abcSubQuestions,
    abcDsls: run?.abcDsls,
    abcCodes: run?.abcCodes,
    abcOutKeyRefs: run?.abcOutKeyRefs,
    replayPlan: run?.replayPlan,
    cards: run?.cards,
    winner: run?.winner as QueryExecutionFact["winner"],
    qcResult: run?.qcResult,
    qcState: run?.qcState,
    error: run?.error,
  };
}

const DISPLAY_FACT_KEYS = [
  "thinkingSummary",
  "thinkingSteps",
  "fullContent",
  "markdownTable",
  "data",
  "datasets",
  "datasetPreviews",
  "dsl",
  "dataCount",
  "abcSubQuestions",
  "abcDsls",
  "abcCodes",
  "abcOutKeyRefs",
  "thinkingState",
  "winner",
  "qcState",
  "qcResult",
  "error",
] as const satisfies readonly (keyof QueryExecutionDisplayFact)[];

/** 取执行事实的展示部分。未产生的事实不出现，调用方据"有无"决定渲染与否。 */
export function toDisplayFact(
  fact: QueryExecutionFact | null | undefined
): QueryExecutionDisplayFact {
  const display: Record<string, unknown> = {};
  if (!fact) return display;
  for (const key of DISPLAY_FACT_KEYS) {
    if (fact[key] !== undefined) display[key] = fact[key];
  }
  return display;
}

/** 查询运行的稳定身份。 */
export interface QueryRunIdentity {
  threadId: string;
  requestSeq: number;
  sourceKind: string;
  sourceRef: string;
  sourceStage?: string;
}

/**
 * 把执行事实转换为查询运行事实的写入输入。这是唯一的持久化构造：
 * 标准问数与分析子问题经由它写入同一批列。
 */
export function buildQueryRunInput(input: {
  identity: QueryRunIdentity;
  question: string;
  status?: string;
  error?: string;
  fact: QueryExecutionFact;
}): UpsertQueryRunInput {
  const { identity, fact } = input;
  // DSL 文本、对象类清单与数据条数都能从本次数据集确定性推导；两个调用方共用同一份推导，
  // 不各自实现，也不让其中一方漏写。调用方显式给出时以调用方为准。
  const datasets = Array.isArray(fact.datasets) ? (fact.datasets as any[]) : undefined;
  const lastDataset = datasets && datasets.length > 0 ? datasets[datasets.length - 1] : undefined;
  const dsl = fact.dsl ?? lastDataset?.dsl;
  const dslText = fact.dslText ?? buildDslText(lastDataset?.dsl);
  const objectClasses = fact.objectClasses ?? extractObjectClasses(lastDataset?.dsl);
  const dataCount =
    fact.dataCount ?? (Array.isArray(lastDataset?.data) ? lastDataset.data.length : undefined);
  // 思考摘要是思考状态的派生表达，两者同源；调用方不显式给出时从思考状态取，
  // 避免某个调用方漏抄导致该列恒空。
  const thinkingSummary = fact.thinkingSummary ?? fact.thinkingState?.summary;

  return {
    threadId: identity.threadId,
    requestSeq: identity.requestSeq,
    sourceKind: identity.sourceKind,
    sourceRef: identity.sourceRef,
    sourceStage: identity.sourceStage,
    question: input.question,
    status: input.status || "completed",
    error: input.error,
    backendSessions: fact.backendSessions,
    nodeIds: fact.nodeIds,
    markdownTable: fact.markdownTable,
    datasetPreviews: fact.datasetPreviews,
    cards: fact.cards,
    winner: fact.winner,
    // 分析侧给出查询结果数据包装，标准问数没有单独的包装，直接沿用本次数据集。
    dataPayload: fact.data ?? fact.datasets,
    datasetsPayload: fact.datasets,
    dslPayload: dsl,
    dslText,
    ir: fact.ir,
    fullContent: fact.fullContent,
    thinkingSummary,
    thinkingSteps: fact.thinkingSteps,
    thinkingState: fact.thinkingState,
    objectClasses,
    dataCount,
    abcSubQuestions: fact.abcSubQuestions,
    abcDsls: fact.abcDsls,
    abcCodes: fact.abcCodes,
    abcOutKeyRefs: fact.abcOutKeyRefs,
    replayPlan: fact.replayPlan,
  };
}

function buildDslText(dsl: any): string | undefined {
  const graph = dsl?.answer?.steps?.[0]?.graph;
  return graph?.patterns ? JSON.stringify(graph) : undefined;
}

/** 从 DSL 的查询步骤里取出参与本次查询的对象类。 */
function extractObjectClasses(dsl: any): string[] | undefined {
  if (!dsl?.problem) return undefined;
  const classes = new Set<string>();
  try {
    for (const step of dsl?.answer?.steps || []) {
      for (const pattern of step?.graph?.patterns || []) {
        for (const object of pattern?.objects || []) {
          const className = String(object?.class || "")
            .replace(/^\/+/, "")
            .split("/")[0];
          if (className) classes.add(className);
        }
      }
    }
  } catch {
    /* DSL 形状异常时按无对象类处理，不影响查询事实落库 */
  }
  return Array.from(classes);
}

/**
 * 质检的展示形态：从执行事实构造，供任务规划的历史上下文使用。
 * 质检只有一条通道，读取方都从这里取，不从回复快照取。
 */
export function buildQualityCheckView(
  run?: Pick<QueryRun, "qcState" | "qcResult"> | null
): { state?: unknown; content?: string } | undefined {
  if (!run?.qcState && !run?.qcResult) return undefined;
  return { state: run.qcState, content: (run.qcResult as { conclusion?: string })?.conclusion };
}
