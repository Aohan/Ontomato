import type { WorkspaceManifest, WorkspaceSource } from "@ontomato/contracts/observe";
/**
 * Turn workspace creation and building.
 *
 * All turns take the same build path. Whether one run consists of sub-turns is answered by the business domain owning the run;
 * the build capability only receives the sub-turn list, knowing nothing about dimensions or trajectories.
 */

import { createLogger } from "../../../../logging/logger";
import { buildAnalysisSubQuestionTurnKey } from "../../../../logging/log-context";
import { getWorkspacePath, loadManifest } from "./store";
import { getCheckpointer } from "../../../../infrastructure/connection";
import { parseTurnKeyOrThrow } from "./turn-resolver";
import {
  buildTurnEvidenceWorkspace,
  type TurnEvidenceCompositeRun,
} from "./turn-evidence-workspace";

const logger = createLogger("observe:turn-workspace-builder");

export type RunCompositionResolver = (turnKey: string) => Promise<{
  taskId: string;
  agentId: string;
  threadId: string;
  requestSeq: number;
  question: string;
  report?: string;
  questions: Array<{ questionId: string; question: string; status: string }>;
} | null>;

let resolveRunComposition: RunCompositionResolver;

export function setRunCompositionResolver(resolver: RunCompositionResolver): void {
  resolveRunComposition = resolver;
}

export interface BuildTurnWorkspaceOptions {
  turnKey: string;
  domainId: string;
  token?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/**
 * Create a Turn workspace: collect logs, parse them, run post-processing,
 * and persist everything to the observe workspace.
 *
 * @returns The final manifest after building.
 */
export async function buildTurnWorkspace(
  options: BuildTurnWorkspaceOptions
): Promise<WorkspaceManifest> {
  const { turnKey, token, apiKey, domainId } = options;
  options.signal?.throwIfAborted();
  const checkpointer = getCheckpointer();
  if (!checkpointer) throw new Error("Thread storage unavailable");
  await checkpointer.verifyThreadDomain(parseTurnKeyOrThrow(turnKey).threadId, domainId);
  const existing = loadManifest(turnKey);
  if (existing && existing.domainId !== domainId)
    throw new Error("Workspace domain does not match the credential");
  const workspaceId = turnKey;
  logger.info("Starting turn workspace build", { turnKey });

  try {
    const composition = await resolveRunComposition(turnKey);
    const compositeRun: TurnEvidenceCompositeRun | undefined = composition
      ? {
          finalAnswer: composition.report,
          subTurns: composition.questions.map((question) => ({
            turnKey: buildAnalysisSubQuestionTurnKey(
              composition.threadId,
              composition.requestSeq,
              question.questionId
            ),
            sourceRef: question.questionId,
            question: question.question,
            status: question.status,
          })),
        }
      : undefined;

    const result = await buildTurnEvidenceWorkspace({
      workspaceId,
      domainId,
      turnKey,
      artifactDir: getWorkspacePath(workspaceId),
      metadata: {
        targetId: turnKey,
        source: composition ? "analysis-task" : "manual",
        question: composition?.question,
        threadId: composition?.threadId,
      },
      taskId: composition?.taskId,
      compositeRun,
      token,
      apiKey,
      signal: options.signal,
    });

    const manifest = composition
      ? { ...result.manifest, taskId: composition.taskId, agentId: composition.agentId }
      : result.manifest;

    logger.info("Turn workspace build finished", {
      turnKey,
      status: result.status,
      subTurnCount: compositeRun?.subTurns.length ?? 0,
      appLogCount: manifest.appLogCount,
      llmCallCount: manifest.llmCallCount,
      backendLogCount: manifest.backendLogCount,
      errorCount: manifest.errorCount,
    });

    return manifest;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Turn workspace build failed", { turnKey, error: msg });
    return { ...failedManifest(workspaceId, msg, "manual", turnKey), domainId };
  }
}

function failedManifest(
  workspaceId: string,
  error: string,
  source: WorkspaceSource = "manual",
  turnKey?: string
): WorkspaceManifest {
  const now = new Date().toISOString();
  return {
    workspaceId,
    ...(turnKey ? { turnKey } : {}),
    status: "failed",
    source,
    createdAt: now,
    completedAt: now,
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    errorCount: 0,
    error,
  };
}
