import type { WorkspaceManifest } from "@ontomato/contracts/observe";
/**
 * Shared Turn evidence workspace builder.
 *
 * 一次运行 = 自身证据 + 若干关联 Turn。关联 Turn 有两种语义、构建机制相同、目录分开：
 * 上游 Turn 解释本轮问题为何这样表达；子 Turn 是本次运行的组成部分。被展开的关联
 * Turn 不再继续展开。本模块拥有 Turn 事实、后端证据定位、关联 Turn 展开与最终清单。
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
 * 本次运行的一个组成部分。稳定身份用于定位与关联，文案只用于展示，
 * 业务执行状态与诊断产物状态表达不同事实，索引中分别呈现。
 */
export interface TurnEvidenceSubTurn {
  turnKey: string;
  sourceRef: string;
  question: string;
  status: string;
}

/**
 * 一次复合运行由它所属的执行形态声明：形态给出本次运行的可读最终回复和子 Turn 列表。
 * 声明存在即表示"这个 Turn 的回复由形态提供"——形态没给出回复就是证据缺口，
 * 不得退回按线程与请求序号去取同线程的对话回复。
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
  /** 本 Turn 所属形态对这次复合运行的声明；不传即普通运行 */
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
      // 复合运行的可读最终回复只认形态给出的那一份；形态没给出即证据缺口。
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
  /** 问题的业务执行状态 */
  status: string;
  /** 该子 Turn 诊断产物的构建状态 */
  artifactStatus: TurnEvidenceWorkspaceStatus;
  artifactPath: string;
}

/**
 * 每个子 Turn 各建一次证据工作区，产出与父层同构。子 Turn 不再展开自己的关联 Turn。
 * 目录名 = 受理顺序编号 + 稳定身份，编号只表达排列，定位靠稳定身份。
 * 不传 finalAnswer：子 Turn 的回复由 Turn 解析从它自己的查询事实取，缺失即证据缺口。
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
 * 根索引是分诊概览，不是报告副本：平铺列出每个子 Turn，问题执行状态与产物构建
 * 状态分列，不复述执行形态的分组事实，也不复制子 Turn 的完整回答。
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
    // 索引是分诊便利，写失败不影响已经落盘的子 Turn 证据。
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
