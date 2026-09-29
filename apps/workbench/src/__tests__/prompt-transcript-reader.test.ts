import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installWorkbenchProduct } from "@ontomato/workbench-server";
import { installWorkspaceArtifactText } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/artifact-text";
import { writeConversationMarkdown } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/prompt-unified-writer";
import type { UnifiedConversation } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/prompt-types";
import { parsePromptTranscript } from "@ontomato/workbench-ui/features/diagnosis/utils/prompt-transcript-parser";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";
import { ossWorkspaceArtifactText } from "../workspace-artifact-text";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** On-disk text of this edition's Node writer, consumed by the observe page's new reader/parser (this edition's format); the other edition's format is not accepted (originally each accepted only its own). */
describe("OSS prompt transcript reader", () => {
  it("reads the current writer output as rounds and semantic marker kinds, and rejects the enterprise format", () => {
    // The writer's Node copy is read through tApp, requiring this edition's Node messages to be installed (this app has no vitest setup).
    configureOssI18n();
    installWorkbenchProduct(ossProduct);
    installWorkspaceArtifactText(ossWorkspaceArtifactText);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oss-reader-"));
    dirs.push(dir);
    const written = writeConversationMarkdown(dir, [conversation("ontomato")]);
    const content = fs.readFileSync(
      path.join(dir, ossProduct.diagnosisWorkspaceNames.prompts, written.fileNames[0]),
      "utf8"
    );

    const parsed = parsePromptTranscript(content, ossWorkspaceArtifactText);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.transcript.rounds.map((round) => round.title)).toEqual(["## Call 1", "## Call 4 (original seq=7)"]);
    const items = parsed.transcript.rounds.flatMap((round) => round.groups.flatMap((group) => group.items));
    expect(items.map((item) => (item.kind === "section" ? item.type : item.kind))).toEqual([
      "userPrompt",
      "llmOutput",
      "tool",
      "llmOutput",
    ]);

    // The other edition's original format (the MARKER words and ROUND_PATTERN of the c0287200/enterprise fixed-source parser): first prove it recognizes its own two turn-title kinds, then prove it does not accept this edition's writer output
    // The escaped literals are the enterprise edition's persisted prompt-marker words and turn-title pattern (see the \u escapes below):
    // persisted protocol values, kept byte-identical.
    const otherFormat = { promptMarkers: { systemPrompt: "\u7cfb\u7edf\u63d0\u793a\u8bcd", userPrompt: "\u7528\u6237\u63d0\u793a\u8bcd", reasoning: "\u6a21\u578b\u601d\u8003", llmOutput: "\u5927\u6a21\u578b\u8f93\u51fa", toolCall: "\u5de5\u5177\u8c03\u7528", toolReturn: "\u5de5\u5177\u8fd4\u56de", message: "\u6d88\u606f" }, roundTitlePattern: /^##\s+\u8c03\u7528\s+\d+(?:（\u539f\u59cb\u5e8f\u53f7=[^）]+）)?\s*$/ };
    expect(["## \u8c03\u7528 1", "## \u8c03\u7528 4（\u539f\u59cb\u5e8f\u53f7=7）"].every((title) => otherFormat.roundTitlePattern.test(title))).toBe(true);
    expect(parsePromptTranscript(content, otherFormat)).toEqual({ ok: false, reason: "not_unified" });
  });
});

function conversation(source: UnifiedConversation["source"]): UnifiedConversation {
  return {
    agentId: "agent",
    displayName: "Agent",
    source,
    slotId: "front",
    order: 1,
    meta: {},
    rounds: [
      {
        round: 1,
        originalRound: undefined,
        incrementalMessages: [{ role: "user", text: "question" }],
        outputToolCalls: [{ id: "call-1", name: "query", arguments: "{}" }],
        outputText: "calling",
      },
      {
        round: 4,
        originalRound: 7,
        incrementalMessages: [{ role: "tool", toolCallId: "call-1", toolName: "query", text: "rows" }],
        outputToolCalls: [],
        outputText: "done",
      },
    ],
  };
}
