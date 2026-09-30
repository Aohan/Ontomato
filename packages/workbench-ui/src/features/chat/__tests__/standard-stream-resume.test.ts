import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";
import type { Message, ResponseSnapshot } from "../../../types/chat";

import { createStandardSender } from "../composables/useStandardStream";
import { installAuthHost } from "../../../utils/auth";

// The original test doubled the auth module; shared code now gets credentials from the app host, so the same double is installed here.
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
  const messages = ref<Message[]>([{ id: 1, role: "user", content: "question" }]);
  const isLoading = ref(false);
  const stopRequested = ref(false);
  const streamingSnapshot = ref<ResponseSnapshot | null>(null);
  const currentThreadId = ref("thread-1");
  const currentThreadTitle = ref("question");
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
    expect(messages.value).toEqual([{ id: 1, role: "user", content: "question" }]);
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
    await source.emitMessage(JSON.stringify({ type: "token", content: "answer" }), "2");

    expect(messages.value[1]?.snapshot).toMatchObject({
      runId: "run-1",
      requestSeq: 0,
      primaryText: "answer",
      status: "streaming",
    });

    currentThreadId.value = "thread-2";
    await source.emitMessage(JSON.stringify({ type: "token", content: "must not appear" }), "3");
    expect(messages.value[1]?.snapshot?.primaryText).toBe("answer");
  });

  it("keeps partial content when the run fails after producing results", async () => {
    // Same rule as response-node partial failure snapshots: when the live stream receives an error after partial results,
    // it only marks failure and keeps the body and execution facts instead of overwriting the partial content with the error.
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();

    await source.emitMessage(
      JSON.stringify({
        type: "result",
        content: {
          markdownTable: "partial table",
          execution: { fullContent: "partial table", dataCount: 1, error: "boom" },
        },
      })
    );
    await source.emitMessage(JSON.stringify({ type: "error", error: "boom" }));

    expect(messages.value[1]?.snapshot).toMatchObject({
      mode: "standard",
      status: "failed",
      primaryText: "partial table",
    });
    expect(messages.value[1]?.snapshot?.execution).toMatchObject({ fullContent: "partial table" });
  });

  it("merges execution-only results so failure facts stay visible", async () => {
    // A failure without even a partial body: the result event carries only execution facts (thinking and error);
    // the live stream still accepts it and shows the same failure explanation as history.
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();

    await source.emitMessage(
      JSON.stringify({
        type: "result",
        content: { execution: { thinkingSummary: "decomposed", error: "query timed out" } },
      })
    );

    expect(messages.value[1]?.snapshot?.execution).toMatchObject({
      thinkingSummary: "decomposed",
      error: "query timed out",
    });
  });

  it("stores the full error reason on the error page and leaves truncation to rendering", async () => {
    const { sender, messages } = makeSender();
    await sender.resumeStandardMessage({ threadId: "thread-1", requestSeq: 0, token: "token-1" });
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();
    const reason = `ABC decomposition: ${"full failure reason returned by the backend ".repeat(20)}; dynamic metric hot data: recall failed`;

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
            content: { markdownTable: "completed query", execution: { fullContent: "completed query" } },
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
