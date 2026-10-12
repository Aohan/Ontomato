import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../i18n";
import { appTextEn } from "../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../i18n/locales/en";
import type { AnalysisTaskRun } from "@ontomato/contracts/analysis-task";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";
import type { QueryThinkingState } from "@ontomato/contracts/query-thinking";
import { createDeepAnalysisArtifactStore } from "../artifacts";
import { getAnalysisTaskService } from "../task-service";

/** Real store into the real service; the only double is the pg boundary (in-memory
 * rows, a slow-database gate, a one-shot refusal, and a terminal-only refusal). */
type StoredRow = {
  status: string;
  history: AnalysisTaskRun[];
  payload: DeepAnalysisTaskPayload | null;
  updates: number;
};

const double = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  gate: null as Promise<void> | null,
  failNext: false,
  refuseTerminal: false,
  refusal: new Error("synthetic database refusal"),
}));

function assignedColumns(sql: string, params: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const setPart = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\$1/i)?.[1] ?? "";
  for (const part of setPart.split(",")) {
    const match = part.match(/(\w+)\s*=\s*\$(\d+)/);
    if (match) out[match[1]] = params[Number(match[2]) - 1];
  }
  return out;
}

// Only the columns the paths under test read back; transactions need no emulation
// because a rejected attribution path issues no UPDATE at all.
const sparseRow = (id: string, row: StoredRow) => ({
  id, status: row.status, analysis_payload: row.payload, created_at: 1, updated_at: 1, run_history: row.history,
});

vi.mock("../../../../infrastructure/postgres", () => ({
  qualifiedTable: (table: string) => `"${table}"`,
  getPostgresPool: () => ({
    query: async () => { throw new Error("unexpected direct pool query"); },
    connect: async () => ({
      release: () => {},
      query: async (sql: string, params: unknown[] = []) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/FOR UPDATE/i.test(sql)) {
          const row = double.rows.get(String(params[0]));
          // The attribution read sees run identity and status only, never stored snapshots.
          const meta = row?.history.map(({ id, requestSeq, status }) => ({ id, requestSeq, status }));
          return row
            ? { rows: [{ status: row.status, run_history: meta }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (/^\s*UPDATE/i.test(sql)) {
          const row = double.rows.get(String(params[0]));
          if (!row) return { rows: [], rowCount: 0 };
          const assigned = assignedColumns(sql, params);
          const incoming = assigned.analysis_payload
            ? (JSON.parse(assigned.analysis_payload as string) as DeepAnalysisTaskPayload)
            : null;
          if (incoming && double.refuseTerminal && incoming.runState.status !== "running")
            throw double.refusal;
          if (double.failNext) {
            double.failNext = false;
            throw double.refusal;
          }
          if (incoming) row.payload = incoming;
          if (assigned.status) row.status = assigned.status as string;
          // run_history = jsonb_set(run_history, ARRAY[$i::text], (run_history -> $i::int) || $patch::jsonb)
          const runPatch = sql.match(/run_history -> \$(\d+)::int\) \|\| \$(\d+)::jsonb/);
          if (runPatch) {
            const index = Number(params[Number(runPatch[1]) - 1]);
            row.history[index] = {
              ...row.history[index],
              ...JSON.parse(params[Number(runPatch[2]) - 1] as string),
            };
          }
          row.updates += 1;
          if (double.gate) await double.gate;
          return /RETURNING\s+\*/i.test(sql)
            ? { rows: [sparseRow(String(params[0]), row)], rowCount: 1 }
            : { rows: [], rowCount: 1 };
        }
        throw new Error("unexpected query in test");
      },
    }),
  }),
}));

vi.mock("../../../../infrastructure/harness-sessions", () => ({
  harnessSessions: { create: async () => {}, deleteSession: async () => {}, listMessages: async () => [], latestTurn: async () => null },
}));

const runningPayload = (sections: Array<[string, string]> = []): DeepAnalysisTaskPayload => ({
  executionMode: "loop",
  runState: { status: "running", revision: 5, progress: { done: 10, label: "" } },
  activities: [],
  sections: sections.map(([sectionId, markdown], order) => ({ sectionId, order, markdown, revision: order + 1 })),
  charts: [],
  chartDiagnostics: [],
});

