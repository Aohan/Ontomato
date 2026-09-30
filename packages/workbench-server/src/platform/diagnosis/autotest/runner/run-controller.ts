import type { RunMeta, TestCase, RunStatus, RunEvent } from "@ontomato/contracts/autotest";
import type { CaseResult, RunConfig } from "../types";
/**
 * Run lifecycle controller.
 *
 * Responsibilities:
 *  - Create a run (one at a time).
 *  - Dispatch cases to workers with bounded concurrency.
 *  - Stop a run (mark stopping, abort active cases, cancel queued ones).
 *  - Maintain run status + progress.
 *  - Broadcast SSE events to connected listeners.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../../../../logging/logger";
import { autotestConfig } from "../config";
import { ensureUniqueCaseIds, getCaseSet } from "../cases/repository";
import {
  computeSummary,
  createEmptyRunSummary,
  loadCaseResults,
  saveRunMeta,
  upsertCaseResult,
} from "../results/store";
import { getCaseVerdict, getCaseVerdictReason } from "../results/verdict";

import { executeSingleCase } from "./single-case";

const logger = createLogger("autotest:runner");
const MAX_EVENT_BUFFER = 1000;
const MAX_RUN_ROUNDS = 20;

/* ------------------------------------------------------------------ */
/*  Singleton state                                                    */
/* ------------------------------------------------------------------ */

/** Currently active run, or null if idle. */
let activeRun: ActiveRun | null = null;
let runChain: RunChain | null = null;

interface ActiveRun {
  meta: RunMeta;
  abortControllers: Map<string, AbortController>;
  /** Global abort for the entire run (used for stop). */
  globalAbort: AbortController;
  /** SSE listeners waiting for run events. */
  listeners: Set<(event: RunEvent) => void>;
  /** Recent events replayed to subscribers that reconnect while the run is active. */
  eventBuffer: RunEvent[];
}

