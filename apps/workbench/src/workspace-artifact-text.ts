import type { WorkspaceArtifactText } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/artifact-text";

/** Diagnosis artifact text protocol from before the open-source migration (b6437c86's prompt-unified-writer and post-processor). */
export const ossWorkspaceArtifactText: WorkspaceArtifactText = {
  promptMarkers: {
    systemPrompt: "System Prompt",
    userPrompt: "User Prompt",
    reasoning: "Model Reasoning",
    llmOutput: "LLM Output",
    toolCall: "Tool Call",
    toolReturn: "Tool Return",
    message: "Message",
  },
  roundTitlePattern: /^##\s+Call\s+\d+(?:\s+\(original seq=[^)]+\))?\s*$/,
  subQueryFilenameWord: "subquery",
  roundTitle(round, originalRound) {
    if (originalRound === undefined) return `## Call ${round}`;
    return `## Call ${round} (original seq=${originalRound})`;
  },
  backendEvidence: {
    agentLlmEmpty: "agent-llm records are empty: no backend LLM call records found for this sessionId",
    agentLlmFailed: "Failed to fetch agent-llm records: ",
    diagnosticEventsEmpty:
      "diagnostic-events records are empty: no backend diagnostic events found for this sessionId",
    diagnosticEventsFailed: "Failed to fetch diagnostic-events: ",
    noSession: "No node located: the query record has no backend session",
    noLogWindow: "No backend runtime log time window found; backend.log slice skipped",
    logSliceFailed: "Failed to fetch the backend runtime log slice: ",
    logEmpty: "backend.log is empty: no backend runtime logs found within this time window",
    separator: "; ",
    failureMessagePattern: /failure|exception|failed|error/i,
  },
  foldedTableHint: { pattern: /,?click to expand and view all/g, replacement: "not written to snapshot" },
};