const seed = (id: string, status: string, history: Array<[string, AnalysisTaskRun["status"]]>, payload: DeepAnalysisTaskPayload | null = null) => {
  double.rows.set(id, { status, history: history.map(([runId, runStatus]) => ({ id: runId, status: runStatus, startedAt: 1 })), payload, updates: 0 });
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const thought = (summary: string): QueryThinkingState => ({ summary, status: "running", branches: [] });
const md = (payload: DeepAnalysisTaskPayload, sectionId: string) =>
  payload.sections.find((s) => s.sectionId === sectionId)?.markdown ?? "";
const rowOf = (id: string): StoredRow => {
  const row = double.rows.get(id);
  if (!row) throw new Error(`missing row ${id}`);
  return row;
};
const landed = (id: string): DeepAnalysisTaskPayload => {
  const payload = rowOf(id).payload;
  if (!payload) throw new Error(`no payload for ${id}`);
  return payload;
};
const openStore = (taskId: string, runId: string, emit?: (event: DeepAnalysisEmittedEvent) => void) =>
  createDeepAnalysisArtifactStore({ taskId, identity: { runId }, requestSeq: 7, executionMode: "loop", emit });
const terminalRunState = (event: DeepAnalysisEmittedEvent) =>
  event.type === "analysis_run_state" && event.content.status !== "running";

describe("artifact persistence and run attribution", () => {
  beforeAll(() => {
    configureI18n({
      defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
      packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
    });
  });
  beforeEach(() => {
    double.rows.clear();
    double.gate = null;
    double.failNext = false;
    double.refuseTerminal = false;
  });

  it("coalesces intermediate snapshots while the database is slow, and finish lands the full cumulative body", async () => {
    const events: DeepAnalysisEmittedEvent[] = [];
    seed("task-bounded", "running", [["run-1", "running"]]);
    const store = openStore("task-bounded", "run-1", (event) => events.push(event));
    let release!: () => void;
    double.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const activityId = store.start("evidence", {
      questions: [{ questionId: "q1", question: "Q1", status: "running" }],
    });
    await tick();
    expect(rowOf("task-bounded").updates).toBe(1);
    for (let i = 0; i < 10; i += 1) {
      store.section({ sectionId: "report", markdown: `part-${i};`, mode: "append" });
      store.thinking({
        thinking: `t${i}`, mode: "replace", thinkingState: thought(`t${i}`), activityId, questionId: "q1",
      });
    }
    store.question(activityId, "q1", { status: "completed", execution: { thinkingState: thought("t9") } });
    store.section({ sectionId: "summary", markdown: "summary body", mode: "replace" });
    await tick();
    expect(rowOf("task-bounded").updates).toBe(1);
    release();
    double.gate = null;
    const finished = await store.finish("completed", undefined, "final answer");
    // Dozens of updates collapse into the in-flight write plus final writes.
    expect(rowOf("task-bounded").updates).toBeLessThanOrEqual(3);
    const final = landed("task-bounded");
    expect(final.runState.status).toBe("completed");
    expect(final.finalAnswer).toBe("final answer");
    expect(md(final, "report")).toBe(Array.from({ length: 10 }, (_, i) => `part-${i};`).join(""));
    expect(md(final, "summary")).toBe("summary body");
    const question = final.activities
      .find((a) => a.activityId === activityId)
      ?.questions?.find((q) => q.questionId === "q1");
    expect(question?.status).toBe("completed");
    expect(question?.execution?.thinkingState?.summary).toBe("t9");
    expect(finished.runState.status).toBe("completed");
    expect(events.filter(terminalRunState).length).toBe(1);
  });

  it("failed and cancelled finishes keep the cumulative sections and execution facts", async () => {
    for (const status of ["failed", "cancelled"] as const) {
      seed(`task-${status}`, "running", [[`run-${status}`, "running"]]);
      const store = openStore(`task-${status}`, `run-${status}`);
      const activityId = store.start("evidence", {
        questions: [{ questionId: "q1", question: "Q", status: "running" }],
      });
      store.section({ sectionId: "report", markdown: "kept body", mode: "append" });
      store.question(activityId, "q1", { execution: { thinkingState: thought("last thought") } });
      await store.finish(status, "stop reason");
      const final = landed(`task-${status}`);
      expect(final.runState.status).toBe(status);
      expect(final.runState.error).toBe("stop reason");
      expect(md(final, "report")).toBe("kept body");
      const question = final.activities
        .find((a) => a.activityId === activityId)
        ?.questions?.find((q) => q.questionId === "q1");
      expect(question?.execution?.thinkingState?.summary).toBe("last thought");
    }
  });

  it("an intermediate refusal is logged and retried content still lands on finish", async () => {
    seed("task-retry", "running", [["run-x", "running"]]);
    const store = openStore("task-retry", "run-x");
    double.failNext = true;
    store.section({ sectionId: "report", markdown: "first;", mode: "append" });
    await tick();
    store.section({ sectionId: "report", markdown: "second;", mode: "append" });
    const finished = await store.finish("completed");
    expect(finished.runState.status).toBe("completed");
    expect(md(landed("task-retry"), "report")).toBe("first;second;");
  });

  it("a refused final write rejects even though intermediate writes landed, and publishes no terminal state", async () => {
    const events: DeepAnalysisEmittedEvent[] = [];
    seed("task-final-refusal", "running", [["run-y", "running"]]);
    const store = openStore("task-final-refusal", "run-y", (event) => events.push(event));
    store.section({ sectionId: "report", markdown: "body;", mode: "append" });
    await tick();
    expect(landed("task-final-refusal").runState.status).toBe("running");
    double.refuseTerminal = true;
    await expect(store.finish("completed")).rejects.toThrow("synthetic database refusal");
    await tick();
    // The final snapshot never landed, so the row is still running and no terminal
    // run state reached subscribers: finish waited for the final write itself.
    expect(landed("task-final-refusal").runState.status).toBe("running");
    expect(events.filter(terminalRunState).length).toBe(0);
    // A sequential second finish after the refusal recovers in order.
    double.refuseTerminal = false;
    await store.finish("completed");
    expect(landed("task-final-refusal").runState.status).toBe("completed");
    expect(events.filter(terminalRunState).length).toBe(1);
  });

  it("the current run's intermediate write lands and resolves without a task row", async () => {
    const service = getAnalysisTaskService();
    const payload = runningPayload([["report", "draft"]]);
    seed("task-current", "running", [["task-current:run-a", "running"]]);
    await expect(
      service.updateTaskArtifacts("task-current", { analysisPayload: payload, requestSeq: 1 }, { runId: "task-current:run-a" })
    ).resolves.toBeUndefined();
    expect(rowOf("task-current").payload).toEqual(payload);
    expect(rowOf("task-current").status).toBe("running");
  });

  it("a superseded run touches no current facts, and its terminal write backfills only its own record", async () => {
    const service = getAnalysisTaskService();
    const current = runningPayload([["report", "new-run body"]]);
    seed("task-stale", "running", [["task-stale:old", "running"], ["task-stale:new", "running"]], current);
    const injected = runningPayload([["report", "new-run body"], ["injected", "old-run injection"]]);
    await service.updateTaskArtifacts("task-stale", { analysisPayload: injected, requestSeq: 1 }, { runId: "task-stale:old" });
    expect(rowOf("task-stale").payload).toEqual(current);
    expect(rowOf("task-stale").history.map((h) => h.status)).toEqual(["running", "running"]);
    const failed: DeepAnalysisTaskPayload = {
      ...runningPayload([["report", "old-run body"]]),
      runState: { status: "failed" as const, revision: 9, progress: { done: 0, label: "" }, error: "late" },
    };
    await service.updateTaskArtifacts("task-stale", { analysisPayload: failed, requestSeq: 1 }, { runId: "task-stale:old" });
    const row = rowOf("task-stale");
    expect(row.payload).toEqual(current);
    expect(row.status).toBe("running");
    expect(row.history[1]).toMatchObject({ id: "task-stale:new", status: "running" });
    expect(row.history[0]).toMatchObject({ id: "task-stale:old", status: "failed" });
    expect(row.history[0].snapshot).toBeDefined();
  });

  it("terminal states stay monotonic for the same run", async () => {
    const service = getAnalysisTaskService();
    seed("task-terminal", "completed", [["task-terminal:run-a", "completed"]]);
    await expect(
      service.updateTaskStatus("task-terminal", "failed", { identity: { runId: "task-terminal:run-a" } })
    ).resolves.toBeNull();
    expect(rowOf("task-terminal").status).toBe("completed");
    const rewritten = await service.updateTaskStatus("task-terminal", "completed", {
      resultSummary: "done again", identity: { runId: "task-terminal:run-a" },
    });
    expect(rewritten?.status).toBe("completed");
    expect(rowOf("task-terminal").status).toBe("completed");
  });
});
