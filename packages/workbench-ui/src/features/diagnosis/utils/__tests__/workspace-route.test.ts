import { describe, expect, it } from "vitest";
import {
  buildTurnDiagnoseRoute,
  isTurnCollectRequested,
  isTurnDiagnoseRequested,
  TURN_COLLECT_QUERY_VALUE,
  TURN_DIAGNOSE_QUERY_VALUE,
} from "../workspace-route";

describe("workspace route helpers", () => {
  it("marks chat Turn diagnosis as collection followed by diagnosis", () => {
    expect(buildTurnDiagnoseRoute("turn.thread.1")).toEqual({
      name: "ObserveTurnDetail",
      params: { turnKey: "turn.thread.1" },
      query: {
        collect: TURN_COLLECT_QUERY_VALUE,
        diagnose: TURN_DIAGNOSE_QUERY_VALUE,
      },
    });
  });

  it("detects collection requests from route query values", () => {
    expect(isTurnCollectRequested("1")).toBe(true);
    expect(isTurnCollectRequested("true")).toBe(true);
    expect(isTurnCollectRequested(undefined)).toBe(false);
    expect(isTurnCollectRequested("0")).toBe(false);
  });

  it("detects diagnosis requests from route query values", () => {
    expect(isTurnDiagnoseRequested("1")).toBe(true);
    expect(isTurnDiagnoseRequested("true")).toBe(true);
    expect(isTurnDiagnoseRequested(undefined)).toBe(false);
    expect(isTurnDiagnoseRequested("0")).toBe(false);
  });
});
