import { createLogger } from "../../logging/logger";
import { getActiveRun } from "./autotest/runner/run-controller";
import { deleteRun, listRuns } from "./autotest/results/store";
import { deleteWorkspace, listWorkspaceEntries } from "./observe/workspaces/store";
import { getArtifactRetentionSnapshot } from "./observe/artifact-retention/store";
import { hasArtifactRetention, type KeptArtifact } from "./observe/artifact-retention/types";

const logger = createLogger("artifact-retention:cleanup");

const ARTIFACT_RETENTION_DAYS = 7;
const ARTIFACT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const TERMINAL_WORKSPACE_STATUSES = new Set(["completed", "failed"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export async function cleanupExpiredArtifacts(now = Date.now()): Promise<number> {
  let kept: readonly KeptArtifact[];
  try {
    kept = await getArtifactRetentionSnapshot();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Artifact cleanup aborted because retention state is unavailable", { error: msg });
    return 0;
  }

  const cutoff = now - ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of listWorkspaceEntries()) {
    if (
      !isExpiredTerminal(
        entry.manifest.status,
        entry.manifest.completedAt,
        TERMINAL_WORKSPACE_STATUSES,
        cutoff
      )
    ) {
      continue;
    }
    if (hasArtifactRetention(kept, "turn-workspace", entry.workspaceId)) continue;

    if (deleteWorkspace(entry.workspaceId)) removed++;
  }

  const activeRunId = getActiveRun()?.runId;
  for (const run of listRuns({ activeRunId })) {
    if (!isExpiredTerminal(run.status, run.completedAt, TERMINAL_RUN_STATUSES, cutoff)) continue;
    if (hasArtifactRetention(kept, "autotest-run", run.runId)) continue;

    if (deleteRun(run.runId)) removed++;
  }

  logger.info("Artifact cleanup completed", { removed });
  return removed;
}

export function startArtifactCleanupScheduler(): void {
  runCleanup();
  setInterval(runCleanup, ARTIFACT_CLEANUP_INTERVAL_MS).unref?.();
}

function runCleanup(): void {
  void cleanupExpiredArtifacts().catch((error) => {
    logger.error("Artifact cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function isExpiredTerminal(
  status: string,
  completedAt: string | undefined,
  terminalStatuses: ReadonlySet<string>,
  cutoff: number
): boolean {
  if (!terminalStatuses.has(status) || !completedAt) return false;
  const terminalTime = Date.parse(completedAt);
  return Number.isFinite(terminalTime) && terminalTime <= cutoff;
}
