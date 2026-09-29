import type { WorkspaceManifest } from "@ontomato/contracts/observe";
/**
 * Shared Turn evidence workspace builder.
 *
 * One run = its own evidence + several related turns. Related turns have two semantics, one build mechanism, separate directories:
 * upstream turns explain why this turn's question was phrased this way; sub-turns are constituents of this run. Related turns
 * already expanded are never expanded further. This module owns turn facts, backend evidence locating, related-turn expansion, and the final manifest.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getCheckpointer } from "../../../../infrastructure/connection";
import {
  buildWorkspaceArtifact,
  type BuildWorkspaceArtifactInput,
  type WorkspaceArtifactResult,
} from "../workspace-artifact/post-processor";

import { WORKSPACE_DIRS } from "./store";
import {
  parseTurnKeyOrThrow,
  resolveQueryRunBackendSessions,
  resolveTurnRunActualTimes,
  resolveTurnRunBackendTimeWindow,
  resolveTurnWorkspaceContext,
  type ResolvedTurnWorkspaceContext,
  type ResolvedUpstreamTurn,
} from "./turn-resolver";
import { workbenchProduct } from "../../../../product/installed";
import { tApp } from "../../../../i18n";


export type TurnEvidenceWorkspaceStatus = "success" | "degraded" | "failed";


/**
 * One constituent of this run. The stable identity locates and correlates, the copy is display-only,
 * and business execution state and diagnosis artifact state express different facts, presented separately in the index.
 */
export interface TurnEvidenceSubTurn {
  turnKey: string;
  sourceRef: string;
  question: string;
  status: string;
}

/**
 * A composite run is declared by the execution form it belongs to: the form supplies the run's readable final reply and the sub-turn list.
 * The declaration's existence means "this turn's reply is provided by the form" — a missing reply is an evidence gap,
 * and falling back to fetching same-thread conversation replies by thread and request sequence is never allowed.
 */
export interface TurnEvidenceCompositeRun {
  finalAnswer?: string;
  subTurns: TurnEvidenceSubTurn[];
}

export type BuildTurnEvidenceWorkspaceInput = Omit<
  BuildWorkspaceArtifactInput,
  "turnKey" | "backendSessions" | "backendTimeWindow" | "frontendLogTimeWindow"
> & {
  turnKey: string;
  domainId: string;
  includeUpstreamTurns?: boolean;
  /** The declaration of this turn's execution form about this composite run; omitted means an ordinary run */
  compositeRun?: TurnEvidenceCompositeRun;
};

export interface BuildTurnEvidenceWorkspaceResult {
  status: TurnEvidenceWorkspaceStatus;
  manifest: WorkspaceManifest;
  artifactResult?: WorkspaceArtifactResult;
  reason?: string;
}

interface InternalBuildTurnEvidenceWorkspaceResult extends BuildTurnEvidenceWorkspaceResult {
  turnContext?: ResolvedTurnWorkspaceContext;
}

export async function buildTurnEvidenceWorkspace(
  input: BuildTurnEvidenceWorkspaceInput
): Promise<BuildTurnEvidenceWorkspaceResult> {
  const includeUpstreamTurns = input.includeUpstreamTurns !== false;
  const result = await buildSingleTurnEvidenceWorkspace(input, { includeUpstreamTurns });
  if (result.status !== "failed") {
    if (includeUpstreamTurns && result.turnContext) {
      await buildUpstreamTurnWorkspaces(input, result.turnContext.upstreamTurns);
    }
    const subTurns = input.compositeRun?.subTurns ?? [];
    if (subTurns.length > 0) {
      writeSubTurnIndex(input.artifactDir, await buildSubTurnWorkspaces(input, subTurns));
    }
  }
  const { turnContext: _turnContext, ...publicResult } = result;
  return publicResult;
}

