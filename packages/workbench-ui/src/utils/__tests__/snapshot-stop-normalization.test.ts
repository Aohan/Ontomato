import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
  i18n: { global: { t: (key: string) => key } },
}));

import { finalizeSnapshotOnStop } from "../snapshot-helpers";
import type { ResponseSnapshot } from "../../types/chat";

/**
 * 用户停止回合时，进行中的思考必须收口为终态。
 * 执行展示视图读的是执行事实上的思考状态，因此归一必须落到那一份上——
 * 只归一快照的扁平副本会让面板停在"运行中"一直转。
 */
const RUNNING = {
  summary: "查询中",
  status: "running" as const,
  branches: [{ key: "abc", label: "ABC", status: "running" as const, logs: [] }],
};

describe("停止回合的思考状态归一", () => {
  it("落到视图实际读取的那一份执行事实上", () => {
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

  it("没有执行事实时不凭空造一份", () => {
    const snapshot = {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "",
    } as unknown as ResponseSnapshot;

    expect(finalizeSnapshotOnStop(snapshot).execution).toBeUndefined();
  });
});
