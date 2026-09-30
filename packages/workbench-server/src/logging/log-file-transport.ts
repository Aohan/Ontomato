import { workbenchProduct } from "../product/installed";
import fs from "node:fs";
import path from "node:path";
import { environment } from "../config/environment";
import { runtimeDataDir } from "../content/layout";

export interface LogFileTimeWindow {
  startTime?: string;
  endTime?: string;
}

export interface LogFilePolicy {
  filename: string;
  archivePrefix: string;
  extension: string;
  maxSizeBytes: number;
}

interface LogArchiveFile {
  filePath: string;
  date: string;
  sequence: number;
  mtimeMs: number;
  size: number;
}

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_RETENTION_DAYS = 7;
const LOG_DIR_MAX_BYTES = 2 * 1024 * MB;

function logFilePolicies(): Record<string, LogFilePolicy> {
  const product = workbenchProduct();
  return {
    [product.logFileName]: {
      filename: product.logFileName,
      archivePrefix: product.logFileName.slice(0, -".log".length),
      extension: ".log",
      maxSizeBytes: 20 * MB,
    },
    [product.llmLogFileName]: {
      filename: product.llmLogFileName,
      archivePrefix: product.llmLogFileName.slice(0, -".jsonl".length),
      extension: ".jsonl",
      maxSizeBytes: 50 * MB,
    },
  };
}

export function resolveLogDir(): string {
  const override = environment.logDir()?.trim();
  if (override) return path.resolve(override);
  return runtimeDataDir("logs");
}

/** Ensure the log directory exists (sync, called once per path). */
const ensuredDirs = new Set<string>();

function ensureDir(dir: string): void {
  if (ensuredDirs.has(dir)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    ensuredDirs.add(dir);
  } catch {
    // Ignore - directory may already exist or permission denied.
    // Subsequent writes will fail and be caught individually.
  }
}

/**
 * Append a single JSONL line to the given log file.
 * Creates the parent directory on first call.
 * Rotates known app/LLM log files by policy.
 * Never throws - write failures are silently ignored to protect the main flow.
 */
export function appendJsonl(filename: string, record: Record<string, unknown>): void {
  try {
    const logDir = resolveLogDir();
    ensureDir(logDir);
    const filePath = path.join(logDir, filename);
    const line = JSON.stringify(record) + "\n";
    const policy = getLogFilePolicy(filename);

    if (policy) {
      rotateIfNeeded(logDir, filePath, policy, Buffer.byteLength(line, "utf-8"));
    }

    fs.appendFileSync(filePath, line, "utf-8");
  } catch {
    // Swallow write errors - logging must never crash the application.
  }
}

export function initializeLogFileTransport(): void {
  try {
    const logDir = resolveLogDir();
    ensureDir(logDir);
    cleanupLogArchives(logDir);
  } catch {
    // Best effort only.
  }
}

export function getLogFilePolicy(filename: string): LogFilePolicy | undefined {
  return logFilePolicies()[filename];
}

export function listLogFilesForRead(filename: string, window: LogFileTimeWindow = {}): string[] {
  const logDir = resolveLogDir();
  const currentPath = path.join(logDir, filename);
  const current = safeStat(currentPath) ? [currentPath] : [];
  const policy = getLogFilePolicy(filename);
  if (!policy) return current;

  const windowRange = parseWindowRange(window);
  if (!windowRange) return current;

  const archives = listArchives(logDir, policy)
    .filter((archive) => archiveMatchesWindow(archive, windowRange))
    .sort(compareArchives)
    .map((archive) => archive.filePath);

  return [...archives, ...current];
}

export function cleanupLogArchives(logDir = resolveLogDir(), now = new Date()): void {
  try {
    const policies = Object.values(logFilePolicies());
    const archives = policies.flatMap((policy) => listArchives(logDir, policy));
    const cutoff = startOfUtcDay(now).getTime() - (ARCHIVE_RETENTION_DAYS - 1) * DAY_MS;

    for (const archive of archives) {
      const archiveDay = Date.parse(`${archive.date}T00:00:00.000Z`);
      if (Number.isFinite(archiveDay) && archiveDay < cutoff) {
        safeUnlink(archive.filePath);
      }
    }

    enforceTotalSizeCap(logDir, policies);
  } catch {
    // Log cleanup must never affect the application flow.
  }
}

