import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";
import type { Message, ResponseSnapshot } from "../../../types/chat";

import { createStandardSender } from "../composables/useStandardStream";
import { installAuthHost } from "../../../utils/auth";

// 原用例替身化企业认证模块；共享代码现经应用宿主取凭据，这里装入同样的替身。
const host = {
  getApiKey: vi.fn((): string | null => null),
  getToken: vi.fn((): string | null => "token-1"),
  verifySessionOnce: vi.fn(async () => "valid" as const),
  handleAuthExpired: vi.fn(),
  getUserInfo: () => null,
  responseStatusError: () => null,
};
installAuthHost(host);
const { getToken, handleAuthExpired } = host;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null = null;
  onerror: (() => void | Promise<void>) | null = null;
  closed = false;
  private listeners = new Map<string, Array<() => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    for (const listener of this.listeners.get("open") || []) listener();
  }

  async emitMessage(data: string, lastEventId = "") {
    await this.onmessage?.({ data, lastEventId } as MessageEvent);
  }
}

function makeSender() {
  const messages = ref<Message[]>([{ id: 1, role: "user", content: "问题" }]);
  const isLoading = ref(false);
  const stopRequested = ref(false);
  const streamingSnapshot = ref<ResponseSnapshot | null>(null);
  const currentThreadId = ref("thread-1");
  const currentThreadTitle = ref("问题");
  const currentEventSource = shallowRef<EventSource | null>(null);

  const updateStreamingSnapshot = (patch: Partial<ResponseSnapshot>) => {
    const base: ResponseSnapshot = streamingSnapshot.value || {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "",
      executionSteps: [],
    };
    const next = { ...base, ...patch } as ResponseSnapshot;
    streamingSnapshot.value = next;
    const last = messages.value[messages.value.length - 1];
    if (last?.role === "assistant" && last.snapshot?.status === "streaming") {
      messages.value[messages.value.length - 1] = { ...last, snapshot: next };
    }
  };

  const sender = createStandardSender({
    messages,
    tailRevision: ref(0),
    isLoading,
    stopRequested,
    streamingSnapshot,
    currentThreadId,
    currentThreadTitle,
    currentEventSource,
    updateStreamingSnapshot,
    resetStreamingState: () => {
      streamingSnapshot.value = null;
    },
    clearCurrentEventSource: () => {
      currentEventSource.value?.close();
      currentEventSource.value = null;
    },
    addOrUpdateExecutionStep: vi.fn(),
    hasSettledTitle: ref(true),
  });

  return { sender, messages, isLoading, currentThreadId, currentEventSource };
}

describe("standard stream resume", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("token-1");
    vi.mocked(handleAuthExpired).mockClear();
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: FakeEventSource,
    });
  });

  it("ignores data and auth failures from the previous credential's stream", async () => {
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    vi.mocked(getToken).mockReturnValue("token-2");
    await source.emitMessage(JSON.stringify({ type: "token", content: "old-domain-data" }));
    await source.emitMessage(JSON.stringify({ type: "auth_failed" }));
    expect(messages.value[1]?.snapshot?.primaryText).not.toContain("old-domain-data");
    expect(handleAuthExpired).not.toHaveBeenCalled();
  });

  it("connects without a cursor and falls back to database history when no run is active", async () => {
    const { sender, messages } = makeSender();
    const onRunNotFound = vi.fn();

    await sender.resumeStandardMessage({
      threadId: "thread-1",
      requestSeq: 0,
      token: "token-1",
      onRunNotFound,
    });
    const source = FakeEventSource.instances[0]!;

    await source.emitMessage(JSON.stringify({ type: "run_not_found" }));
    await source.emitMessage(JSON.stringify({ type: "run_not_found" }));

    expect(onRunNotFound).toHaveBeenCalledOnce();
    expect(messages.value).toEqual([{ id: 1, role: "user", content: "问题" }]);
  });

  it("replays the same run into a streaming snapshot and ignores stale thread events", async () => {
    const { sender, messages, currentThreadId } = makeSender();

    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();

    await source.emitMessage(
      JSON.stringify({
        type: "run_started",
        runId: "run-1",
        threadId: "thread-1",
        requestSeq: 0,
      }),
      "1"
    );
    await source.emitMessage(JSON.stringify({ type: "token", content: "答案" }), "2");

    expect(messages.value[1]?.snapshot).toMatchObject({
      runId: "run-1",
      requestSeq: 0,
      primaryText: "答案",
      status: "streaming",
    });

    currentThreadId.value = "thread-2";
    await source.emitMessage(JSON.stringify({ type: "token", content: "不应出现" }), "3");
    expect(messages.value[1]?.snapshot?.primaryText).toBe("答案");
  });

  it("keeps partial content when the run fails after producing results", async () => {
    // 与 response-node 的部分失败快照同规则：直播收到错误时已有部分结果，
    // 只标记失败并保留正文与执行事实，不把错误说明盖掉部分内容。
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();

    await source.emitMessage(
      JSON.stringify({
        type: "result",
        content: {
          markdownTable: "部分表格",
          execution: { fullContent: "部分表格", dataCount: 1, error: "boom" },
        },
      })
    );
    await source.emitMessage(JSON.stringify({ type: "error", error: "boom" }));

    expect(messages.value[1]?.snapshot).toMatchObject({
      mode: "standard",
      status: "failed",
      primaryText: "部分表格",
    });
    expect(messages.value[1]?.snapshot?.execution).toMatchObject({ fullContent: "部分表格" });
  });

  it("merges execution-only results so failure facts stay visible", async () => {
    // 连部分正文都没有的失败：result 事件只带执行事实（思考与错误），
    // 直播照样收下，与历史读到同一份失败说明。
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();

    await source.emitMessage(
      JSON.stringify({
        type: "result",
        content: { execution: { thinkingSummary: "已拆解", error: "查询超时" } },
      })
    );

    expect(messages.value[1]?.snapshot?.execution).toMatchObject({
      thinkingSummary: "已拆解",
      error: "查询超时",
    });
  });

  it("stores the full error reason on the error page and leaves truncation to rendering", async () => {
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();
    const reason = `ABC 拆解：${"后端返回的完整失败原因".repeat(20)}；动态指标热数据：召回失败`;

    await source.emitMessage(JSON.stringify({ type: "error", error: reason }));

    expect(messages.value[1]?.snapshot).toMatchObject({ mode: "error", status: "failed" });
    expect(messages.value[1]?.snapshot?.primaryText).toContain(reason);
  });

  it.each([false, true])(
    "shows errors without query failure facts (prior result: %s)",
    async (hasPriorResult) => {
      const { sender, messages } = makeSender();
      await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
      const source = FakeEventSource.instances[0]!;
      source.emitOpen();

      if (hasPriorResult) {
        await source.emitMessage(
          JSON.stringify({
            type: "result",
            content: { markdownTable: "已完成的查询", execution: { fullContent: "已完成的查询" } },
          })
        );
      }
      await source.emitMessage(JSON.stringify({ type: "error", error: "boom" }));

      expect(messages.value[1]?.snapshot).toMatchObject({
        mode: "error",
        status: "failed",
      });
      expect(messages.value[1]?.snapshot?.primaryText).toContain("boom");
    }
  );
});