async function buildSingleTurnEvidenceWorkspace(
  input: BuildTurnEvidenceWorkspaceInput,
  options: { includeUpstreamTurns: boolean }
): Promise<InternalBuildTurnEvidenceWorkspaceResult> {
  const sourceTurn = parseTurnKeyOrThrow(input.turnKey);
  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new Error("Thread storage unavailable");
  await checkpointer.verifyThreadDomain(sourceTurn.threadId, input.domainId);
  try {
    const turn = parseTurnKeyOrThrow(input.turnKey);
    const turnContext = await resolveTurnWorkspaceContext(turn, {
      checkpointer: getCheckpointer(),
      includePreviousNoQueryTurn: options.includeUpstreamTurns,
    });
    const queryRun = turnContext.selectedQueryRun ?? turnContext.primaryQueryRun;
    const backendSessions = resolveQueryRunBackendSessions(queryRun);
    const turnTimes = resolveTurnRunActualTimes(turnContext.turnRun);
    const metadata = {
      ...input.metadata,
      question: input.metadata.question ?? turnContext.question,
      // A composite run's readable final reply accepts only the one supplied by the form; a missing one is an evidence gap.
      finalAnswer: input.compositeRun
        ? input.compositeRun.finalAnswer
        : (input.metadata.finalAnswer ?? turnContext.finalAnswer),
      threadId: input.metadata.threadId ?? turnContext.turn.threadId,
    };

    const artifactResult = await buildWorkspaceArtifact({
      ...input,
      metadata,
      backendSessions,
      backendTimeWindow: resolveTurnRunBackendTimeWindow(turnContext.turnRun),
      turnStartedAt: turnTimes?.startedAt,
      turnEndedAt: turnTimes?.endedAt,
      frontendLogTimeWindow: turnContext.frontendLogTimeWindow,
    });
    if (!artifactResult) {
      return failedResult(input, "Turn artifact generation failed", turnContext);
    }

    const manifest = withTurnManifestFields(
      { ...artifactResult.manifest, domainId: input.domainId },
      turnContext,
      metadata
    );
    writeManifestFile(input.artifactDir, manifest);

    const status =
      manifest.postProcess?.severity === "warning" || manifest.postProcess?.severity === "error"
        ? "degraded"
        : "success";
    return {
      status,
      manifest,
      artifactResult,
      reason: status === "degraded" ? manifest.postProcess?.message : undefined,
      turnContext,
    };
  } catch (error) {
    return failedResult(input, error instanceof Error ? error.message : String(error));
  }
}

async function buildUpstreamTurnWorkspaces(
  input: BuildTurnEvidenceWorkspaceInput,
  upstreamTurns: ResolvedUpstreamTurn[]
): Promise<void> {
  if (upstreamTurns.length === 0) return;

  for (const upstream of upstreamTurns) {
    const upstreamArtifactDir = path.join(
      input.artifactDir,
      workbenchProduct().diagnosisWorkspaceNames.upstreamTurns,
      String(upstream.requestSeq)
    );
    await buildSingleTurnEvidenceWorkspace(
      {
        ...input,
        workspaceId: `${input.workspaceId}:upstream:${upstream.requestSeq}`,
        turnKey: upstream.turnKey,
        artifactDir: upstreamArtifactDir,
        includeUpstreamTurns: false,
        metadata: {
          targetId: `${input.metadata.targetId}:upstream:${upstream.requestSeq}`,
          source: input.metadata.source,
          question: upstream.question,
          finalAnswer: upstream.finalAnswer,
          runId: input.metadata.runId,
          caseId: input.metadata.caseId,
          threadId: upstream.threadId,
        },
        records: undefined,
      },
      { includeUpstreamTurns: false }
    );
    writeUpstreamSnapshotFile(upstreamArtifactDir, upstream);
  }
}

interface SubTurnIndexEntry {
  sourceRef: string;
  question: string;
  /** Business execution state of the question */
  status: string;
  /** Build state of this sub-turn's diagnosis artifacts */
  artifactStatus: TurnEvidenceWorkspaceStatus;
  artifactPath: string;
}

/**
 * One evidence workspace is built per sub-turn, producing the same structure as the parent layer. Sub-turns never expand their own related turns.
 * Directory name = acceptance order number + stable identity; the number only expresses ordering while locating relies on the stable identity.
 * finalAnswer is not passed: a sub-turn's reply comes from its own query facts via turn resolution, and a missing one is an evidence gap.
 */
async function buildSubTurnWorkspaces(
  input: BuildTurnEvidenceWorkspaceInput,
  subTurns: TurnEvidenceSubTurn[]
): Promise<SubTurnIndexEntry[]> {
  const entries: SubTurnIndexEntry[] = [];

  for (const [index, subTurn] of subTurns.entries()) {
    const dirName = `${String(index + 1).padStart(2, "0")}_${safePathSegment(subTurn.sourceRef)}`;
    const artifactPath = `${workbenchProduct().diagnosisWorkspaceNames.subTurns}/${dirName}`;
    const result = await buildSingleTurnEvidenceWorkspace(
      {
        ...input,
        workspaceId: subTurn.turnKey,
        turnKey: subTurn.turnKey,
        artifactDir: path.join(input.artifactDir, workbenchProduct().diagnosisWorkspaceNames.subTurns, dirName),
        includeUpstreamTurns: false,
        compositeRun: undefined,
        metadata: {
          targetId: subTurn.turnKey,
          source: input.metadata.source,
          question: subTurn.question,
          runId: input.metadata.runId,
          caseId: input.metadata.caseId,
          threadId: input.metadata.threadId,
        },
        records: undefined,
      },
      { includeUpstreamTurns: false }
    );

    entries.push({
      sourceRef: subTurn.sourceRef,
      question: subTurn.question,
      status: subTurn.status,
      artifactStatus: result.status,
      artifactPath,
    });
  }

  return entries;
}

