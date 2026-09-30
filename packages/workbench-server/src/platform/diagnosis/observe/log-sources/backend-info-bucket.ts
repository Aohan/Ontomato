import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { environment } from "../../../../config/environment";
import { runtimeDataDir } from "../../../../content/layout";
import { parseJavaLogEpochMillis, parseJavaLogLine } from "../parsers/backend-log-line";

const BACKEND_INFO_BUCKET_MS = 10 * 60_000;
const BACKEND_INFO_BUCKET_SEAL_DELAY_MS = 5_000;
const MAX_TIME_BUCKETS = 24;
const BUCKET_METADATA_SCHEMA_VERSION = 3;

const inFlightTimeBuckets = new Map<string, Promise<BucketFile | null>>();

export interface BackendInfoBucketCollectInput {
  backendNodeId?: string;
  minTs?: number;
  maxTs?: number;
  outputPath: string;
  fetchWindow?: (minTs: number, maxTs: number) => Promise<string[]>;
}

export interface BackendInfoBucketResult {
  lineCount: number;
  records: ParsedLogRecord[];
  bucketIds: string[];
}

type UsableBackendInfoBucketCollectInput = BackendInfoBucketCollectInput & {
  minTs: number;
  maxTs: number;
  fetchWindow: (minTs: number, maxTs: number) => Promise<string[]>;
};

interface TimeBucketWindow {
  startTs: number;
  endTs: number;
}

interface BucketMetadata {
  schemaVersion: typeof BUCKET_METADATA_SCHEMA_VERSION;
  complete: true;
  id: string;
  backendNodeId?: string;
  minTs: number;
  maxTs: number;
  lineCount: number;
  byteLength: number;
  createdAt: string;
}

interface BucketFile {
  path: string;
}

type LineSource = Iterable<string> | (() => AsyncIterable<string>);

export async function collectBackendInfoBucket(
  input: BackendInfoBucketCollectInput
): Promise<BackendInfoBucketResult> {
  const fetchWindow = input.fetchWindow;
  if (!hasUsableWindow(input) || !fetchWindow) {
    removeOutputFile(input.outputPath);
    return emptyResult();
  }

  const usableInput: UsableBackendInfoBucketCollectInput = { ...input, fetchWindow };
  const windows = buildTimeBucketWindows(usableInput.minTs, usableInput.maxTs);
  if (windows.length === 0) {
    removeOutputFile(input.outputPath);
    return emptyResult();
  }

  if (windows.length > MAX_TIME_BUCKETS) {
    const lines = await usableInput.fetchWindow(usableInput.minTs, usableInput.maxTs);
    return writeLineSourcesToOutput(
      [lines],
      input.outputPath,
      usableInput.minTs,
      usableInput.maxTs,
      []
    );
  }

  const collectionStartedAt = Date.now();
  const bucketIds: string[] = [];
  const sources: LineSource[] = [];

  for (const window of windows) {
    if (window.endTs + BACKEND_INFO_BUCKET_SEAL_DELAY_MS <= collectionStartedAt) {
      const bucketId = buildTimeBucketId(usableInput, window);
      const bucketFile = await readOrFetchSealedTimeBucket(bucketId, usableInput, window);
      if (bucketFile) {
        bucketIds.push(bucketId);
        sources.push(() => readLines(bucketFile.path));
      }
      continue;
    }

    const minTs = Math.max(usableInput.minTs, window.startTs);
    const maxTs = Math.min(usableInput.maxTs, window.endTs - 1);
    sources.push(await usableInput.fetchWindow(minTs, maxTs));
  }

  return writeLineSourcesToOutput(
    sources,
    input.outputPath,
    usableInput.minTs,
    usableInput.maxTs,
    bucketIds
  );
}

export function backendInfoBucketRoot(): string {
  return path.resolve(
    environment.observeBucket() || runtimeDataDir("observe", "backend-info-buckets")
  );
}

async function readOrFetchSealedTimeBucket(
  bucketId: string,
  input: UsableBackendInfoBucketCollectInput,
  window: TimeBucketWindow
): Promise<BucketFile | null> {
  const cached = readBucketFileIfExists(bucketId, window);
  if (cached !== null) return cached;

  const inFlight = inFlightTimeBuckets.get(bucketId);
  if (inFlight) return inFlight;

  const fetchPromise = (async () => {
    const minTs = window.startTs;
    const maxTs = Math.max(window.startTs, window.endTs - 1);
    const lines = await input.fetchWindow(minTs, maxTs);
    return writeBucket(bucketId, lines, {
      schemaVersion: BUCKET_METADATA_SCHEMA_VERSION,
      complete: true,
      id: bucketId,
      backendNodeId: input.backendNodeId,
      minTs,
      maxTs,
      lineCount: lines.length,
      byteLength: byteLengthForLines(lines),
      createdAt: new Date().toISOString(),
    });
  })();

  inFlightTimeBuckets.set(bucketId, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightTimeBuckets.delete(bucketId);
  }
}

function hasUsableWindow(input: { minTs?: number; maxTs?: number }): input is {
  minTs: number;
  maxTs: number;
} {
  return (
    input.minTs !== undefined &&
    input.maxTs !== undefined &&
    Number.isFinite(input.minTs) &&
    Number.isFinite(input.maxTs) &&
    input.maxTs >= input.minTs
  );
}

function buildTimeBucketWindows(minTs: number, maxTs: number): TimeBucketWindow[] {
  const windows: TimeBucketWindow[] = [];
  let startTs = Math.floor(minTs / BACKEND_INFO_BUCKET_MS) * BACKEND_INFO_BUCKET_MS;
  while (startTs <= maxTs) {
    windows.push({
      startTs,
      endTs: startTs + BACKEND_INFO_BUCKET_MS,
    });
    startTs += BACKEND_INFO_BUCKET_MS;
  }
  return windows;
}