function rotateIfNeeded(
  logDir: string,
  filePath: string,
  policy: LogFilePolicy,
  nextLineBytes: number
): void {
  const stat = safeStat(filePath);
  if (!stat || stat.size + nextLineBytes <= policy.maxSizeBytes) return;

  const archivePath = nextArchivePath(logDir, policy, new Date());
  try {
    fs.renameSync(filePath, archivePath);
    cleanupLogArchives(logDir);
  } catch {
    // If rotation fails, keep appending to the current file.
  }
}

function nextArchivePath(logDir: string, policy: LogFilePolicy, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const archives = listArchives(logDir, policy).filter((archive) => archive.date === date);
  let sequence = archives.reduce((max, archive) => Math.max(max, archive.sequence), 0) + 1;
  let archivePath = path.join(logDir, archiveFilename(policy, date, sequence));
  while (fs.existsSync(archivePath)) {
    sequence++;
    archivePath = path.join(logDir, archiveFilename(policy, date, sequence));
  }
  return archivePath;
}

function archiveFilename(policy: LogFilePolicy, date: string, sequence: number): string {
  return `${policy.archivePrefix}-${date}-${sequence}${policy.extension}`;
}

function listArchives(logDir: string, policy: LogFilePolicy): LogArchiveFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(logDir);
  } catch {
    return [];
  }

  return entries
    .map((entry) => parseArchiveEntry(logDir, entry, policy))
    .filter((entry): entry is LogArchiveFile => entry !== null);
}

function parseArchiveEntry(
  logDir: string,
  filename: string,
  policy: LogFilePolicy
): LogArchiveFile | null {
  const escapedPrefix = escapeRegExp(policy.archivePrefix);
  const escapedExtension = escapeRegExp(policy.extension);
  const match = filename.match(
    new RegExp(`^${escapedPrefix}-(\\d{4}-\\d{2}-\\d{2})-(\\d+)${escapedExtension}$`)
  );
  if (!match) return null;

  const filePath = path.join(logDir, filename);
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) return null;

  return {
    filePath,
    date: match[1],
    sequence: Number(match[2]),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function parseWindowRange(window: LogFileTimeWindow): { startDay: number; endDay: number } | null {
  const start = parseIsoTime(window.startTime);
  const end = parseIsoTime(window.endTime);
  if (start === null && end === null) return null;

  const startTs = start ?? end!;
  const endTs = end ?? start!;
  if (endTs < startTs) return null;

  return {
    startDay: startOfUtcDay(new Date(startTs)).getTime(),
    endDay: startOfUtcDay(new Date(endTs)).getTime(),
  };
}

function archiveMatchesWindow(
  archive: LogArchiveFile,
  window: { startDay: number; endDay: number }
): boolean {
  const archiveDay = Date.parse(`${archive.date}T00:00:00.000Z`);
  return (
    Number.isFinite(archiveDay) && archiveDay >= window.startDay && archiveDay <= window.endDay
  );
}

function compareArchives(a: LogArchiveFile, b: LogArchiveFile): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.sequence - b.sequence;
}

function enforceTotalSizeCap(logDir: string, policies: LogFilePolicy[]): void {
  const currentFiles = policies.map((policy) => path.join(logDir, policy.filename));
  const currentSize = currentFiles.reduce(
    (sum, filePath) => sum + (safeStat(filePath)?.size ?? 0),
    0
  );
  const archives = policies
    .flatMap((policy) => listArchives(logDir, policy))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || compareArchives(a, b));

  let total = currentSize + archives.reduce((sum, archive) => sum + archive.size, 0);
  for (const archive of archives) {
    if (total <= LOG_DIR_MAX_BYTES) break;
    if (safeUnlink(archive.filePath)) {
      total -= archive.size;
    }
  }
}

function parseIsoTime(value?: string): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeUnlink(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
