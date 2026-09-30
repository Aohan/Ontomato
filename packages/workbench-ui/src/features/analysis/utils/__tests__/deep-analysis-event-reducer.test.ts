import { describe, expect, it, vi } from "vitest";
import type { AnalysisStreamEvent } from "@ontomato/contracts/analysis-events";
import { evidence } from "@ontomato/contracts/__tests__/presentation-fixtures";
import { reduceDeepAnalysisEvent } from "../deep-analysis-event-reducer";
import type { ResponseSnapshot } from "../../../../types/chat";

const reduce = (events: AnalysisStreamEvent[], initial: ResponseSnapshot | null = null) =>
  events.reduce((s, e) => reduceDeepAnalysisEvent(s, e), initial);
const activity = (content = evidence()): AnalysisStreamEvent => ({
  type: "analysis_activity",
  content,
  timestamp: content.revision,
});
const state = (
  revision: number,
  done: number,
  status: "running" | "completed" = "running"
): AnalysisStreamEvent => ({
  type: "analysis_run_state",
  executionMode: "dimension",
  content: { revision, status, progress: { done, total: 100, label: "gathering evidence" } },
  timestamp: revision,
});
const section = (
  revision: number,
  markdown: string,
  mode: "append" | "replace",
  offset = 0,
  status?: "success" | "failed"
): AnalysisStreamEvent => ({
  type: "analysis_section",
  timestamp: revision,
  content: { revision, markdown, mode, offset, sectionId: "d1", order: 0, status },
});

// Public surface under test: the page snapshot after reducing stream events; observable result: order, body, failure facts and final state.
describe("generic analysis event reducer", () => {
  it("upserts whole activities by identity in plan order and rejects late or duplicate snapshots", () => {
    const terminal = evidence({
      revision: 5,
      status: "completed",
      questions: [
        { questionId: "q1", question: "sales", status: "completed", dataCount: 2 },
        { questionId: "q2", question: "year over year", status: "failed", error: "unavailable" },
      ],
    });
    const snapshot = reduce([
      activity({ ...evidence(), activityId: "e2", seq: 3 }),
      activity(terminal),
      activity(),
      activity(terminal),
    ]);
    expect(snapshot?.deepAnalysis?.activities.map((a) => a.activityId)).toEqual([
      "evidence:d1",
      "e2",
    ]);
    expect(snapshot?.deepAnalysis?.activities[0]).toEqual(terminal);
    expect(snapshot?.deepAnalysis?.runState.status).toBe("running");
  });

  it("keeps server progress monotone across reordered events and freezes the run terminal", () => {
    const snapshot = reduce([
      state(5, 70),
      state(2, 20),
      state(6, 60),
      state(8, 100, "completed"),
      state(9, 75),
      activity(),
    ]);
    expect(snapshot?.deepAnalysis?.runState).toMatchObject({
      status: "completed",
      progress: { done: 100 },
    });
    expect(snapshot?.deepAnalysis?.activities).toEqual([]);
  });

  it("preserves partial failure and terminal report text across repeated appends and late drafts", () => {
    const snapshot = reduce([
      section(1, "X", "append"),
      section(1, "X", "append"),
      section(2, "Y", "append", 1),
      section(5, "XY", "replace", 0, "failed"),
      section(6, "late", "append", 2),
    ]);
    expect(snapshot?.deepAnalysis?.sections).toEqual([
      expect.objectContaining({ sectionId: "d1", markdown: "XY", status: "failed" }),
    ]);
  });

  it("recovers a missing append and loop reorder from the authoritative section replacement", () => {
    const snapshot = reduce([
      section(3, "back", "append", 4),
      section(2, "front ", "append"),
      section(4, "front back", "replace", 0, "success"),
    ]);
    expect(snapshot?.deepAnalysis?.sections[0].markdown).toBe("front back");
  });

  it("locates query thinking by activity and question, while preserving the other question", () => {
    const thinkingState = { summary: "querying data", status: "running" as const, branches: [] };
    const snapshot = reduce([
      activity(),
      {
        type: "thinking_state",
        node: "analysis",
        content: {
          activityId: "evidence:d1",
          questionId: "q1",
          thinkingState,
          thinking: thinkingState.summary,
          mode: "replace",
        },
        timestamp: 3,
      },
    ]);
    expect(snapshot?.deepAnalysis?.activities[0].questions?.[0].execution?.thinkingState).toEqual(
      thinkingState
    );
    expect(snapshot?.deepAnalysis?.activities[0].questions?.[1].execution).toBeUndefined();
  });

  it("deduplicates chart diagnostics and leaves cancellation of activities to the server", () => {
    const chartEvent: AnalysisStreamEvent = {
      type: "analysis_charts",
      timestamp: 1,
      content: {
        scopeId: "d1",
        charts: [],
        diagnostics: [
          { scopeId: "d1", reason: "no_viable_plan", message: "unavailable", severity: "info" },
        ],
      },
    };
    const snapshot = reduce([
      activity(),
      chartEvent,
      chartEvent,
      { type: "task_cancelled", taskId: "t", timestamp: 2 },
    ]);
    expect(snapshot?.deepAnalysis?.chartDiagnostics).toHaveLength(1);
    expect(snapshot?.deepAnalysis?.runState.status).toBe("cancelled");
    expect(snapshot?.deepAnalysis?.activities[0].status).toBe("running");
  });

  it("rejects malformed activities and unknown events at the stream boundary", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      reduceDeepAnalysisEvent(null, {
        type: "analysis_activity",
        content: {},
      } as AnalysisStreamEvent)
    ).toBeNull();
    expect(
      reduceDeepAnalysisEvent(null, { type: "analysis_unknown" } as unknown as AnalysisStreamEvent)
    ).toBeNull();
    warn.mockRestore();
  });
});
