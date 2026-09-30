/**
 * Summary Markdown generator for workspace artifacts.
 *
 * Generates a lightweight diagnostic evidence index. Fixed sections:
 *
 * - Chain mode (standard ABC / ABC Harness / unrecognized, inferred from captured roles)
 * - The user question
 * - MQL / logic chain
 *
 * Role sections are rendered only when the corresponding role is captured
 * in the prompt conversations (displayName substring match):
 *
 * - Question analyst output / sub-question DSL / data analysis expert Python code (standard chain)
 * - ABCHarness programmer (harness chain)
 *
 * When neither chain's roles are captured, a single extraction-anomaly note
 * replaces the per-section placeholders.
 */

import fs from "node:fs";
import path from "node:path";
import { tApp } from "../../../../i18n";
import { createLogger } from "../../../../logging/logger";
import { modelAgentCatalog } from "../../../../logging/model-agents";
import { ARTIFACT_DIRS } from "./utils";
import type { UnifiedConversation } from "./prompt-types";

const logger = createLogger("workspace-artifact:summary-generator");

export type WorkspaceArtifactSource = "autotest" | "manual" | "analysis-task";

export interface WorkspaceArtifactSummaryMetadata {
  targetId: string;
  source: WorkspaceArtifactSource;
  question?: string;
  finalAnswer?: string;
  runId?: string;
  caseId?: string;
  threadId?: string;
  durationMs?: number;
  error?: string;
}

export interface SummaryInput {
  artifactDir: string;
  metadata: WorkspaceArtifactSummaryMetadata;
  /** MQLS logic markdown extracted from diagnostic-events (mqls_logic.md content). */
  logicMarkdown?: string;
  /** Merged prompt conversations written to prompts/. */
  promptConversations?: UnifiedConversation[];
}

/**
 * Generate summary.md for a workspace artifact.
 */
export function generateSummary(input: SummaryInput): void {
  const { artifactDir, metadata, logicMarkdown, promptConversations } = input;
  const diagDir = path.join(artifactDir, ARTIFACT_DIRS.DIAGNOSTICS);

  fs.mkdirSync(diagDir, { recursive: true });

  const content = buildSummaryMarkdown(metadata, logicMarkdown, promptConversations);
  const summaryPath = path.join(diagDir, "summary.md");

  fs.writeFileSync(summaryPath, content, "utf-8");
  logger.debug("Summary generated", {
    targetId: metadata.targetId,
    source: metadata.source,
  });
}

/* ------------------------------------------------------------------ */
/*  Markdown builder                                                    */
/* ------------------------------------------------------------------ */

/**
 * Wrap text in a Markdown code block to prevent renderer interference.
 */
function codeBlock(lang: string, text?: string, placeholder = "(empty)"): string {
  const t = (text ?? "").trim();
  return `\`\`\`${lang}\n${t || placeholder}\n\`\`\``;
}

function textOrPlaceholder(text?: string, placeholder = "(empty)"): string {
  const t = (text ?? "").trim();
  return t || placeholder;
}

