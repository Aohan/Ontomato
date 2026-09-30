import { workbenchProduct } from "../../../../product/installed";
import type {
  WorkspaceManifest,
  PostProcessSeverity,
  WorkspacePostProcessSummary,
  ParsedLogRecord,
  WorkspaceBackendSessionEvidence,
} from "@ontomato/contracts/observe";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import type { LogFileTimeWindow } from "../../../../logging/log-file-transport";
import type { UnifiedConversation } from "./prompt-types";
import type { WorkspaceArtifactSummaryMetadata } from "./summary-generator";
import type { PostProcessStatusFile, PostProcessStatusItem } from "../types";
/**
 * Diagnostic artifact post-processing pipeline.
 *
 * Orchestrates the full artifact generation pipeline for both Turn workspaces
 * and autotest cases. Callers provide the artifact directory and neutral
 * summary metadata; this module owns the shared evidence digestion steps.
 * Pipeline steps:
 *
 *  1.  Create artifact directory
 *  2.  Collect logs by turnKey/taskId (app + LLM + backend)
 *  3.  Two-path prompt extraction + merge + write:
 *      - Frontend (data-agent LLM logs) — independent, slotId="front"
 *      - Backend agent-llm structured logs — slotId="s1"
 *      → unified writer outputs all conversations to prompts/
 *  4.  Extract errors -> errors.log
 *  5.  Extract MQLS logic -> mqls_logic.md (diagnostic-events only)
 *  6.  Generate summary.md as a lightweight diagnostic evidence index
 *
 * Each step is wrapped in try-catch: failures only log warnings and
 * never block subsequent steps or the run.
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../../../logging/logger";

import { collectLogs, type BackendLogTimeWindow } from "./log-collector";
import {
  extractBackendAgentLlmTranscripts,
  extractFrontendAgentLlmTranscripts,
} from "./agent-llm-transcript";
import { mergeConversations } from "./prompt-merger";
import { writeConversationMarkdown } from "./prompt-unified-writer";
import { workspaceArtifactText } from "./artifact-text";
import { generateSummary } from "./summary-generator";
import { extractLogic } from "./logic/index";
import { ARTIFACT_DIRS } from "./utils";
import { extractErrors } from "../parsers/error-extractor";
import { tApp } from "../../../../i18n";


const logger = createLogger("workspace-artifact:post-processor");

export interface WorkspaceArtifactLogResult {
  appLogCount: number;
  llmCallCount: number;
  backendLogCount: number;
  backendAgentLlmCount?: number;
  backendDiagnosticEventCount?: number;
  /** Retrieval status per backend session */
  backendSessions: WorkspaceBackendSessionEvidence[];
  backendLogMessage?: string;
}

export interface WorkspaceArtifactResult {
  logicMarkdown: string;
  artifactDir: string;
  logResult: WorkspaceArtifactLogResult;
  errorCount: number;
  manifest: WorkspaceManifest;
}

export interface BuildWorkspaceArtifactInput {
  domainId?: string;
  workspaceId: string;
  turnKey?: string;
  taskId?: string;
  artifactDir: string;
  metadata: WorkspaceArtifactSummaryMetadata;
  /** Backend session list in the query record */
  backendSessions?: QueryBackendSession[];
  backendTimeWindow?: BackendLogTimeWindow;
  /** Actual query start/end (from the turn run), written into the manifest together with the workspace generation time */
  turnStartedAt?: string;
  turnEndedAt?: string;
  frontendLogTimeWindow?: LogFileTimeWindow;
  includeFrontendLogs?: boolean;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  records?: ParsedLogRecord[];
}

type PostProcessStatusRecorder = Record<string, PostProcessStatusItem>;

function postProcessStatusLabels(): Record<string, string> {
  return {
    frontend_app_log: tApp("diag.observe.workspace-artifact.post-processor.0"),
    frontend_llm_log: tApp("diag.observe.workspace-artifact.post-processor.1"),
    backend_sessions: tApp("diag.observe.workspace-artifact.post-processor.2"),
    backend_log: tApp("diag.observe.workspace-artifact.post-processor.3"),
    backend_agent_llm: tApp("diag.observe.workspace-artifact.post-processor.4"),
    backend_diagnostic_events: tApp("diag.observe.workspace-artifact.post-processor.5"),
  };
}

