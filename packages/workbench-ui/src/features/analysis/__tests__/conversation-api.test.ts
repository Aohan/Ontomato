import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analysisTaskApi, streamTaskExecution } from "../api";
const request = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/api")>()),
  nodeApiGet: (...args: unknown[]) => request.get(...args),
  nodeApiPost: (...args: unknown[]) => request.post(...args),
}));
import { installAuthHost } from "../../../utils/auth";

installAuthHost({
  getToken: () => "",
  getApiKey: () => "",
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
  getUserInfo: () => null,
  responseStatusError: () => null,
});

class TestEventSource {
  static CLOSED = 2;
  static instances: TestEventSource[] = [];
  onmessage?: (event: { data: string; lastEventId: string }) => void;
  onerror?: () => void;
  onopen?: () => void;
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(readonly url: string) {
    TestEventSource.instances.push(this);
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event), lastEventId: "1" });
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversation REST and SSE boundary", () => {
  it("accepts the durable turn payload and rejects malformed history instead of showing an empty conversation", async () => {
    const turn = {
      requestSeq: 2,
      userMessage: "Submit these rows",
      status: "completed",
      messages: [
        {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "orders_submit",
          content: [{ type: "text", text: "Order 73 accepted" }],
        },
      ],
      activities: [],
      charts: [],
      chartDiagnostics: [],
      finalAnswer: "Done",
      createdAt: 1,
      updatedAt: 2,
    };
    request.get.mockResolvedValueOnce({ turns: [turn] });
    expect(await analysisTaskApi.getTurns("conversation")).toEqual([turn]);
    request.get.mockResolvedValueOnce({
      turns: [
        {
          ...turn,
          messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "private" }] }],
        },
      ],
    });
    await expect(analysisTaskApi.getTurns("conversation")).rejects.toThrow();
    request.post.mockResolvedValueOnce({
      taskId: "conversation",
      requestSeq: 3,
      status: "running",
    });
    expect(await analysisTaskApi.continueConversation("conversation", "Next")).toEqual({
      taskId: "conversation",
      requestSeq: 3,
      status: "running",
    });
    expect(request.post).toHaveBeenCalledWith("/analysis-tasks/conversation/turns", {
      message: "Next",
    });
  });

  it("keeps normal conversation pagination separate from saved report tasks", async () => {
    request.get.mockResolvedValueOnce({
      tasks: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    await analysisTaskApi.listTaskPage({
      agentId: "changed-agent",
      reportDeliverableEnabled: false,
      limit: 50,
      offset: 0,
    });
    const query = new URL(request.get.mock.calls[0][0], "http://localhost").searchParams;
    expect(query.get("reportDeliverableEnabled")).toBe("false");
    expect(query.get("agentId")).toBe("changed-agent");
  });

  it("ignores older terminal replay before closing the current turn, and detach ignores late events", () => {
    const onEvent = vi.fn();
    const onComplete = vi.fn();
    const close = streamTaskExecution("conversation", { requestSeq: 3, onEvent, onComplete });
    const source = TestEventSource.instances[0];
    expect(new URL(source.url, "http://localhost").searchParams.get("requestSeq")).toBe("3");
    source.emit({ type: "task_completed", requestSeq: 2 });
    expect(source.close).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    source.emit({ type: "analysis_loop_activity", requestSeq: 3, content: { activityId: "a" } });
    expect(onEvent).toHaveBeenCalledOnce();
    source.emit({ type: "task_completed", requestSeq: 3 });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalledOnce();
    close();
    source.emit({ type: "analysis_loop_activity", requestSeq: 3, content: { activityId: "late" } });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