function buildTimeBucketId(input: BackendInfoBucketCollectInput, window: TimeBucketWindow): string {
  return [
    "time",
    "node-api",
    safeSegment(input.backendNodeId || "default"),
    `${window.startTs}-${window.endTs}`,
  ].join("/");
}

async function writeLineSourcesToOutput(
  sources: LineSource[],
  outputPath: string,
  minTs: number,
  maxTs: number,
  bucketIds: string[]
): Promise<BackendInfoBucketResult> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = buildTempPath(outputPath);
  const writer = fs.createWriteStream(tempPath, { encoding: "utf-8" });
  const records: ParsedLogRecord[] = [];
  let lineCount = 0;
  let includeContinuation = false;

  try {
    for (const source of sources) {
      const lines = typeof source === "function" ? source() : source;
      for await (const line of lines) {
        const timestamp = parseJavaLogEpochMillis(line);
        const include: boolean =
          timestamp === null ? includeContinuation : timestamp >= minTs && timestamp <= maxTs;

        if (timestamp !== null) {
          includeContinuation = include;
        }

        if (include) {
          await writeOutputLine(writer, line);
          if (timestamp === null) {
            records[records.length - 1].message += `\n${line}`;
          } else {
            records.push(parseJavaLogLine(line));
          }
          lineCount += 1;
        }
      }
    }

    writer.end();
    await finished(writer);

    if (lineCount === 0) {
      fs.rmSync(tempPath, { force: true });
      removeOutputFile(outputPath);
    } else {
      fs.renameSync(tempPath, outputPath);
    }

    return { lineCount, records, bucketIds };
  } catch (error) {
    writer.destroy();
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function emptyResult(): BackendInfoBucketResult {
  return { lineCount: 0, records: [], bucketIds: [] };
}

function readLines(filePath: string): AsyncIterable<string> {
  return readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
}

async function writeOutputLine(writer: fs.WriteStream, line: string): Promise<void> {
  if (!writer.write(`${line}\n`)) {
    await once(writer, "drain");
  }
}

function writeBucket(
  bucketId: string,
  lines: string[],
  metadata: BucketMetadata
): BucketFile | null {
  const dir = bucketDir(bucketId);
  if (!dir) return null;
  if (lines.length === 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }

  fs.mkdirSync(dir, { recursive: true });
  const bucketPath = path.join(dir, "bucket.log");
  const metadataPath = path.join(dir, "metadata.json");
  const tempBucketPath = buildTempPath(bucketPath);
  const tempMetadataPath = buildTempPath(metadataPath);

  try {
    writeLinesFileSync(tempBucketPath, lines);
    fs.writeFileSync(tempMetadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    fs.renameSync(tempBucketPath, bucketPath);
    fs.renameSync(tempMetadataPath, metadataPath);
    return { path: bucketPath };
  } catch (error) {
    fs.rmSync(tempBucketPath, { force: true });
    fs.rmSync(tempMetadataPath, { force: true });
    throw error;
  }
}

function readBucketFileIfExists(bucketId: string, window: TimeBucketWindow): BucketFile | null {
  const dir = bucketDir(bucketId);
  if (!dir) return null;
  const filePath = path.join(dir, "bucket.log");
  const metadataPath = path.join(dir, "metadata.json");
  try {
    if (!fs.existsSync(filePath) || !fs.existsSync(metadataPath)) return null;
    const byteLength = fs.statSync(filePath).size;
    if (byteLength === 0) return null;

    const metadata: unknown = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    if (!isCompleteBucketMetadata(metadata, bucketId, window, byteLength)) return null;
    return { path: filePath };
  } catch {
    return null;
  }
}

function isCompleteBucketMetadata(
  value: unknown,
  bucketId: string,
  window: TimeBucketWindow,
  byteLength: number
): value is BucketMetadata {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === BUCKET_METADATA_SCHEMA_VERSION &&
    value.complete === true &&
    value.id === bucketId &&
    (value.backendNodeId === undefined || typeof value.backendNodeId === "string") &&
    value.minTs === window.startTs &&
    value.maxTs === window.endTs - 1 &&
    typeof value.lineCount === "number" &&
    Number.isInteger(value.lineCount) &&
    value.lineCount > 0 &&
    value.byteLength === byteLength &&
    typeof value.createdAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bucketDir(bucketId: string): string | null {
  const parts = bucketId.split("/");
  if (parts.length === 0 || parts.some((part) => !isSafeSegment(part))) return null;
  const root = backendInfoBucketRoot();
  const resolved = path.resolve(root, ...parts);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._=-]/g, "_").slice(0, 120);
  return safe || "unknown";
}

function isSafeSegment(value: string): boolean {
  return /^[a-zA-Z0-9._=-]+$/.test(value) && value !== "." && value !== "..";
}

function writeLinesFileSync(filePath: string, lines: string[]): void {
  const fd = fs.openSync(filePath, "w");
  try {
    for (const line of lines) {
      fs.writeSync(fd, line);
      fs.writeSync(fd, "\n");
    }
  } finally {
    fs.closeSync(fd);
  }
}

function byteLengthForLines(lines: string[]): number {
  let byteLength = 0;
  for (const line of lines) {
    byteLength += Buffer.byteLength(line, "utf-8") + 1;
  }
  return byteLength;
}

function removeOutputFile(outputPath: string): void {
  fs.rmSync(outputPath, { force: true });
}

function buildTempPath(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
