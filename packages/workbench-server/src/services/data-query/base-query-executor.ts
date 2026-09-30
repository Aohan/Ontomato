import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { BranchKey } from "@ontomato/contracts/query-thinking";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import type { QueryThinkingState, ThinkingStep } from "@ontomato/contracts/query-thinking";
import { getApiConfig } from "../../config/data-query-api";
import { getAbcQuestionMode, getQueryTimeoutMs } from "./data-query-policy";

import { tForLocale, tApp } from "../../i18n";
import { AuthFailedError } from "../../utils/backend-client";
import { createLogger } from "../../logging/logger";
import { runAbcBranch } from "./branches/abc-branch";
import { runHotBranch } from "./branches/hot-branch";
import { runStaticBranch } from "./branches/static-branch";
import type { AbcBranchContext, BaseQueryOutput, BranchContext } from "./branches/types";
import { ThinkingBuffer } from "./thinking/thinking-buffer";
import { buildThinkingSteps, buildThinkingSummary } from "./thinking/thinking-state";

const logger = createLogger("base-query-executor");

export const STANDARD_QUERY_BRANCHES = [
  "static",
  "hot",
  "abc",
] as const satisfies readonly BranchKey[];

export const DEEP_ANALYSIS_QUERY_BRANCHES = ["abc"] as const satisfies readonly BranchKey[];

interface BaseQueryThinkingResult {
  thinkingState: QueryThinkingState;
  thinkingSummary: string;
  thinkingSteps?: ThinkingStep[];
}

export type BaseQueryExecutionResult = BaseQueryThinkingResult &
  (
    | {
        winner: BranchKey;
        output: BaseQueryOutput;
        abcFallback?: never;
        error?: never;
      }
    | {
        winner?: never;
        output?: never;
        abcFallback?: BaseQueryOutput;
        error: Error;
      }
  );

export interface BaseQueryExecutionOptions {
  queryQuestion: string;
  token: string;
  apiKey: string;
  userId: string;
  locale?: string;
  enabledBranches: readonly BranchKey[];
  signal?: AbortSignal;
  abcQuestionMode?: AbcQuestionMode;
  classNames?: string[];
  onEvent?: (event: unknown) => void;
  onThinkingState?: (thinkingState: QueryThinkingState) => void;
  onBackendLocation?: (session: QueryBackendSession) => void;
}

const BRANCH_FAILURE_ORDER = ["abc", "hot", "static"] as const satisfies readonly BranchKey[];

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatBranchFailures(
  failures: Partial<Record<BranchKey, string>>,
  locale: string | undefined
): string {
  const parts: string[] = [];
  for (const branch of BRANCH_FAILURE_ORDER) {
    const reason = failures[branch];
    if (!reason) continue;
    parts.push(tApp("queryFixed.88", { v0: (tForLocale(locale, `query.branch.${branch}`)), v1: (reason) }));
  }
  return parts.join(tApp("queryFixed.183"));
}

