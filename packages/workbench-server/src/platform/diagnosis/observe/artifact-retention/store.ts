import type { ArtifactType } from "@ontomato/contracts/observe";
import { promises as fs } from "node:fs";
import path from "node:path";
import { environment } from "../../../../config/environment";
import { runtimeDataDir } from "../../../../content/layout";
import { createLogger } from "../../../../logging/logger";
import { isArtifactType, type KeptArtifact } from "./types";

interface RetentionControlFile {
  version: 1;
  kept: KeptArtifact[];
}

const logger = createLogger("artifact-retention:store");
let fileQueue: Promise<void> = Promise.resolve();

function retentionFilePath(): string {
  const configured = environment.retention()?.trim();
  if (configured) return path.resolve(configured);
  return runtimeDataDir("diagnosis-retention.json");
}

export function getArtifactRetentionSnapshot(): Promise<readonly KeptArtifact[]> {
  return enqueueFileOperation(async () => {
    const state = await loadRetentionState();
    return state.kept;
  });
}

export function setArtifactKept(
  artifactType: ArtifactType,
  artifactId: string,
  kept: boolean
): Promise<void> {
  validateArtifactId(artifactId);

  return enqueueFileOperation(async () => {
    const state = await loadRetentionState();
    const index = state.kept.findIndex(
      (item) => item.artifactType === artifactType && item.artifactId === artifactId
    );
    if ((kept && index >= 0) || (!kept && index < 0)) return;

    if (kept) state.kept.push({ artifactType, artifactId });
    else state.kept.splice(index, 1);
    await persistRetentionState(state);
  });
}

export async function clearArtifactRetentionBestEffort(
  artifactType: ArtifactType,
  artifactId: string
): Promise<void> {
  try {
    await setArtifactKept(artifactType, artifactId, false);
  } catch (error) {
    logger.warn("Failed to clear retention after explicit artifact deletion", {
      artifactType,
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function enqueueFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = fileQueue.then(operation);
  fileQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function loadRetentionState(): Promise<RetentionControlFile> {
  const filePath = retentionFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRetentionControlFile(parsed)) {
      throw new Error(`Invalid artifact retention file: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      const state: RetentionControlFile = { version: 1, kept: [] };
      await persistRetentionState(state);
      return state;
    }
    throw error;
  }
}

async function persistRetentionState(state: RetentionControlFile): Promise<void> {
  const filePath = retentionFilePath();
  const tempPath = `${filePath}.tmp`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isRetentionControlFile(value: unknown): value is RetentionControlFile {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.kept)) return false;

  return record.kept.every((item) => {
    if (!item || typeof item !== "object") return false;
    const kept = item as Record<string, unknown>;
    return (
      typeof kept.artifactType === "string" &&
      isArtifactType(kept.artifactType) &&
      typeof kept.artifactId === "string" &&
      kept.artifactId.length > 0 &&
      !kept.artifactId.includes("\u0000")
    );
  });
}

function validateArtifactId(artifactId: string): void {
  if (!artifactId || artifactId.includes("\u0000")) {
    throw new Error("Invalid artifact ID");
  }
}
