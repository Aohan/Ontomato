/**
 * Text protocol inside diagnosis workspace artifacts: segment markers of prompt artifacts and sub-query file names,
 * backend evidence notes and their failure decisions, and the rewrite of collapsed-table summaries in response snapshots.
 * Each edition installs its pre-migration original values, independent of request language; code reads by semantic key and never branches on display words.
 */
import type { PromptTranscriptFormat } from "@ontomato/contracts/observe";

/** Prompt marker words and turn-title recognition rules belong to the shared contract PromptTranscriptFormat (the observe page reads the same object). */
export interface WorkspaceArtifactText extends PromptTranscriptFormat {
  /** Prompt file-name fragment of a sub-query try session: `-<word><sub-query number>-try-<n>`. */
  subQueryFilenameWord: string;
  /**
   * Turn title of a prompt artifact. The second parameter is passed only when originalRound differs from round;
   * when omitted it is an ordinary turn (number taken as originalRound ?? round).
   */
  roundTitle(round: number, originalRound?: number): string;
  /**
   * Note text of backend evidence collection (agent-llm, diagnostic-events, backend.log). `…Failed` is followed by external error details;
   * multiple notes and multi-node failures are joined by `separator`. post_process_status uses `failureMessagePattern` to decide whether a
   * note means a fetch failure; the copy and the rule come as a pair.
   */
  backendEvidence: {
    agentLlmEmpty: string;
    agentLlmFailed: string;
    diagnosticEventsEmpty: string;
    diagnosticEventsFailed: string;
    noSession: string;
    noLogWindow: string;
    logSliceFailed: string;
    logEmpty: string;
    separator: string;
    failureMessagePattern: RegExp;
  };
  /** The expand hint inside a collapsed-table summary, rewritten as a note that it was not written into the snapshot. */
  foldedTableHint: { pattern: RegExp; replacement: string };
}

let installed: WorkspaceArtifactText | null = null;

export function installWorkspaceArtifactText(text: WorkspaceArtifactText): void {
  installed = text;
}

export function workspaceArtifactText(): WorkspaceArtifactText {
  if (!installed) throw new Error("Workspace artifact text is not installed");
  return installed;
}