function buildSummaryMarkdown(
  metadata: WorkspaceArtifactSummaryMetadata,
  logicMarkdown?: string,
  promptConversations?: UnifiedConversation[]
): string {
  const lines: string[] = [];

  const conversations = promptConversations ?? [];
  const analyzerName = tApp("summary.role.analyzer");
  const dslName = tApp("summary.role.dsl");
  const calculatorName = tApp("summary.role.calculator");
  const harnessName = tApp("summary.role.harness");
  const hasRole = (roleName: string): boolean =>
    conversations.some((conv) => conv.displayName.includes(roleName));

  const analyzerCaptured = hasRole(analyzerName);
  const dslConversations = conversations.filter((conv) => conv.displayName.includes(dslName));
  const calculatorCaptured = hasRole(calculatorName);
  const harnessConversations = conversations.filter((conv) => conv.displayName.includes(harnessName));

  const isHarness = harnessConversations.length > 0;
  const hasStandard = analyzerCaptured || dslConversations.length > 0 || calculatorCaptured;
  const chainMode = isHarness
    ? tApp("summary.chain.harness")
    : hasStandard
      ? tApp("summary.chain.standard")
      : tApp("summary.chain.unrecognized");

  lines.push(tApp("summary.title"));
  lines.push("");
  lines.push(tApp("summary.chainMode", { mode: chainMode }));
  lines.push("");
  lines.push(tApp("summary.question"));
  lines.push(textOrPlaceholder(metadata.question));
  lines.push("");

  lines.push(tApp("summary.logic"));
  lines.push(codeBlock("markdown", logicMarkdown));
  lines.push("");

  if (analyzerCaptured) {
    lines.push(tApp("summary.analyzer.heading"));
    lines.push(
      textOrPlaceholder(collectOutputText(conversations, (name) => name.includes(analyzerName)))
    );
    lines.push("");
  }

  if (dslConversations.length > 0) {
    lines.push(tApp("summary.dsl.heading"));
    dslConversations.forEach((conv, index) => {
      lines.push(tApp("summary.dsl.item", { index: index + 1 }));
      lines.push(codeBlock("json", conversationOutputText(conv)));
      lines.push("");
    });
  }

  if (calculatorCaptured) {
    lines.push(tApp("summary.calculator.heading"));
    const pythonBlocks = extractPythonCodeBlocks(
      collectOutputText(conversations, (name) => name.includes(calculatorName))
    );
    if (pythonBlocks.length === 0) {
      lines.push(tApp("summary.calculator.noPython"));
      lines.push("");
    } else {
      pythonBlocks.forEach((block, index) => {
        if (pythonBlocks.length > 1) {
          lines.push(tApp("summary.python.item", { index: index + 1 }));
        }
        lines.push(codeBlock("python", block));
        lines.push("");
      });
    }
  }

  if (isHarness) {
    const harnessConv = harnessConversations[harnessConversations.length - 1];
    const roundCount = harnessConv.rounds.length;
    const lastRoundOutput = harnessConv.rounds[harnessConv.rounds.length - 1]?.outputText;

    lines.push(tApp("summary.harness.heading"));
    lines.push(tApp("summary.harness.rounds", { count: roundCount }));
    lines.push(
      tApp("summary.harness.artifacts", {
        dir: ARTIFACT_DIRS.PROMPTS,
        file: modelAgentCatalog().backendDisplayNames.ABC_PROGRAMMER,
      })
    );
    lines.push("");
    lines.push(tApp("summary.harness.lastRound"));
    lines.push(codeBlock("markdown", lastRoundOutput));
    lines.push("");

    const pythonBlocks = extractPythonCodeBlocks(
      collectOutputText(conversations, (name) => name.includes(harnessName))
    );
    if (pythonBlocks.length > 0) {
      lines.push(tApp("summary.harness.pythonHeading"));
      pythonBlocks.forEach((block, index) => {
        if (pythonBlocks.length > 1) {
          lines.push(tApp("summary.harness.pythonItem", { index: index + 1 }));
        }
        lines.push(codeBlock("python", block));
        lines.push("");
      });
    }
  }

  if (!isHarness && !hasStandard) {
    lines.push(tApp("summary.missing.heading"));
    lines.push(tApp("summary.missing.body", { rawLogs: ARTIFACT_DIRS.RAW_LOGS }));
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function collectOutputText(
  conversations: UnifiedConversation[],
  predicate: (displayName: string) => boolean
): string {
  return conversations
    .filter((conv) => predicate(conv.displayName))
    .map(conversationOutputText)
    .filter((text): text is string => Boolean(text))
    .join("\n\n---\n\n");
}

function conversationOutputText(conversation: UnifiedConversation): string {
  return conversation.rounds
    .map((round) => round.outputText?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function extractPythonCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const code = match[1]?.trim();
    if (code) blocks.push(code);
  }
  return blocks;
}
