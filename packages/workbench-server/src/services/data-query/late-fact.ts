import { tApp } from "../../i18n";
import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { QcState } from "@ontomato/contracts/query-thinking";
/**
 * 迟到事实：在执行事实收口之后才就绪的事实，质检是目前唯一的一种。
 *
 * 产生它的执行不自行推送、也不自行起无主的后台读取，而是把待结算项交回调用方；
 * 调用方登记给本次运行，运行因此拥有它的取消与结算。运行是否等它结算再收口，
 * 取决于本次运行的呈现是否包含它——标准问数的回合展示有质检面板所以等，
 * 深度分析的工作流、报告与运行呈现都不消费质检所以不等，只补写供事后回看。
 */

import { createLogger } from "../../logging/logger";

import { buildQcMarkdown } from "./qc-state";
import { streamSelfCheckSSE } from "./quality-check";
import type { QueryRunIdentity } from "./query-fact";
import { updateQueryRunQualityCheck } from "./query-run-store";

const logger = createLogger("data-query:late-fact");

/** 迟到事实的有界时限：只决定"多久算它挂了"，不是"等多久算数"。 */
export const LATE_FACT_SETTLE_TIMEOUT_MS = 60_000;

/**
 * 一次运行登记的迟到事实。呈现该事实的运行在收口前调用 settleAll；
 * 不呈现的只登记，由运行的取消信号负责收尾。
 */
export class PendingLateFacts {
  private readonly pending = new Set<Promise<void>>();

  register(settled: Promise<void>): void {
    const tracked = settled.catch(() => undefined).then(() => undefined);
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  /**
   * 等待全部登记项结算。时限由每个迟到事实自己拥有（超时即自行收口为未就绪），
   * 这里不再叠加第二层等待上限。
   */
  async settleAll(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.all([...this.pending]);
  }
}

export interface QualityCheckSettlementInput {
  identity: QueryRunIdentity;
  sessionId: string;
  abcQuestionMode: AbcQuestionMode;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  /** 呈现该事实的运行传入，用于推送过程状态；不呈现的不传 */
  onState?: (state: QcState, markdown: string) => void;
}

/**
 * 读取一次问数问题的质检并补写进它的执行事实。两个调用方共用这一份实现：
 * 读取路径、补写通道与取消语义都在这里，调用方只决定是否推送、是否等待。
 */
export function startQualityCheckSettlement(input: QualityCheckSettlementInput): Promise<void> {
  const { identity, sessionId, onState, signal } = input;
  let state: QcState = { status: "running", steps: [] };
  const publish = () => onState?.(state, buildQcMarkdown(state));

  // 有界时限由本事实自己拥有：查询后端的质检读取没有服务端超时，超过时限即判定它
  // 挂了——中止读取、收口为未就绪、不补写。这不是"等多久算数"，是资源边界。
  const bound = new AbortController();
  const abortOnCaller = () => bound.abort();
  // 进入时已经取消与运行中收到取消复用同一个收口，不能只挂监听器。
  if (signal?.aborted) bound.abort();
  else signal?.addEventListener("abort", abortOnCaller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, LATE_FACT_SETTLE_TIMEOUT_MS);

  publish();

  return (async () => {
    try {
      const result = await streamSelfCheckSSE({
        sessionId,
        abcQuestionMode: input.abcQuestionMode,
        token: input.token,
        apiKey: input.apiKey,
        userId: input.userId,
        locale: input.locale,
        signal: bound.signal,
        onStep: (step) => {
          state = {
            ...state,
            steps: [
              ...state.steps,
              {
                summary: step.summary,
                meaning: step.meaning,
                status: "done",
                timestamp: Date.now(),
              },
            ],
          };
          publish();
        },
        onFinish: (finished) => {
          state = {
            ...state,
            status: "completed",
            result: {
              conclusion: finished.conclusion,
              score: finished.score,
              fittedQuestion: finished.fittedQuestion,
            },
          };
          publish();
        },
        onError: () => {
          // 取消与超时不是失败：读取被我们自己中止时不改状态，交由下面的收口分支处理。
          if (bound.signal.aborted) return;
          state = { ...state, status: "failed" };
          publish();
        },
      });

      // 超过时限：收口为未就绪并推送，但不补写——没有结果可写。
      if (timedOut) {
        state = { ...state, status: "unsettled" };
        publish();
        return;
      }
      // 取消不是失败，也不补写——本次运行已经不再关心这份证据。
      if (signal?.aborted) return;
      if (!result) {
        state = { ...state, status: "failed" };
        publish();
      }

      const updated = await updateQueryRunQualityCheck({
        ...identity,
        qcResult: result ?? undefined,
        qcState: state,
      });
      if (updated === 0) {
        logger.warn(tApp("queryFixed.259"), {
          sourceKind: identity.sourceKind,
          sourceRef: identity.sourceRef,
        });
      }
    } catch (error) {
      if (signal?.aborted || timedOut) return;
      logger.warn(tApp("queryFixed.260"), {
        sourceKind: identity.sourceKind,
        sourceRef: identity.sourceRef,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortOnCaller);
    }
  })();
}
