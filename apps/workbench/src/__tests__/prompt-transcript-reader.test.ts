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

/** 本版 Node writer 的落盘文本，交观察页新阅读解析（按本版格式）消费；另一版的格式不接受（原各自只认本版）。 */
describe("OSS prompt transcript reader", () => {
  it("reads the current writer output as rounds and semantic marker kinds, and rejects the enterprise format", () => {
    // writer 的 Node 文案经 tApp 取值，需本版 Node 词条装配（本 app 未配 vitest setup）。
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

    // 另一版的原格式（c0287200（企业） 固定源 parser 的 MARKER 词与 ROUND_PATTERN）：先证它能识别自己的两类轮次标题，再证不接受本版 writer 输出
    const otherFormat = { promptMarkers: { systemPrompt: "系统提示词", userPrompt: "用户提示词", reasoning: "模型思考", llmOutput: "大模型输出", toolCall: "工具调用", toolReturn: "工具返回", message: "消息" }, roundTitlePattern: /^##\s+调用\s+\d+(?:（原始序号=[^）]+）)?\s*$/ };
    expect(["## 调用 1", "## 调用 4（原始序号=7）"].every((title) => otherFormat.roundTitlePattern.test(title))).toBe(true);
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
