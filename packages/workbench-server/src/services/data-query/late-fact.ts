import { tApp } from "../../i18n";
import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { QcState } from "@ontomato/contracts/query-thinking";
/**
 * Late fact: a fact that becomes ready only after the execution facts have been finalized; the quality check is currently the only one.
 *
 * The execution that produces it neither pushes it itself nor starts an unowned background read; it hands the pending item back to the caller.
 * The caller registers it with the current run, so the run owns its cancellation and settlement. Whether the run waits for settlement
 * before finalizing depends on whether the run's presentation includes it — the standard query turn display has a quality-check panel so it waits,
 * while deep analysis workflows, reports, and run presentation never consume the quality check so they do not wait; it is only written back for later review.
 */

import { createLogger } from "../../logging/logger";

import { buildQcMarkdown } from "./qc-state";
import { streamSelfCheckSSE } from "./quality-check";
import type { QueryRunIdentity } from "./query-fact";
import { updateQueryRunQualityCheck } from "./query-run-store";

const logger = createLogger("data-query:late-fact");

/** Bounded time limit of a late fact: it decides only "when to consider it dead", never "how long to wait before the result counts". */
export const LATE_FACT_SETTLE_TIMEOUT_MS = 60_000;

/**
 * A late fact registered by one run. A run that presents the fact calls settleAll before finalizing;
 * one that does not merely registers it, and the run's cancellation signal takes care of the cleanup.
 */
export class PendingLateFacts {
  private readonly pending = new Set<Promise<void>>();

  register(settled: Promise<void>): void {
    const tracked = settled.catch(() => undefined).then(() => undefined);
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  /**
   * Waits for all registered items to settle. Each late fact owns its own time limit (on timeout it finalizes itself as not ready),
   * and no second wait ceiling is added here.
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
  /** Passed in by the run that presents this fact, used to push progress states; runs that do not present it omit it */
  onState?: (state: QcState, markdown: string) => void;
}

/**
 * Reads the quality check of one query question and writes it back into its execution facts. Both callers share this single implementation:
 * the read path, the write-back channel, and the cancellation semantics live here; callers only decide whether to push and whether to wait.
 */
export function startQualityCheckSettlement(input: QualityCheckSettlementInput): Promise<void> {
  const { identity, sessionId, onState, signal } = input;
  let state: QcState = { status: "running", steps: [] };
  const publish = () => onState?.(state, buildQcMarkdown(state));

  // The bounded time limit is owned by this fact itself: the backend quality-check read has no server-side timeout, so past the limit it is
  // considered dead — abort the read, finalize as not ready, and skip the write-back. This is a resource boundary, not "how long to wait for a valid result".
  const bound = new AbortController();
  const abortOnCaller = () => bound.abort();
  // Cancellation on entry and cancellation received while running reuse the same finalization; attaching only a listener is not enough.
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
          // Cancellation and timeout are not failures: when we abort the read ourselves the state is left unchanged for the finalization branch below.
          if (bound.signal.aborted) return;
          state = { ...state, status: "failed" };
          publish();
        },
      });

      // Past the time limit: finalize as not ready and push, but skip the write-back — there is no result to write.
      if (timedOut) {
        state = { ...state, status: "unsettled" };
        publish();
        return;
      }
      // Cancellation is not a failure, and no write-back — this run no longer cares about this evidence.
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