export async function buildWorkspaceArtifact(
  input: BuildWorkspaceArtifactInput
): Promise<WorkspaceArtifactResult | undefined> {
  const { workspaceId, artifactDir, metadata } = input;
  const includeFrontendLogs = input.includeFrontendLogs !== false;
  const logContext = {
    workspaceId,
    turnKey: input.turnKey,
    taskId: input.taskId,
    targetId: metadata.targetId,
    source: metadata.source,
  };

  try {
    fs.mkdirSync(artifactDir, { recursive: true });
  } catch (err) {
    logger.warn("Failed to create workspace artifact directory", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  let logResult: WorkspaceArtifactLogResult = {
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    backendAgentLlmCount: 0,
    backendDiagnosticEventCount: 0,
    backendSessions: [],
  };
  let collectedRecords: ParsedLogRecord[] = [];
  let logCollectionError: string | undefined;

  if (input.records) {
    // Logs are environment-level evidence; records are not filtered by domain.
    collectedRecords = includeFrontendLogs
      ? input.records
      : input.records.filter((record) => record.source === "backend");
    logResult = inferLogResultFromRecords(collectedRecords, input.backendSessions ?? []);
    logger.debug("Using provided parsed records for workspace artifact", {
      ...logContext,
      ...logResult,
    });
  } else {
    try {
      const collected = await collectLogs({
        artifactDir,
        workspaceId,
        turnKey: input.turnKey,
        taskId: input.taskId,
        backendSessions: input.backendSessions,
        backendTimeWindow: input.backendTimeWindow,
        frontendLogTimeWindow: input.frontendLogTimeWindow,
        includeFrontendLogs,
        token: input.token,
        apiKey: input.apiKey,
        userId: input.userId,
        locale: input.locale,
        signal: input.signal,
      });
      logResult = {
        appLogCount: collected.appLogCount,
        llmCallCount: collected.llmCallCount,
        backendLogCount: collected.backendLogCount,
        backendAgentLlmCount: collected.backendAgentLlmCount,
        backendDiagnosticEventCount: collected.backendDiagnosticEventCount,
        backendSessions: collected.backendSessions,
        backendLogMessage: collected.backendLogMessage,
      };
      collectedRecords = collected.records;
      logger.debug("Log collection complete", {
        ...logContext,
        ...logResult,
      });
    } catch (err) {
      logCollectionError = err instanceof Error ? err.message : String(err);
      logger.warn("Log collection failed", {
        ...logContext,
        error: logCollectionError,
      });
    }
  }

  const responseWrite = writeResponseMarkdown(artifactDir, metadata.finalAnswer);
  if (responseWrite.written && responseWrite.foldedTablesRemoved > 0) {
    logger.debug("Response snapshot removed folded tables", {
      ...logContext,
      foldedTablesRemoved: responseWrite.foldedTablesRemoved,
    });
  }

  const statusItems = buildEvidenceStatusItems({
    includeFrontendLogs,
    logResult,
    logCollectionError,
  });

  const processed = await runArtifactPostProcessing({
    artifactDir,
    workspaceId,
    turnKey: input.turnKey,
    taskId: input.taskId,
    metadata,
    logResult,
    backendSessionIds: logResult.backendSessions.map((session) => session.sessionId),
    records: collectedRecords,
    includeFrontendLogs,
  });
  const postProcessStatus = writePostProcessStatus(artifactDir, workspaceId, statusItems);
  const manifest = writeWorkspaceManifest({
    domainId: input.domainId,
    artifactDir,
    workspaceId,
    turnKey: input.turnKey,
    taskId: input.taskId,
    metadata,
    logResult,
    turnStartedAt: input.turnStartedAt,
    turnEndedAt: input.turnEndedAt,
    errorCount: processed.errorCount,
    postProcess: summarizePostProcessStatus(postProcessStatus),
  });
  return { ...processed, manifest };
}

interface ArtifactPostProcessingInput {
  artifactDir: string;
  workspaceId: string;
  turnKey?: string;
  taskId?: string;
  metadata: WorkspaceArtifactSummaryMetadata;
  logResult: WorkspaceArtifactLogResult;
  /** Prompt restoration and logic extraction filter by these session numbers (including derived ones) */
  backendSessionIds: string[];
  records: ParsedLogRecord[];
  includeFrontendLogs: boolean;
}

async function runArtifactPostProcessing(
  input: ArtifactPostProcessingInput
): Promise<Omit<WorkspaceArtifactResult, "manifest">> {
  const {
    artifactDir,
    workspaceId,
    turnKey,
    taskId,
    metadata,
    logResult,
    backendSessionIds,
    records,
    includeFrontendLogs,
  } = input;
  const logContext = {
    workspaceId,
    turnKey,
    taskId,
    targetId: metadata.targetId,
    source: metadata.source,
  };

  // Step 4: Frontend prompts + backend agent-llm transcripts, then unified write.

  let frontendConvs: UnifiedConversation[] = [];
  let backendConvs: UnifiedConversation[] = [];
  let mergedConvs: UnifiedConversation[] = [];

  // Step 4a: Frontend agent-llm transcript extraction (always runs, independent of sessionId)
  if (includeFrontendLogs) {
    try {
      const frontendResult = extractFrontendAgentLlmTranscripts(artifactDir);
      frontendConvs = frontendResult.conversations;
      logger.debug("Frontend agent-llm transcripts extracted", {
        ...logContext,
        count: frontendConvs.length,
        parsedCount: frontendResult.parsedCount,
        parseErrorCount: frontendResult.parseErrorCount,
      });
    } catch (err) {
      logger.warn("Frontend agent-llm transcript extraction failed (non-blocking)", {
        ...logContext,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 4b: Backend agent-llm transcript extraction (needs sessionId)
  try {
    const backendResult = extractBackendAgentLlmTranscripts(artifactDir, backendSessionIds);
    backendConvs = backendResult.conversations;
    logger.debug("Backend agent-llm transcripts extracted", {
      ...logContext,
      count: backendConvs.length,
      parsedCount: backendResult.parsedCount,
      parseErrorCount: backendResult.parseErrorCount,
    });
  } catch (err) {
    logger.warn("Backend agent-llm transcript extraction failed (non-blocking)", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 4c: Merge and write
  try {
    mergedConvs = mergeConversations(frontendConvs, backendConvs);
    const writeResult = writeConversationMarkdown(artifactDir, mergedConvs);
    logger.info("Prompt merge + write complete", {
      ...logContext,
      frontend: frontendConvs.length,
      backend: backendConvs.length,
      merged: mergedConvs.length,
      filesWritten: writeResult.fileCount,
    });
  } catch (err) {
    logger.warn("Prompt merge/write failed", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 7: Extract errors
  let errorCount = 0;
  try {
    errorCount = extractAndWriteErrors(artifactDir, workspaceId, records);
  } catch (err) {
    logger.warn("Error extraction failed", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 8: Extract MQLS logic from diagnostic-events.
  let logicMarkdown = "";
  try {
    const logicResult = await extractLogic({
      artifactDir,
      sessionIds: backendSessionIds,
    });
    logicMarkdown = logicResult.markdown;
  } catch (err) {
    logger.warn("Logic extraction failed", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 6: Generate summary.md
  try {
    generateSummary({
      artifactDir,
      metadata,
      logicMarkdown,
      promptConversations: mergedConvs,
    });
  } catch (err) {
    logger.warn("Summary generation failed", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.debug("Post-processing completed", {
    ...logContext,
    appLogs: logResult.appLogCount,
    llmCalls: logResult.llmCallCount,
    backendLogs: logResult.backendLogCount,
    diagnosticEvents: logResult.backendDiagnosticEventCount ?? 0,
    errors: errorCount,
    logicExtracted: logicMarkdown.length > 0,
    promptSources: {
      frontend: frontendConvs.length,
      backend: backendConvs.length,
    },
  });

  return { logicMarkdown, artifactDir, logResult, errorCount };
}

/* ------------------------------------------------------------------ */
/*  Internal pipeline steps                                            */
/* ------------------------------------------------------------------ */

function buildEvidenceStatusItems(input: {
  includeFrontendLogs: boolean;
  logResult: WorkspaceArtifactLogResult;
  logCollectionError?: string;
}): PostProcessStatusRecorder {
  const { includeFrontendLogs, logResult, logCollectionError } = input;
  const items: PostProcessStatusRecorder = {};

  recordStatus(
    items,
    "frontend_app_log",
    buildFrontendEvidenceStatus({
      enabled: includeFrontendLogs,
      count: logResult.appLogCount,
      okMessage: tApp("diag.observe.workspace-artifact.post-processor.6", { p0: logResult.appLogCount }),
      emptyMessage: tApp("diag.observe.workspace-artifact.post-processor.7"),
      skippedMessage: tApp("diag.observe.workspace-artifact.post-processor.8"),
      failedMessage: logCollectionError,
    })
  );
  recordStatus(
    items,
    "frontend_llm_log",
    buildFrontendEvidenceStatus({
      enabled: includeFrontendLogs,
      count: logResult.llmCallCount,
      okMessage: tApp("diag.observe.workspace-artifact.post-processor.9", { p0: logResult.llmCallCount }),
      emptyMessage: tApp("diag.observe.workspace-artifact.post-processor.10"),
      skippedMessage: tApp("diag.observe.workspace-artifact.post-processor.11"),
      failedMessage: logCollectionError,
    })
  );

  // Backend-session entries are written per session + node from the query record's session list (design 7, 12).
  const sessions = logResult.backendSessions;
  recordStatus(items, "backend_sessions", buildBackendSessionsStatus(sessions));

  recordStatus(
    items,
    "backend_log",
    buildBackendEvidenceStatus({
      skipped: false,
      count: logResult.backendLogCount,
      message: logResult.backendLogMessage,
      okMessage: tApp("diag.observe.workspace-artifact.post-processor.12", { p0: logResult.backendLogCount }),
      emptyMessage: tApp("diag.observe.workspace-artifact.post-processor.13"),
      skippedMessage: tApp("diag.observe.workspace-artifact.post-processor.14"),
    })
  );
  recordStatus(
    items,
    "backend_agent_llm",
    buildBackendEvidenceStatus({
      skipped: sessions.length === 0,
      count: logResult.backendAgentLlmCount ?? 0,
      message: joinSessionMessages(sessions, "agentLlmMessage"),
      okMessage: tApp("diag.observe.workspace-artifact.post-processor.15", { p0: logResult.backendAgentLlmCount ?? 0 }),
      emptyMessage: tApp("diag.observe.workspace-artifact.post-processor.16"),
      skippedMessage: tApp("diag.observe.workspace-artifact.post-processor.17"),
    })
  );
  recordStatus(
    items,
    "backend_diagnostic_events",
    buildBackendEvidenceStatus({
      skipped: sessions.length === 0,
      count: logResult.backendDiagnosticEventCount ?? 0,
      message: joinSessionMessages(sessions, "diagnosticEventMessage"),
      okMessage: tApp("diag.observe.workspace-artifact.post-processor.18", { p0: logResult.backendDiagnosticEventCount ?? 0 }),
      emptyMessage: tApp("diag.observe.workspace-artifact.post-processor.19"),
      skippedMessage: tApp("diag.observe.workspace-artifact.post-processor.20"),
    })
  );

  return items;
}

/** Session list entries: per session and per node, the time window, count, cancellation, and missing reasons; details also land in post_process_status. */
function buildBackendSessionsStatus(
  sessions: WorkspaceBackendSessionEvidence[]
): PostProcessStatusItem {
  if (sessions.length === 0) {
    return {
      status: "skipped",
      severity: "warning",
      message: tApp("diag.observe.workspace-artifact.post-processor.21"),
    };
  }
  const nodeCount = sessions.reduce((sum, session) => sum + session.nodes.length, 0);
  return {
    status: "ok",
    severity: "info",
    message: tApp("diag.observe.workspace-artifact.post-processor.22", {
      p0: sessions.length,
      p1: nodeCount,
      p2: sessions
      .map(describeBackendSession)
      .join(tApp("diag.observe.workspace-artifact.post-processor.23")),
    }),
    details: {
      sessions: sessions.map((session) => ({ ...session })),
    },
  };
}

function describeBackendSession(session: WorkspaceBackendSessionEvidence): string {
  const nodes = session.nodes
    .map((node) => {
      const nodeLabel = node.nodeId ? `@${node.nodeId}` : tApp("diag.observe.workspace-artifact.post-processor.24");
      const reasons = [
        node.windowMessage,
        node.locationMessage,
        node.agentLlmMessage,
        node.diagnosticEventMessage,
      ].filter(Boolean);
      const counts = tApp("diag.observe.workspace-artifact.post-processor.25", {
        p0: node.agentLlmCount,
        p1: node.diagnosticEventCount,
      });
      const cancelled = node.cancelledAt
        ? tApp("diag.observe.workspace-artifact.post-processor.26", { p0: new Date(node.cancelledAt).toISOString() })
        : "";
      const detail = reasons.length > 0 ? reasons.join(tApp("diag.observe.workspace-artifact.post-processor.23")) : counts;
      return [nodeLabel, cancelled, detail].filter(Boolean).join(" ");
    })
    .join(tApp("diag.observe.workspace-artifact.post-processor.23"));
  return tApp("diag.observe.workspace-artifact.post-processor.27", {
    p0: session.branch,
    p1: session.sessionId,
    p2: nodes,
  });
}

function joinSessionMessages(
  sessions: WorkspaceBackendSessionEvidence[],
  field: "agentLlmMessage" | "diagnosticEventMessage"
): string | undefined {
  const messages = sessions.flatMap((session) =>
    session.nodes
      .map((node) =>
        node[field]
          ? `${session.sessionId}@${node.nodeId ?? tApp("diag.observe.workspace-artifact.post-processor.28")}: ${node[field]}`
          : undefined
      )
      .filter((message): message is string => message !== undefined)
  );
  return messages.length > 0 ? messages.join(tApp("diag.observe.workspace-artifact.post-processor.23")) : undefined;
}

function buildFrontendEvidenceStatus(input: {
  enabled: boolean;
  count: number;
  okMessage: string;
  emptyMessage: string;
  skippedMessage: string;
  failedMessage?: string;
}): PostProcessStatusItem {
  if (!input.enabled) {
    return { status: "skipped", severity: "info", message: input.skippedMessage };
  }
  if (input.failedMessage) {
    return {
      status: "failed",
      severity: "error",
      message: tApp("diag.observe.workspace-artifact.post-processor.29", { p0: input.failedMessage }),
    };
  }
  return {
    status: input.count > 0 ? "ok" : "empty",
    severity: input.count > 0 ? "info" : "warning",
    message: input.count > 0 ? input.okMessage : input.emptyMessage,
  };
}

function buildBackendEvidenceStatus(input: {
  skipped: boolean;
  count: number;
  message?: string;
  okMessage: string;
  emptyMessage: string;
  skippedMessage: string;
}): PostProcessStatusItem {
  if (input.skipped) {
    return { status: "skipped", severity: "warning", message: input.skippedMessage };
  }
  if (isFailureMessage(input.message)) {
    return {
      status: "failed",
      severity: "error",
      message: input.message || tApp("diag.observe.workspace-artifact.post-processor.30"),
    };
  }
  return {
    status: input.count > 0 ? "ok" : "empty",
    severity: input.count > 0 ? "info" : "warning",
    message: input.count > 0 ? input.okMessage : input.message || input.emptyMessage,
  };
}

function isFailureMessage(message?: string): boolean {
  return !!message && workspaceArtifactText().backendEvidence.failureMessagePattern.test(message);
}

function inferLogResultFromRecords(
  records: ParsedLogRecord[],
  backendSessions: QueryBackendSession[]
): WorkspaceArtifactLogResult {
  return {
    appLogCount: records.filter((record) => record.source === workbenchProduct().logSource).length,
    llmCallCount: records.filter((record) => record.source === "llm").length,
    backendLogCount: records.filter((record) => record.source === "backend").length,
    backendAgentLlmCount: 0,
    backendDiagnosticEventCount: 0,
    // When the caller provides records directly, no backend collection runs; only the sessions and nodes located by the query record are kept.
    backendSessions: backendSessions.map((session) => ({
      branch: session.branch,
      sessionId: session.sessionId,
      nodes: [
        {
          nodeId: session.nodeId,
          agentLlmCount: 0,
          diagnosticEventCount: 0,
        },
      ],
    })),
  };
}

export function toResponseSnapshotMarkdown(markdown: string): {
  content: string;
  foldedTablesRemoved: number;
} {
  let foldedTablesRemoved = 0;
  let output = "";
  let cursor = 0;
  const lower = markdown.toLowerCase();

  while (cursor < markdown.length) {
    const start = lower.indexOf("<details", cursor);
    if (start < 0) {
      output += markdown.slice(cursor);
      break;
    }

    const tagEnd = markdown.indexOf(">", start);
    if (tagEnd < 0) {
      output += markdown.slice(cursor);
      break;
    }

    const openTag = markdown.slice(start, tagEnd + 1);
    const isFoldedTable =
      /data-ai-table-details\s*=/i.test(openTag) ||
      /class\s*=\s*["'][^"']*\bda-ts-more\b/i.test(openTag);

    if (!isFoldedTable) {
      output += markdown.slice(cursor, tagEnd + 1);
      cursor = tagEnd + 1;
      continue;
    }

    output += markdown.slice(cursor, start);
    const end = lower.indexOf("</details>", tagEnd + 1);
    const block =
      end >= 0 ? markdown.slice(start, end + "</details>".length) : markdown.slice(start);
    const notice = buildFoldedTableNotice(block);
    if (notice) {
      output = output.replace(/[ \t]*$/u, "");
      output += `\n\n> ${notice}\n`;
    }
    foldedTablesRemoved++;

    if (end < 0) {
      break;
    }
    cursor = end + "</details>".length;
  }

  return { content: output, foldedTablesRemoved };
}

function buildFoldedTableNotice(detailsBlock: string): string | null {
  const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(detailsBlock);
  if (!summaryMatch) return null;
  const summary = summaryMatch[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!summary) return null;
  const hint = workspaceArtifactText().foldedTableHint;
  return summary.replace(hint.pattern, hint.replacement);
}

function writeResponseMarkdown(
  artifactDir: string,
  finalAnswer?: string
): { written: boolean; foldedTablesRemoved: number } {
  if (finalAnswer === undefined) return { written: false, foldedTablesRemoved: 0 };
  const snapshot = toResponseSnapshotMarkdown(finalAnswer);
  fs.writeFileSync(path.join(artifactDir, "response.md"), snapshot.content, "utf-8");
  return { written: true, foldedTablesRemoved: snapshot.foldedTablesRemoved };
}

function writeWorkspaceManifest(input: {
  domainId?: string;
  artifactDir: string;
  workspaceId: string;
  turnKey?: string;
  taskId?: string;
  metadata: WorkspaceArtifactSummaryMetadata;
  logResult: WorkspaceArtifactLogResult;
  turnStartedAt?: string;
  turnEndedAt?: string;
  errorCount: number;
  postProcess: WorkspacePostProcessSummary;
}): WorkspaceManifest {
  const {
    artifactDir,
    workspaceId,
    turnKey,
    taskId,
    metadata,
    logResult,
    turnStartedAt,
    turnEndedAt,
    errorCount,
    postProcess,
  } = input;
  const now = new Date().toISOString();
  const manifest: WorkspaceManifest = {
    domainId: input.domainId,
    workspaceId,
    ...(turnKey ? { turnKey } : {}),
    ...(taskId ? { taskId } : {}),
    status: "completed",
    source: metadata.source,
    createdAt: now,
    completedAt: now,
    appLogCount: logResult.appLogCount,
    llmCallCount: logResult.llmCallCount,
    backendLogCount: logResult.backendLogCount,
    backendDiagnosticEventCount: logResult.backendDiagnosticEventCount,
    errorCount,
    postProcess,
  };

  if (metadata.error) manifest.error = metadata.error;
  if (metadata.durationMs !== undefined) manifest.durationMs = metadata.durationMs;
  if (metadata.runId) manifest.runId = metadata.runId;
  if (metadata.caseId) manifest.caseId = metadata.caseId;
  if (metadata.question) manifest.question = metadata.question;
  if (metadata.threadId) manifest.threadId = metadata.threadId;
  if (logResult.backendSessions.length > 0) manifest.backendSessions = logResult.backendSessions;
  if (turnStartedAt) manifest.turnStartedAt = turnStartedAt;
  if (turnEndedAt) manifest.turnEndedAt = turnEndedAt;
  if (logResult.backendLogMessage) manifest.backendLogMessage = logResult.backendLogMessage;

  fs.writeFileSync(
    path.join(artifactDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  return manifest;
}

function recordStatus(
  items: PostProcessStatusRecorder,
  key: string,
  item: PostProcessStatusItem
): void {
  items[key] = item;
}

function writePostProcessStatus(
  artifactDir: string,
  workspaceId: string,
  items: PostProcessStatusRecorder
): PostProcessStatusFile {
  const status = buildPostProcessStatus(workspaceId, items);
  const diagDir = path.join(artifactDir, ARTIFACT_DIRS.DIAGNOSTICS);
  fs.mkdirSync(diagDir, { recursive: true });
  fs.writeFileSync(
    path.join(diagDir, "post_process_status.json"),
    JSON.stringify(status, null, 2),
    "utf-8"
  );
  return status;
}

function buildPostProcessStatus(
  workspaceId: string,
  items: PostProcessStatusRecorder
): PostProcessStatusFile {
  const severities = Object.values(items).map((item) => item.severity);
  const overallSeverity = highestSeverity(severities);
  const failedCount = Object.values(items).filter((item) => item.status === "failed").length;
  const warningCount = Object.values(items).filter((item) => item.severity === "warning").length;
  const overallStatus =
    failedCount > 0 ? "failed" : warningCount > 0 ? "degraded" : ("ok" as const);
  const degradedLabels = Object.entries(items)
    .filter(([, item]) => item.severity === "warning" || item.severity === "error")
    .map(([key]) => postProcessStatusLabels()[key] || key);
  const message =
    degradedLabels.length > 0
      ? tApp("diag.observe.workspace-artifact.post-processor.31", {
        p0: degradedLabels.join(tApp("diag.observe.workspace-artifact.post-processor.32")),
      })
      : tApp("diag.observe.workspace-artifact.post-processor.33");

  return {
    workspaceId,
    createdAt: new Date().toISOString(),
    overallStatus,
    overallSeverity,
    message,
    items,
  };
}

function summarizePostProcessStatus(status: PostProcessStatusFile): WorkspacePostProcessSummary {
  const warningCount = Object.values(status.items).filter(
    (item) => item.severity === "warning"
  ).length;
  const errorCount = Object.values(status.items).filter((item) => item.severity === "error").length;
  return {
    status:
      status.overallSeverity === "error"
        ? "error"
        : status.overallSeverity === "warning"
          ? "warning"
          : "ok",
    severity: status.overallSeverity,
    message: status.message,
    warningCount,
    errorCount,
  };
}

function highestSeverity(severities: PostProcessSeverity[]): PostProcessSeverity {
  if (severities.includes("error")) return "error";
  if (severities.includes("warning")) return "warning";
  return "info";
}

/**
 * Extract error/warning records from app + LLM logs and write to errors.log.
 *
 * Corresponds to legacy step 6 (error extraction from ragchat + datarag logs).
 * In data-agent, "ragchat" errors come from app-logs and "datarag" errors from
 * backend info logs. Both are parsed in-memory here.
 */
function extractAndWriteErrors(
  artifactDir: string,
  workspaceId: string,
  records: ParsedLogRecord[]
): number {
  const errorSummary = extractErrors(records);

  if (errorSummary.totalErrors === 0 && errorSummary.totalWarnings === 0) {
    return 0;
  }

  const diagDir = path.join(artifactDir, ARTIFACT_DIRS.DIAGNOSTICS);
  fs.mkdirSync(diagDir, { recursive: true });

  const lines: string[] = [];

  if (errorSummary.errors.length > 0) {
    lines.push(`=== ERRORS (${errorSummary.totalErrors}) ===`);
    lines.push("");
    for (const err of errorSummary.errors) {
      lines.push(`[${err.time || "?"}] [${err.source}] ${err.message}`);
    }
    lines.push("");
  }

  if (errorSummary.warnings.length > 0) {
    lines.push(`=== WARNINGS (${errorSummary.totalWarnings}) ===`);
    lines.push("");
    for (const warn of errorSummary.warnings) {
      lines.push(`[${warn.time || "?"}] [${warn.source}] ${warn.message}`);
    }
    lines.push("");
  }

  fs.writeFileSync(path.join(diagDir, "errors.log"), lines.join("\n"), "utf-8");

  return errorSummary.totalErrors;
}