/**
 * The root index is a triage overview, not a report copy: every sub-turn is listed flat, with question execution state and artifact
 * build state in separate columns; it never restates the execution form's grouping facts nor copies sub-turns' full answers.
 */
function writeSubTurnIndex(artifactDir: string, entries: SubTurnIndexEntry[]): void {
  const lines = [
    tApp("diag.observe.workspaces.turn-evidence-workspace.0"),
    "",
    tApp("diag.observe.workspaces.turn-evidence-workspace.1", { p0: entries.length }),
    "",
    tApp("diag.observe.workspaces.turn-evidence-workspace.2"),
    "| --- | --- | --- | --- | --- | --- |",
    ...entries.map((entry, index) =>
      [
        "",
        String(index + 1),
        escapeTableCell(entry.question),
        `\`${escapeTableCell(entry.sourceRef)}\``,
        escapeTableCell(entry.status),
        entry.artifactStatus,
        `\`${escapeTableCell(entry.artifactPath)}\``,
        "",
      ].join(" | ")
    ),
    "",
  ];

  const diagnosticsDir = path.join(artifactDir, WORKSPACE_DIRS.DIAGNOSTICS);
  try {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    fs.writeFileSync(path.join(diagnosticsDir, "index.md"), lines.join("\n"), "utf-8");
  } catch {
    // The index is a triage convenience; a write failure never affects the sub-turn evidence already on disk.
  }
}

function safePathSegment(value: string): string {
  const hash = createHash("md5")
    .update(value || "empty")
    .digest("hex")
    .slice(0, 8);
  const cleaned = (value || "item")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+/g, ".")
    .slice(0, 48)
    .replace(/^_+|_+$/g, "");
  return `${cleaned || "item"}_${hash}`;
}

function escapeTableCell(value: string): string {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function withTurnManifestFields(
  manifest: WorkspaceManifest,
  turnContext: ResolvedTurnWorkspaceContext,
  metadata: BuildWorkspaceArtifactInput["metadata"]
): WorkspaceManifest {
  return {
    ...manifest,
    turnKey: turnContext.turn.turnKey,
    threadId: turnContext.turn.threadId,
    requestSeq: turnContext.turn.requestSeq,
    source: metadata.source,
    question: metadata.question ?? manifest.question,
    upstreamTurns:
      turnContext.upstreamTurns.length > 0
        ? turnContext.upstreamTurns.map(({ snapshot: _snapshot, ...upstream }) => upstream)
        : undefined,
  };
}

function failedResult(
  input: BuildTurnEvidenceWorkspaceInput,
  reason: string,
  turnContext?: ResolvedTurnWorkspaceContext
): InternalBuildTurnEvidenceWorkspaceResult {
  const now = new Date().toISOString();
  const manifest: WorkspaceManifest = {
    domainId: input.domainId,
    workspaceId: input.workspaceId,
    turnKey: turnContext?.turn.turnKey ?? input.turnKey,
    requestSeq: turnContext?.turn.requestSeq,
    status: "failed",
    source: input.metadata.source,
    createdAt: now,
    completedAt: now,
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    errorCount: 0,
    error: reason,
    runId: input.metadata.runId,
    caseId: input.metadata.caseId,
    question: input.metadata.question ?? turnContext?.question,
    threadId: turnContext?.turn.threadId ?? input.metadata.threadId,
  };
  writeManifestFile(input.artifactDir, manifest);
  return { status: "failed", manifest, reason };
}

function writeUpstreamSnapshotFile(artifactDir: string, upstream: ResolvedUpstreamTurn): void {
  if (upstream.snapshot === undefined) return;
  try {
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, "snapshot.json"),
      JSON.stringify(upstream.snapshot, null, 2),
      "utf-8"
    );
  } catch {
    // Snapshot evidence is best-effort; the full workspace manifest/status is already written.
  }
}

function writeManifestFile(artifactDir: string, manifest: WorkspaceManifest): void {
  try {
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
  } catch {
    // A failed manifest is still returned to the caller even if the disk write fails.
  }
}
