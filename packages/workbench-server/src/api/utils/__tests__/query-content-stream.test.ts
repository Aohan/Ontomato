import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { applyAbcContent, type AbcContentEvent } from "@ontomato/contracts/chat";

import { RunStreamStore } from "../run-stream";
import { configureI18n, getConclusionPrefix } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchProduct } from "../../../product/installed";
import type { WorkbenchProduct } from "../../../product/types";

/**
 * The live query body from the real ABC producer (description, large result table, conclusion) through
 * the wire projection and the run's replayable event log. Models answer with many reasoning-only
 * chunks (empty string content, as LangChain OpenAI delivers them) around a little body text; the
 * backend returns enough rows to make the table prefix large.
 */

const SUB_QUESTION = "Revenue by region";
const ROWS = Array.from({ length: 3000 }, (_, index) => ({ region: `region-${index}`, amount: index }));
const REASONING_CHUNKS = 400;

const modelStreams: string[][] = [];

vi.mock("../../../config/model-factory", () => ({
  createModel: async () => ({
    invoke: async () => {
      throw new Error("field plan model unavailable in test");
    },
    stream: async () => {
      const texts = modelStreams.shift()!;
      return (async function* () {
        for (const text of texts) {
          for (let i = 0; i < REASONING_CHUNKS / texts.length; i += 1) yield { content: "" };
          yield { content: text };
        }
      })();
    },
  }),
}));

vi.mock("../../../services/data-query/client", () => ({
  streamQuestionSplit: async function* () {
    yield { subQuestion: { subQuestion: SUB_QUESTION } };
    yield { sessionId: "session-1" };
  },
  streamDataChunks: async function* () {
    yield { source: "stream", data: [{ answer: ROWS, problem: SUB_QUESTION }] };
  },
}));

vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "prompt" }));
vi.mock("../../../logging/model-agents", () => ({ modelAgentName: (role: string) => role }));

vi.mock("../../../services/data-query/data-query-policy", () => ({
  getAbcQuestionMode: () => "tool_fixed",
  getQueryTimeoutMs: () => 60_000,
}));

function subscribeFrom(store: RunStreamStore, runId: string, lastEventId: number) {
  const frames: unknown[] = [];
  let pending = "";
  const res = {
    writableEnded: false,
    setHeader: () => undefined,
    write: (chunk: string) => {
      pending += chunk;
      if (!pending.endsWith("\n\n")) return true;
      const data = pending.split("\n").find((line) => line.startsWith("data: "));
      if (data && !pending.startsWith("event:")) frames.push(JSON.parse(data.slice(6)));
      pending = "";
      return true;
    },
    end: () => undefined,
  } as unknown as Response;
  const req = {
    userId: "user-1",
    domainId: "domain-1",
    header: (name: string) => (name === "last-event-id" ? String(lastEventId) : undefined),
    on: () => undefined,
  } as unknown as Request;
  store.subscribe(req, res, store.getRun(runId)!);
  return frames;
}

const bodyOf = (frames: unknown[], start = "") =>
  (frames as Array<{ type: string }>)
    .filter((frame): frame is AbcContentEvent => frame.type === "abc_content")
    .reduce(applyAbcContent, start);

describe("live ABC query body on the wire", () => {
  it("sends body deltas only, never repeats the table per chunk, and replays to the same body", async () => {
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: false,
      appTextLocale: "en",
      packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
    });
    installWorkbenchProduct({
      groupColumnHeader: "group",
      primaryDimensionHeaders: { exact: [], contains: [] },
    } as unknown as WorkbenchProduct);
    // Query modules read app text while loading, so they are imported once i18n is configured.
    const { executeBaseQuery } = await import("../../../services/data-query/base-query-executor");
    const { convertEventForFrontend } = await import("../../../services/chat/event-projection");
    // The model splits the conclusion label mid-word, so plain label text is already on the wire
    // when the full label arrives and the producer rewrites it into its styled form.
    const prefix = getConclusionPrefix(undefined);
    const cut = prefix.length - 4;
    modelStreams.push(
      ["Group revenue ", "by region."],
      [prefix.slice(0, cut), prefix.slice(cut), "east leads", "."]
    );
    const store = new RunStreamStore();
    store.startRun({ runId: "run-1", key: "k", userId: "user-1", domainId: "domain-1" });
    // A subscriber connected from the start loses its connection after the third body frame.
    let contentFrameCount = 0;
    let droppedAtSeq = 0;

    const execution = await executeBaseQuery({
      queryQuestion: "Which regions earn the most?",
      token: "t",
      apiKey: "",
      userId: "user-1",
      enabledBranches: ["abc"],
      onEvent: (event) => {
        const frame = convertEventForFrontend(event);
        if (!frame) return;
        const stored = store.appendJson("run-1", frame)!;
        if (frame.type === "abc_content" && ++contentFrameCount === 3) droppedAtSeq = stored.seq;
      },
    });

    const finalContent = execution.output!.content;
    expect(finalContent).toContain(`| region-${ROWS.length - 1} |`);
    expect(finalContent).toContain("east leads.");

    const allFrames = subscribeFrom(store, "run-1", 0);
    const contentFrames = allFrames.filter(
      (frame) => (frame as { type: string }).type === "abc_content"
    ) as AbcContentEvent[];

    // Reasoning-only chunks produce no frames: only real text, structural steps and one rewrite.
    expect(contentFrames.length).toBeLessThan(20);
    // Besides the first frame, exactly the label rewrite after the large table is a full replace.
    const replaces = contentFrames.filter((frame) => frame.mode === "replace");
    expect(replaces).toHaveLength(2);
    expect(contentFrames[0]).toBe(replaces[0]);
    expect(replaces[1]!.mode === "replace" && replaces[1]!.content).toContain(
      `| region-${ROWS.length - 1} |`
    );
    // The large table goes out once as text, not once per conclusion chunk.
    const wireBytes = contentFrames.reduce(
      (sum, frame) => sum + (frame.mode === "append" ? frame.delta.length : frame.content.length),
      0
    );
    expect(wireBytes).toBeLessThan(finalContent.length * 3);
    // The live body is the final content up to the closing newline, which only the final result carries.
    const liveBody = finalContent.slice(0, -1);
    expect(liveBody).toContain('<strong class="ai-conclusion">');
    expect(bodyOf(allFrames)).toBe(liveBody);

    // Reconnecting with the last received id continues from there, without loss or duplication.
    const beforeDrop = allFrames.slice(0, droppedAtSeq);
    const resumed = subscribeFrom(store, "run-1", droppedAtSeq);
    expect(bodyOf(resumed, bodyOf(beforeDrop))).toBe(liveBody);
  });
});