interface RunChain {
  baseConfig: RunConfig;
  remainingRounds: number;
  cancelled: boolean;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function getActiveRun(): RunMeta | null {
  return activeRun?.meta ?? null;
}

export function isRunActive(): boolean {
  return activeRun !== null || hasPendingRunChain();
}

/**
 * Subscribe to run events. Returns an unsubscribe function.
 */
export function subscribeRunEvents(
  runId: string,
  listener: (event: RunEvent) => void
): (() => void) | null {
  if (!activeRun || activeRun.meta.runId !== runId) {
    return null;
  }

  for (const event of activeRun.eventBuffer) {
    try {
      listener(event);
    } catch {
      // Ignore replay listener errors
    }
  }

  activeRun.listeners.add(listener);
  return () => {
    activeRun?.listeners.delete(listener);
  };
}

/**
 * Create and start a new run.
 *
 * Throws if another run is already active.
 */
export async function startRun(runConfig: RunConfig): Promise<RunMeta> {
  if (activeRun || hasPendingRunChain()) {
    throw new Error("A run is already active. Stop it first or wait for it to complete.");
  }

  const rounds = normalizeRunRounds(runConfig.rounds);
  const baseConfig: RunConfig = { ...runConfig, rounds: 1 };
  runChain =
    rounds > 1
      ? {
          baseConfig,
          remainingRounds: rounds - 1,
          cancelled: false,
        }
      : null;

  try {
    return startSingleRun(baseConfig);
  } catch (error) {
    runChain = null;
    throw error;
  }
}

/**
 * Stop the currently active run.
 */
export function stopRun(runId: string): RunMeta {
  if (!activeRun || activeRun.meta.runId !== runId) {
    throw new Error(`Run ${runId} is not the active run`);
  }

  if (activeRun.meta.status !== "running") {
    throw new Error(`Run is not in running state (current: ${activeRun.meta.status})`);
  }

  cancelRunChain();
  logger.info("Stopping run", { runId });

  activeRun.meta.status = "stopping";
  activeRun.meta.updatedAt = new Date().toISOString();
  saveRunMeta(activeRun.meta);

  // Abort all active case executions
  activeRun.globalAbort.abort();
  for (const [caseId, ac] of activeRun.abortControllers) {
    logger.debug("Aborting active case", { runId, caseId });
    ac.abort();
  }

  broadcastEvent({
    type: "status_change",
    runId,
    timestamp: Date.now(),
    data: { status: "stopping" },
  });

  return activeRun.meta;
}

/* ------------------------------------------------------------------ */
/*  Run creation                                                       */
/* ------------------------------------------------------------------ */

function startSingleRun(runConfig: RunConfig): RunMeta {
  if (activeRun) {
    throw new Error("A run is already active. Stop it first or wait for it to complete.");
  }

  const caseSet = getCaseSet(runConfig.caseSetId);
  if (!caseSet) {
    throw new Error(`Case set not found: ${runConfig.caseSetId}`);
  }

  if (caseSet.cases.length === 0) {
    throw new Error("Case set has no cases");
  }

  const runId = `run-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const now = new Date().toISOString();

  const meta: RunMeta = {
    domainId: runConfig.domainId,
    runId,
    caseSetId: caseSet.id,
    caseSetName: caseSet.name,
    status: "running",
    summary: createEmptyRunSummary(caseSet.cases.length),
    createdAt: now,
    updatedAt: now,
  };

  saveRunMeta(meta);

  const globalAbort = new AbortController();

  activeRun = {
    meta,
    abortControllers: new Map(),
    globalAbort,
    listeners: new Set(),
    eventBuffer: [],
  };

  logger.info("Run created", {
    runId,
    caseSetId: caseSet.id,
    caseCount: caseSet.cases.length,
    concurrency: runConfig.concurrency ?? autotestConfig.concurrency,
  });

  broadcastEvent({
    type: "status_change",
    runId,
    timestamp: Date.now(),
    data: { status: "running" },
  });

  // Start execution in background (do not await here -- the caller gets the run ID immediately)
  executeRun(runId, ensureUniqueCaseIds(caseSet.cases), runConfig).catch((err) => {
    handleRunExecutionFailure(runId, err);
  });

  return meta;
}

/* ------------------------------------------------------------------ */
/*  Internal execution loop                                            */
/* ------------------------------------------------------------------ */

async function executeRun(runId: string, cases: TestCase[], runConfig: RunConfig): Promise<void> {
  const concurrency = runConfig.concurrency ?? autotestConfig.concurrency;

  // Create a queue of case indices
  let nextIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextIndex < cases.length) {
      // Check if run is stopping
      if (
        !activeRun ||
        activeRun.meta.status === "stopping" ||
        activeRun.globalAbort.signal.aborted
      ) {
        break;
      }

      const index = nextIndex++;
      const testCase = cases[index];

      // Create per-case abort controller linked to global
      const caseAbort = new AbortController();
      activeRun?.abortControllers.set(testCase.caseId, caseAbort);

      // Link to global abort
      const onGlobalAbort = () => caseAbort.abort();
      activeRun?.globalAbort.signal.addEventListener("abort", onGlobalAbort, { once: true });

      broadcastEvent({
        type: "case_start",
        runId,
        timestamp: Date.now(),
        data: { caseId: testCase.caseId, question: testCase.question, index },
      });

      let result: CaseResult;

      if (activeRun?.globalAbort.signal.aborted) {
        // Run was stopped before this case started
        result = {
          runId,
          caseId: testCase.caseId,
          threadId: "",
          status: "cancelled",
          question: testCase.question,
        };
      } else {
        result = await executeSingleCase({
          runId,
          domainId: runConfig.domainId,
          testCase,
          userId: runConfig.userId,
          tk: runConfig.tk,
          signal: caseAbort.signal,
          caseTimeoutMs: runConfig.caseTimeoutMs,
          // Relay stage-level steps to listeners; caseId lets the frontend
          // attribute each line to its case during concurrent runs.
          onStep: (label) => {
            broadcastEvent({
              type: "case_log",
              runId,
              timestamp: Date.now(),
              data: { caseId: testCase.caseId, label },
            });
          },
        });
      }

      // Clean up
      activeRun?.abortControllers.delete(testCase.caseId);
      activeRun?.globalAbort.signal.removeEventListener("abort", onGlobalAbort);

      // Persist result
      upsertCaseResult(runId, result);
      completedCount++;

      broadcastEvent({
        type: "case_end",
        runId,
        timestamp: Date.now(),
        data: {
          caseId: testCase.caseId,
          status: result.status,
          verdict: getCaseVerdict(result),
          verdictReason: getCaseVerdictReason(result),
          durationMs: result.durationMs,
          error: result.error,
        },
      });

      // Update run meta summary (recomputes from persisted results)
      updateRunSummary(runId);

      // Progress carries the fresh summary so the UI can update verdict counts.
      broadcastEvent({
        type: "progress",
        runId,
        timestamp: Date.now(),
        data: {
          completed: completedCount,
          total: cases.length,
          percent: Math.round((completedCount / cases.length) * 100),
          summary: activeRun?.meta.summary,
        },
      });
    }
  }

  // Spawn workers
  const workerCount = Math.min(concurrency, cases.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  // Mark remaining queued cases as cancelled if run was stopped
  if (activeRun && activeRun.meta.status === "stopping") {
    for (let i = nextIndex; i < cases.length; i++) {
      const testCase = cases[i];
      const cancelledResult: CaseResult = {
        runId,
        caseId: testCase.caseId,
        threadId: "",
        status: "cancelled",
        question: testCase.question,
      };
      upsertCaseResult(runId, cancelledResult);
    }
  }

  // Finalize
  finalizeRun(runId);
}

function updateRunSummary(runId: string): void {
  if (!activeRun || activeRun.meta.runId !== runId) return;

  const results = loadCaseResults(runId);
  activeRun.meta.summary = computeSummary(results, activeRun.meta.summary.total);
  activeRun.meta.updatedAt = new Date().toISOString();
  saveRunMeta(activeRun.meta);
}

function finalizeRun(runId: string): void {
  if (!activeRun || activeRun.meta.runId !== runId) return;

  const results = loadCaseResults(runId);
  const summary = computeSummary(results, activeRun.meta.summary.total);

  // Determine final status
  let finalStatus: RunStatus;
  if (activeRun.meta.status === "stopping") {
    finalStatus = "cancelled";
  } else if (
    results.some((r) => r.status === "error" || r.status === "failed") &&
    !results.some((r) => r.status === "success")
  ) {
    finalStatus = "failed";
  } else {
    finalStatus = "completed";
  }

  activeRun.meta.status = finalStatus;
  activeRun.meta.summary = summary;
  activeRun.meta.updatedAt = new Date().toISOString();
  activeRun.meta.completedAt = new Date().toISOString();
  saveRunMeta(activeRun.meta);

  logger.info("Run finalized", {
    runId,
    status: finalStatus,
    summary,
  });

  broadcastEvent({
    type: "status_change",
    runId,
    timestamp: Date.now(),
    data: { status: finalStatus },
  });

  broadcastEvent({
    type: "run_complete",
    runId,
    timestamp: Date.now(),
    data: { summary },
  });

  // Release active run
  activeRun = null;
  startNextChainedRun();
}

function handleRunExecutionFailure(runId: string, error: unknown): void {
  logger.error("Run execution failed unexpectedly", { runId, error: String(error) });
  if (!activeRun || activeRun.meta.runId !== runId) {
    return;
  }

  activeRun.meta.status = "failed";
  activeRun.meta.updatedAt = new Date().toISOString();
  activeRun.meta.completedAt = new Date().toISOString();
  saveRunMeta(activeRun.meta);
  broadcastEvent({
    type: "run_complete",
    runId,
    timestamp: Date.now(),
    data: { summary: activeRun.meta.summary, error: String(error) },
  });
  activeRun = null;
  startNextChainedRun();
}

function startNextChainedRun(): void {
  if (!runChain || runChain.cancelled || runChain.remainingRounds <= 0) {
    runChain = null;
    return;
  }

  const chain = runChain;
  chain.remainingRounds -= 1;
  if (chain.remainingRounds <= 0) {
    runChain = null;
  }

  try {
    startSingleRun(chain.baseConfig);
  } catch (error) {
    runChain = null;
    logger.error("Failed to start chained autotest run", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cancelRunChain(): void {
  if (runChain) {
    runChain.cancelled = true;
    runChain = null;
  }
}

function hasPendingRunChain(): boolean {
  return !!runChain && !runChain.cancelled && runChain.remainingRounds > 0;
}

function normalizeRunRounds(rounds: unknown): number {
  const value = Number(rounds);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_RUN_ROUNDS, Math.max(1, Math.trunc(value)));
}

/* ------------------------------------------------------------------ */
/*  SSE broadcast                                                      */
/* ------------------------------------------------------------------ */

function broadcastEvent(event: RunEvent): void {
  if (!activeRun) return;
  activeRun.eventBuffer.push(event);
  if (activeRun.eventBuffer.length > MAX_EVENT_BUFFER) {
    activeRun.eventBuffer.splice(0, activeRun.eventBuffer.length - MAX_EVENT_BUFFER);
  }
  for (const listener of activeRun.listeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  }
}
