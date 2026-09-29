import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
  i18n: { global: { t: (key: string) => key } },
}));

import { finalizeSnapshotOnStop } from "../snapshot-helpers";
import type { ResponseSnapshot } from "../../types/chat";

/**
 * When the user stops a turn, in-progress thinking must settle into a final state.
 * The execution view reads the thinking state on the execution facts, so normalization must land on that copy;
 * normalizing only the snapshot's flat copy would leave the panel spinning in "running".
 */
const RUNNING = {
  summary: "querying",
  status: "running" as const,
  branches: [{ key: "abc", label: "ABC", status: "running" as const, logs: [] }],
};

describe("thinking state normalization when a turn is stopped", () => {
  it("lands on the execution facts the view actually reads", () => {
    const snapshot = {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "",
      thinkingState: RUNNING,
      execution: { thinkingState: RUNNING },
    } as unknown as ResponseSnapshot;

    const stopped = finalizeSnapshotOnStop(snapshot, { stoppedByUser: true });

    expect(stopped.execution?.thinkingState?.status).toBe("completed");
    expect(stopped.execution?.thinkingState?.branches?.[0].status).toBe("cancelled");
  });

  it("does not invent execution facts when there are none", () => {
    const snapshot = {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "",
    } as unknown as ResponseSnapshot;

    expect(finalizeSnapshotOnStop(snapshot).execution).toBeUndefined();
  });
});
