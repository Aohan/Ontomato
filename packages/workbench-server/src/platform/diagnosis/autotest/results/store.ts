import type { RunMeta, RunSummary } from "@ontomato/contracts/autotest";
import type { CaseResult } from "../types";
/**
 * Run & CaseResult file-based store.
 *
 * Directory layout:
 *   {dataDir}/runs/{runId}/
 *     run.json          - RunMeta
 *     results.json      - CaseResult[]
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";
import { autotestConfig } from "../config";

import { getCaseVerdict } from "./verdict";

const logger = createLogger("autotest:results");
const activeArtifactWrites = new Map<string, number>();

function runsDir(): string {
  return path.join(autotestConfig.dataDir, "runs");
}

/** Validate id to prevent path traversal attacks. */
function validateId(id: string): void {
  if (!id || /[/\\:*?"<>|]/.test(id) || id.includes("..")) {
    throw new Error(`Invalid id: ${id}`);
  }
}

function runDir(runId: string): string {
  validateId(runId);
  return path.join(runsDir(), runId);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Atomic write: write to a temp file then rename.
 * Prevents partial writes from corrupting results on crash.
 * Mirrors ResultsWriter._atomic_write from the legacy platform.
 */
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/* ------------------------------------------------------------------ */
/*  RunMeta                                                            */
/* ------------------------------------------------------------------ */

export function saveRunMeta(meta: RunMeta): void {
  const dir = runDir(meta.runId);
  ensureDir(dir);
  atomicWriteJson(path.join(dir, "run.json"), meta);
  logger.debug("Run meta saved", { runId: meta.runId, status: meta.status });
}

export function loadRunMeta(runId: string): RunMeta | null {
  const fp = path.join(runDir(runId), "run.json");
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as RunMeta;
  } catch {
    return null;
  }
}

export function settleStaleRunMeta(meta: RunMeta): RunMeta {
  if (meta.status !== "running" && meta.status !== "stopping") return meta;

  const results = loadCaseResults(meta.runId);
  const total = meta.summary.total || results.length;
  const summary = computeSummary(results, total);
  let finalStatus: RunMeta["status"] = "completed";
  if (
    meta.status === "stopping" ||
    results.length < total ||
    results.some((r) => r.status === "cancelled")
  ) {
    finalStatus = "cancelled";
  } else if (summary.abnormal > 0 && summary.correct === 0) {
    finalStatus = "failed";
  }
  const now = new Date().toISOString();
  const settled: RunMeta = {
    ...meta,
    status: finalStatus,
    summary,
    updatedAt: now,
    completedAt: meta.completedAt ?? now,
  };

  saveRunMeta(settled);
  logger.warn("Stale run meta settled", {
    runId: meta.runId,
    previousStatus: meta.status,
    finalStatus,
    resultCount: results.length,
    total,
  });
  return settled;
}

export function listRuns(options: { activeRunId?: string; domainId?: string } = {}): RunMeta[] {
  ensureDir(runsDir());
  const entries = fs.readdirSync(runsDir(), { withFileTypes: true });
  const results: RunMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = loadRunMeta(entry.name);
    if (!meta) continue;
    if (options.domainId && meta.domainId !== options.domainId) continue;
    results.push(meta.runId === options.activeRunId ? meta : settleStaleRunMeta(meta));
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function withRunArtifactWrite<T>(runId: string, write: () => Promise<T>): Promise<T> {
  activeArtifactWrites.set(runId, (activeArtifactWrites.get(runId) ?? 0) + 1);
  try {
    return await write();
  } finally {
    const remaining = (activeArtifactWrites.get(runId) ?? 1) - 1;
    if (remaining > 0) activeArtifactWrites.set(runId, remaining);
    else activeArtifactWrites.delete(runId);
  }
}

export function hasActiveRunArtifactWrites(runId: string): boolean {
  return activeArtifactWrites.has(runId);
}

export function deleteRun(runId: string): boolean {
  const dir = runDir(runId);
  if (!fs.existsSync(dir)) return false;
  if (hasActiveRunArtifactWrites(runId)) return false;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    logger.info("Run deleted", { runId });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete run", { runId, error: msg });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  CaseResults                                                        */
/* ------------------------------------------------------------------ */

export function saveCaseResults(runId: string, results: CaseResult[]): void {
  const dir = runDir(runId);
  ensureDir(dir);
  atomicWriteJson(path.join(dir, "results.json"), results);
  logger.debug("Case results saved", { runId, count: results.length });
}

export function loadCaseResults(runId: string): CaseResult[] {
  const fp = path.join(runDir(runId), "results.json");
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as CaseResult[];
  } catch {
    return [];
  }
}

/**
 * Append or update a single case result.
 *
 * Uses caseId as the unique key within a run.
 */
export function upsertCaseResult(runId: string, result: CaseResult): void {
  const results = loadCaseResults(runId);
  const idx = results.findIndex((r) => r.caseId === result.caseId);
  if (idx >= 0) {
    results[idx] = result;
  } else {
    results.push(result);
  }
  saveCaseResults(runId, results);
}

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

export function createEmptyRunSummary(total = 0): RunSummary {
  return {
    total,
    correct: 0,
    wrong: 0,
    abnormal: 0,
  };
}

export function computeSummary(results: CaseResult[], total = results.length): RunSummary {
  const summary = createEmptyRunSummary(total);

  for (const r of results) {
    switch (getCaseVerdict(r)) {
      case "correct":
        summary.correct++;
        break;
      case "wrong":
        summary.wrong++;
        break;
      case "abnormal":
        summary.abnormal++;
        break;
    }
  }

  return summary;
}