export async function executeBaseQuery(
  options: BaseQueryExecutionOptions
): Promise<BaseQueryExecutionResult> {
  const enabledBranches = [...new Set(options.enabledBranches)];
  if (enabledBranches.length === 0) {
    throw new Error(tApp("queryFixed.197"));
  }

  const apiConfig = getApiConfig();
  const abcQuestionMode = options.abcQuestionMode ?? getAbcQuestionMode();
  const queryTimeoutMs = getQueryTimeoutMs();
  const metricViewGeneralUrl = apiConfig.endpoints.metricViewGeneral;
  const metricViewStaticUrl = apiConfig.endpoints.metricViewStatic;
  const findKnowledgeUrl = apiConfig.endpoints.findKnowledge;

  const controllers = new Map<BranchKey, AbortController>(
    enabledBranches.map((branch) => [branch, new AbortController()])
  );

  let abcFallback: BaseQueryOutput | undefined;
  let lastThinkingSummary = "";
  let lastThinkingStateJson = "";
  let settled = false;

  const buildThinkingState = (): QueryThinkingState => {
    const state = thinking.snapshot();
    state.summary = buildThinkingSummary(state);
    return state;
  };

  const notifyThinking = () => {
    const thinkingState = buildThinkingState();
    const stateJson = JSON.stringify(thinkingState);
    if (thinkingState.summary === lastThinkingSummary && stateJson === lastThinkingStateJson)
      return;
    lastThinkingSummary = thinkingState.summary;
    lastThinkingStateJson = stateJson;
    options.onThinkingState?.(thinkingState);
  };

  const thinking = new ThinkingBuffer(enabledBranches, notifyThinking);

  const isBranchActive = (branch: BranchKey) => {
    const controller = controllers.get(branch);
    return !settled && !!controller && !controller.signal.aborted;
  };

  const createContext = <K extends BranchKey>(branch: K): BranchContext<K> => {
    const controller = controllers.get(branch);
    if (!controller) throw new Error(tApp("queryFixed.196", { v0: (branch) }));

    return {
      queryQuestion: options.queryQuestion,
      token: options.token,
      apiKey: options.apiKey,
      userId: options.userId,
      locale: options.locale,
      abcQuestionMode,
      classNames: options.classNames,
      pushEvent: (event) => {
        if (isBranchActive(branch)) options.onEvent?.(event);
      },
      thinking: thinking.createBranchView(branch),
      signal: controller.signal,
      reportBackendLocation: (location) => {
        // Reports from a cancelled branch are no longer accepted; a location without a session number does not constitute a session (design 1, 6).
        if (!isBranchActive(branch) || !location.sessionId) return;
        options.onBackendLocation?.({
          branch,
          sessionId: location.sessionId,
          nodeId: location.backendNodeId,
        });
      },
    };
  };

  const createAbcContext = (): AbcBranchContext => ({
    ...createContext("abc"),
    reportFallback: (output) => {
      if (isBranchActive("abc")) abcFallback = output;
    },
    setAbcThinking: (nextState) => thinking.setAbcState(nextState),
  });

  const runBranch = (branch: BranchKey): Promise<BaseQueryOutput | undefined> => {
    switch (branch) {
      case "static":
        return runStaticBranch(metricViewStaticUrl, findKnowledgeUrl, createContext("static"));
      case "hot":
        return runHotBranch(metricViewGeneralUrl, findKnowledgeUrl, createContext("hot"));
      case "abc":
        return runAbcBranch(createAbcContext());
    }
  };

  return new Promise<BaseQueryExecutionResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let doneCount = 0;
    let hasAuthFailure = false;
    const branchFailures: Partial<Record<BranchKey, string>> = {};

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    };

    const abortBranches = (except?: BranchKey) => {
      for (const [branch, controller] of controllers) {
        if (branch !== except && !controller.signal.aborted) controller.abort();
      }
    };

    const finish = (
      outcome:
        | { winner: BranchKey; output: BaseQueryOutput }
        | { error: Error; abcFallback?: BaseQueryOutput }
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      const winner = "winner" in outcome ? outcome.winner : undefined;
      thinking.finish(winner);
      abortBranches(winner);
      const thinkingState = buildThinkingState();
      const thinkingSummary = thinkingState.summary;
      const thinkingResult: BaseQueryThinkingResult = {
        thinkingState,
        thinkingSummary,
        thinkingSteps: buildThinkingSteps(thinkingSummary),
      };
      if ("winner" in outcome) {
        resolve({ ...thinkingResult, winner: outcome.winner, output: outcome.output });
      } else {
        resolve({ ...thinkingResult, error: outcome.error, abcFallback: outcome.abcFallback });
      }
    };

    const stop = (message: string) => {
      finish({ error: new Error(message), abcFallback });
    };

    function onExternalAbort() {
      stop(tForLocale(options.locale, "query.status.queryCancelled"));
    }

    const completeWithoutWinner = () => {
      const error = hasAuthFailure
        ? new AuthFailedError(tApp("queryFixed.198"))
        : Object.keys(branchFailures).length > 0
          ? new Error(formatBranchFailures(branchFailures, options.locale))
          : new Error(tForLocale(options.locale, "query.node.noValidResult"));
      finish({ error, abcFallback });
    };

    const onDone = (branch: BranchKey, output: BaseQueryOutput | undefined) => {
      if (settled) return;
      if (output) {
        logger.debug(tApp("queryFixed.199"), {
          winner: branch,
          enabledBranches,
          datasetCount: output.datasets.length,
        });
        finish({ winner: branch, output });
        return;
      }

      doneCount++;
      if (doneCount >= enabledBranches.length) completeWithoutWinner();
    };

    const onError = (branch: BranchKey, error: unknown) => {
      if (settled) return;
      const normalized = normalizeError(error);
      if (normalized instanceof AuthFailedError) {
        hasAuthFailure = true;
      } else {
        const reason = normalized.message.trim()
          ? normalized.message
          : tForLocale(options.locale, "query.error.unknownError");
        branchFailures[branch] = reason;
        thinking.createBranchView(branch).set("failed", reason);
      }
      doneCount++;
      logger.warn(tApp("queryFixed.200"), {
        branch,
        errorName: normalized.name,
        error: normalized.message,
        doneCount,
        totalBranches: enabledBranches.length,
      });
      if (doneCount >= enabledBranches.length) completeWithoutWinner();
    };

    if (options.signal?.aborted) {
      onExternalAbort();
      return;
    }

    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    timer = setTimeout(
      () => stop(tForLocale(options.locale, "api.backendExecutionTimeout")),
      queryTimeoutMs
    );

    logger.debug(tApp("queryFixed.201"), {
      enabledBranches,
      timeoutMs: queryTimeoutMs,
      abcQuestionMode,
    });

    for (const branch of enabledBranches) {
      runBranch(branch).then(
        (output) => onDone(branch, output),
        (error) => onError(branch, error)
      );
    }
  });
}
