import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { applyAbcContent, type AbcContentEvent } from "@ontomato/contracts/chat";
import {
  answerBodyText,
  splitAnswerBody,
  type QueryDatasetIdentity,
  type QueryExecutionDisplayFact,
} from "@ontomato/contracts/query-execution";

import { RunStreamStore } from "../run-stream";
import { configureI18n, getConclusionPrefix } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchProduct } from "../../../product/installed";
import type { WorkbenchProduct } from "../../../product/types";
import type { UpsertQueryRunInput, QueryRun } from "../../../services/data-query/query-run-store";

/**
 * Dataset ids and the body placements that refer to them, from the real producers (traditional ABC,
 * Harness, analysis replay merge) through the wire projection, the run's replayable event log, the
 * saved query run and its history read. Backend responses and models are scripted; rows are synthetic.
 */

type Chunk = { problem: string; rows: Record<string, unknown>[] };
type DisplayFact = Omit<QueryExecutionDisplayFact, "datasets"> & { datasets: QueryDatasetIdentity[] };

let splitQuestions: string[] = [];
let dataChunks: Chunk[] = [];
let harnessEvents: unknown[] = [];
let hotCards: Array<{ atomicAsk: string; url: string; rows: Record<string, unknown>[] }> = [];
let abcMode = "tool_fixed";
const modelStreams: string[][] = [];
const savedRuns: UpsertQueryRunInput[] = [];

vi.mock("../../../config/model-factory", () => ({
  createModel: async () => ({
    invoke: async () => {
      throw new Error("field plan model unavailable in test");
    },
    stream: async () => {
      const texts = modelStreams.shift()!;
      return (async function* () {
        for (const text of texts) yield { content: text };
      })();
    },
  }),
}));

vi.mock("../../../services/data-query/client", () => ({
  streamQuestionSplit: async function* () {
    for (const subQuestion of splitQuestions) yield { subQuestion: { subQuestion } };
    yield { sessionId: "session-1" };
  },
  streamDataChunks: async function* () {
    for (const chunk of dataChunks) {
      yield { source: "stream", data: [{ answer: chunk.rows, problem: chunk.problem }] };
    }
  },
}));

vi.mock("../../../services/data-query/sse-transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/data-query/sse-transport")>()),
  streamBackendSSE: async function* () {
    yield* harnessEvents;
  },
}));

vi.mock("../../../services/data-query/query-run-store", () => ({
  startQueryRun: async () => undefined,
  updateQueryRunBackendSessions: async () => undefined,
  upsertQueryRun: async (input: UpsertQueryRunInput) => {
    savedRuns.push(input);
  },
}));

vi.mock("../../../services/data-query/late-fact", () => ({ startQualityCheckSettlement: async () => undefined }));

vi.mock("../../../services/data-query/base-query-executor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/data-query/base-query-executor")>()),
  STANDARD_QUERY_BRANCHES: ["abc"],
}));

vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "prompt" }));
vi.mock("../../../logging/model-agents", () => ({ modelAgentName: (role: string) => role }));
vi.mock("../../../services/data-query/data-query-policy", () => ({
  getAbcQuestionMode: () => abcMode,
  getQueryTimeoutMs: () => 60_000,
}));

const hotDocs = () =>
  hotCards.map((card) => ({ md: `Card ${card.atomicAsk}`, url: card.url }));
const hotVerdict = async () => ({
  sufficient: true,
  cards: hotCards.map(({ atomicAsk, url }) => ({ atomicAsk, url })),
});

vi.mock("../../../services/data-query/hot-data/hot-data-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/data-query/hot-data/hot-data-utils")>()),
  streamDocuments: async () => ({ items: hotDocs() }),
  findDocuments: async () => hotDocs(),
}));
vi.mock("../../../services/data-query/hot-data/hot-data-dynamic", () => ({
  judgeAndAnswerByDocs: hotVerdict,
}));
vi.mock("../../../services/data-query/hot-data/hot-data-static", () => ({
  judgeAndAnswerByStaticDocs: hotVerdict,
}));

vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/backend-client")>()),
  backendGet: async (_endpoint: string, url: string) => {
    const card = hotCards.find((item) => item.url === url)!;
    return {
      text: JSON.stringify({
        data: { answer: card.rows },
        abcProgram: { title: card.atomicAsk, code: "code", outKeyRefs: [{ key: "k" }], parameters: [] },
      }),
    };
  },
  backendPost: async (_endpoint: string, _url: string, body: { code: string }) => ({
    headers: new Headers({ "content-type": "application/json" }),
    text: JSON.stringify({ success: true, data: [{ entity: body.code, value: 1 }] }),
  }),
}));

const rows = (count: number, columns: string[]) =>
  Array.from({ length: count }, (_, index) =>
    Object.fromEntries(columns.map((column) => [column, `${column}-${index}`]))
  );

function subscribeFrom(store: RunStreamStore, runId: string, lastEventId: number) {
  const frames: Array<{ type: string } & Record<string, unknown>> = [];
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

const contentFrames = (frames: Array<{ type: string }>) =>
  frames.filter((frame): frame is AbcContentEvent => frame.type === "abc_content");

const placedIds = (body: string) =>
  splitAnswerBody(body).flatMap((piece) => (piece.kind === "dataset" ? [piece.datasetId] : []));

/** The text right before each placement, so a test can check which result it follows. */
const textBeforePlacements = (body: string) => {
  const pieces = splitAnswerBody(body);
  return pieces.flatMap((piece, index) =>
    piece.kind === "dataset" ? [(pieces[index - 1] as { text: string }).text] : []
  );
};

beforeAll(() => {
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
});

beforeEach(() => {
  savedRuns.length = 0;
  modelStreams.length = 0;
  abcMode = "tool_fixed";
});

describe("dataset placements from the standard query to history", () => {
  it("places each of three results after its own table, conclusion last, identical live, replayed and in history", async () => {
    // The shape of the real sample: two 6380-row results and one 41-row post-calculation.
    splitQuestions = ["Revenue by entity", "Cash flow by entity", "Entities with growth"];
    dataChunks = [
      { problem: "Revenue by entity", rows: rows(6380, ["period", "org_code", "org_name", "value_number"]) },
      { problem: "Cash flow by entity", rows: rows(6380, ["period", "org_code", "org_name", "cash_flow"]) },
      { problem: "Entities with growth", rows: rows(41, ["org_code", "org_name"]) },
    ];
    const prefix = getConclusionPrefix(undefined);
    modelStreams.push(
      ["Revenue description."],
      ["Cash flow description."],
      ["Growth description."],
      [prefix, "\n\n| Summary | Count |\n| --- | --- |\n| entities | 41 |\n"]
    );

    const { queryNode } = await import("../../../services/chat/graph/nodes/query-node");
    const { convertEventForFrontend } = await import("../../../services/chat/event-projection");
    const { toQueryExecutionFact, toDisplayFact } = await import("../../../services/data-query/query-fact");

    const store = new RunStreamStore();
    store.startRun({ runId: "run-1", key: "k", userId: "user-1", domainId: "domain-1" });
    let contentFrameCount = 0;
    let droppedAtSeq = 0;
    const onEvent = (event: unknown) => {
      const frame = convertEventForFrontend(event as never);
      if (!frame) return;
      const stored = store.appendJson("run-1", frame)!;
      if (frame.type === "abc_content" && ++contentFrameCount === 5) droppedAtSeq = stored.seq;
    };

    await queryNode(
      { threadId: "thread-1", userQuestion: "Which entities grew revenue?" } as never,
      { configurable: { onEvent, thread_id: "thread-1", requestSeq: 0, locale: "en" } }
    );

    const frames = subscribeFrom(store, "run-1", 0);
    const result = frames.find((frame) => frame.type === "result") as unknown as {
      content: { execution: DisplayFact };
    };
    const live = result.content.execution;
    const ids = live.datasets.map((dataset) => dataset.id);
    expect(new Set(ids).size).toBe(3);

    // Each result's sub-question and table come right before its own placement, the conclusion after all.
    const body = live.fullContent!;
    expect(placedIds(body)).toEqual(ids);
    const before = textBeforePlacements(body);
    expect(before[0]).toContain("Revenue by entity");
    expect(before[0]).toContain("| org_code-9 |");
    expect(before[1]).toContain("Cash flow by entity");
    expect(before[2]).toContain("Entities with growth");
    const afterLast = body.slice(body.lastIndexOf("query-dataset:"));
    expect(afterLast).toContain('<strong class="ai-conclusion">');

    // Live datasets carry the same ids as the final facts, sent after the body that places them.
    const datasetFrames = frames.filter((frame) => frame.type === "query_datasets") as unknown as Array<{
      datasets: Array<{ id: string }>;
    }>;
    expect(datasetFrames.at(-1)!.datasets.map((dataset) => dataset.id)).toEqual(ids);

    // Every body the browser can hold between frames has only whole placements.
    let partial = "";
    for (const frame of contentFrames(frames)) {
      partial = applyAbcContent(partial, frame);
      expect(answerBodyText(partial)).not.toContain("<!--");
    }
    // The live body is the final body; only the final result may add a closing newline.
    expect(partial.trimEnd()).toBe(body.trimEnd());

    // Reconnecting after a dropped connection continues to the same body.
    const resumed = subscribeFrom(store, "run-1", droppedAtSeq);
    const head = contentFrames(frames.slice(0, droppedAtSeq)).reduce(applyAbcContent, "");
    expect(contentFrames(resumed).reduce(applyAbcContent, head)).toBe(partial);

    // The saved run keeps the body with placements and the dataset ids; the result table is plain text.
    const saved = savedRuns.at(-1)!;
    expect(saved.fullContent).toBe(body);
    expect(saved.markdownTable).toBe(answerBodyText(body));
    const run = { id: "run", ...JSON.parse(JSON.stringify(saved)) } as QueryRun;
    const history = toDisplayFact(toQueryExecutionFact(run)) as DisplayFact;
    expect(history.fullContent).toBe(body);
    expect(history.datasets.map((dataset) => dataset.id)).toEqual(ids);
  });

  it("places zero-row, no-displayable-field and same-name results each in place", async () => {
    splitQuestions = ["Sales"];
    dataChunks = [
      { problem: "Sales by region", rows: [{ region: "east", amount: 1 }] },
      { problem: "Sales by region", rows: [{ region: "west", amount: 2 }] },
      { problem: "Returns", rows: [] },
      { problem: "Blank fields", rows: [{ note: "" }, { note: null }] },
    ];
    modelStreams.push(["Sales description."], ["Conclusion text."]);

    const { executeBaseQuery } = await import("../../../services/data-query/base-query-executor");
    const execution = await executeBaseQuery({
      queryQuestion: "Sales?",
      token: "t",
      apiKey: "",
      userId: "user-1",
      enabledBranches: ["abc"],
    });

    const { content, datasets } = execution.output!;
    expect(datasets.map((dataset) => dataset.data.length)).toEqual([1, 1, 0, 2]);
    expect(placedIds(content)).toEqual(datasets.map((dataset) => dataset.id));
    const before = textBeforePlacements(content);
    expect(before[0]).toContain("| east |");
    expect(before[1]).toContain("| west |");
    const empty = en["query.display.empty"] as string;
    // Zero rows and rows without a displayable field both show the adapter's empty state, in place.
    expect(before[2]).toContain("Returns");
    expect(before[2].trimEnd().endsWith(empty)).toBe(true);
    expect(before[3]).toContain("Blank fields");
    expect(before[3].trimEnd().endsWith(empty)).toBe(true);
  });

  it("places Harness program data in the model's data section, ahead of its conclusion", async () => {
    abcMode = "harness";
    harnessEvents = [
      { sessionId: "session-h" },
      { type: "DATA_TYPE", content: { question: "Revenue", data: [{ org: "a", value: 1 }], code: "c1", outKeyRefs: [] } },
      { type: "DATA_TYPE", content: { question: "Revenue", data: [], code: "c2", outKeyRefs: [] } },
    ];
    modelStreams.push(["## Scope\n\nAll entities.\n\n<!-- DATA_TABLES -->\n\n## Conclusion\n\nDone."]);

    const { executeBaseQuery } = await import("../../../services/data-query/base-query-executor");
    const execution = await executeBaseQuery({
      queryQuestion: "Revenue?",
      token: "t",
      apiKey: "",
      userId: "user-1",
      enabledBranches: ["abc"],
      abcQuestionMode: "harness",
    });

    const { content, datasets, abcCodes } = execution.output!;
    expect(abcCodes).toEqual(["c1", "c2"]);
    expect(placedIds(content)).toEqual(datasets.map((dataset) => dataset.id));
    expect(textBeforePlacements(content)[0]).toContain("| a |");
    expect(content.indexOf("## Conclusion")).toBeGreaterThan(content.lastIndexOf("query-dataset:"));
  });
});

describe("dataset placements from hot and static data cards", () => {
  for (const branch of ["hot", "static"] as const) {
    it(`${branch}: names a single card's sub-question once, ahead of its table and placement`, async () => {
      hotCards = [{ atomicAsk: "Revenue by region", url: "https://cards/1", rows: [{ region: "east" }] }];
      modelStreams.push(["Conclusion text."]);
      const { executeBaseQuery } = await import("../../../services/data-query/base-query-executor");

      const { content, datasets } = (
        await executeBaseQuery({
          queryQuestion: "Revenue?",
          token: "t",
          apiKey: "",
          userId: "user-1",
          enabledBranches: [branch],
        })
      ).output!;

      expect(placedIds(content)).toEqual(datasets.map((dataset) => dataset.id));
      const [before] = textBeforePlacements(content);
      expect(before).toContain("<strong>Revenue by region</strong>");
      expect(before.indexOf("Revenue by region")).toBeLessThan(before.indexOf("| east |"));
      expect(content.split("Revenue by region")).toHaveLength(2);
    });

    it(`${branch}: names each of several cards, an empty card included`, async () => {
      hotCards = [
        { atomicAsk: "Revenue by region", url: "https://cards/1", rows: [{ region: "east" }] },
        { atomicAsk: "Returns by region", url: "https://cards/2", rows: [] },
      ];
      modelStreams.push(["Conclusion text."]);
      const { executeBaseQuery } = await import("../../../services/data-query/base-query-executor");

      const { content, datasets } = (
        await executeBaseQuery({
          queryQuestion: "Revenue?",
          token: "t",
          apiKey: "",
          userId: "user-1",
          enabledBranches: [branch],
        })
      ).output!;

      expect(placedIds(content)).toEqual(datasets.map((dataset) => dataset.id));
      const [first, second] = textBeforePlacements(content);
      expect(first).toContain("<strong>Revenue by region</strong>");
      expect(second).toContain("<strong>Returns by region</strong>");
      expect(second!.trimEnd().endsWith(en["query.display.empty"] as string)).toBe(true);
    });
  }
});

describe("dataset placements in the analysis replay merge", () => {
  it("keeps each sub-result's own dataset id, without renumbering", async () => {
    const { config } = await import("../../../config/application");
    config.dataQuery.baseUrl = "http://data-engine";
    const { executeSavedAbcReplay } = await import(
      "../../../services/analysis-agent/dimension/abc-replay"
    );

    const result = await executeSavedAbcReplay({
      savedAbcTrace: { abcCodes: ["program-a", "program-b"], abcOutKeyRefs: [[], []] },
      question: {
        id: "q1",
        dimensionId: "d1",
        dimensionName: "Region",
        dimensionValue: "east",
        subQuestion: "Revenue",
      },
      executeDsl: async () => {
        throw new Error("not used");
      },
      signal: new AbortController().signal,
    } as never);

    const ids = result.datasets!.map((dataset) => dataset.id);
    expect(new Set(ids).size).toBe(2);
    expect(placedIds(result.fullContent!)).toEqual(ids);
    const before = textBeforePlacements(result.fullContent!);
    expect(before[0]).toContain("Revenue - 1");
    expect(before[0]).toContain("program-a");
    expect(before[1]).toContain("Revenue - 2");
    expect(result.markdownTable).toBe(answerBodyText(result.fullContent!));
  });
});
