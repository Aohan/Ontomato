import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installWorkbenchProduct } from "@ontomato/workbench-server";
import { installWorkspaceArtifactText } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/artifact-text";
import { writeConversationMarkdown } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/prompt-unified-writer";
import type { UnifiedConversation } from "@ontomato/workbench-server/platform/diagnosis/observe/workspace-artifact/prompt-types";
import { parsePromptTranscript } from "./fixtures/b6437c86-prompt-transcript-parser";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";
import { ossWorkspaceArtifactText } from "../workspace-artifact-text";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("OSS prompt round titles", () => {
  it("writes titles the fixed open-source parser accepts as rounds", () => {
    // The writer's Node copy is read through tApp: install this app's Node messages (this app has no vitest setup).
    configureOssI18n();
    installWorkbenchProduct(ossProduct);
    installWorkspaceArtifactText(ossWorkspaceArtifactText);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oss-rounds-"));
    dirs.push(dir);
    const written = writeConversationMarkdown(dir, [conversation("ontomato")]);
    const content = fs.readFileSync(
      path.join(dir, ossProduct.diagnosisWorkspaceNames.prompts, written.fileNames[0]),
      "utf8"
    );
    const parsed = parsePromptTranscript(content);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.transcript.rounds.map((round) => round.title)).toEqual([
      "## Call 1",
      "## Call 2",
      "## Call 4 (original seq=7)",
    ]);
  });
});

function conversation(source: UnifiedConversation["source"]): UnifiedConversation {
  const round = (roundNumber: number, originalRound: number | undefined, text: string) => ({
    round: roundNumber,
    originalRound,
    incrementalMessages: [],
    outputToolCalls: [],
    outputText: text,
  });
  return {
    agentId: "agent",
    displayName: "Agent",
    source,
    slotId: "front",
    order: 1,
    meta: {},
    rounds: [round(1, undefined, "one"), round(2, 2, "same"), round(4, 7, "moved")],
  };
}
