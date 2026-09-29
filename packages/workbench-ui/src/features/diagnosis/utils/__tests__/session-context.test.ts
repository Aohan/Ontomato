import { describe, expect, it } from "vitest";
import { sessionContextFromSession, sessionContextLabel } from "../session-context";

describe("session context helpers", () => {
  it("labels the selected session context instead of the current route", () => {
    expect(
      sessionContextLabel({
        id: "s1",
        createdAt: "2026-09-07T00:00:00.000Z",
        title: "General page history",
        context: { page: "general" },
        responseStatus: "idle",
      })
    ).toBe("General");
    expect(
      sessionContextLabel({
        id: "s2",
        createdAt: "2026-09-07T00:00:00.000Z",
        title: "Turn history",
        context: { page: "observe", targetKey: "turn.dGhyZWFkLTE.0" },
        responseStatus: "idle",
      })
    ).toBe("Turn: turn.dGhyZWFkLTE.0");
  });

  it("does not infer legacy runId fields when context is missing", () => {
    const legacy = {
      id: "legacy-run",
      createdAt: "2026-09-07T00:00:00.000Z",
      title: "Old test",
      responseStatus: "idle" as const,
      runId: "run-old",
    };

    expect(sessionContextFromSession(legacy)).toBeUndefined();
  });
});
