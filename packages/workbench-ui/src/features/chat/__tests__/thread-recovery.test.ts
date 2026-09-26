import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../stores/chat";
import { chatApi } from "../api";
import { rememberCurrentQaThread } from "../utils/current-qa-thread";
import { installAuthHost } from "../../../utils/auth";

vi.mock("../../analysis", () => ({
  createDeepAnalysisSender: () => ({ sendDeepAnalysisMessage: vi.fn() }),
  cancelDeepAnalysisRun: vi.fn(),
}));
installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  getUserInfo: () => null,
  verifySessionOnce: vi.fn(),
  handleAuthExpired: vi.fn(),
  responseStatusError: () => null,
});
vi.mock("../api", () => ({
  chatApi: {
    listThreads: vi.fn(),
    getThreadMessages: vi.fn(),
    openResumeStream: vi.fn(),
    cancelRun: vi.fn(),
  },
}));

const history = (active = false) =>
  new Response(
    JSON.stringify({
      messages: active
        ? [{ role: "user", content: "Headcount?", requestSeq: 0 }]
        : [
            { role: "user", content: "Headcount?", requestSeq: 0 },
            {
              role: "assistant",
              content: "6669",
              requestSeq: 0,
              snapshot: { mode: "standard", status: "completed", primaryText: "6669" },
            },
          ],
      ...(active ? { activeTurn: { requestSeq: 0 } } : {}),
    })
  );

class Stream {
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  addEventListener() {}
  async emit(data: unknown) {
    await this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("current question recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    rememberCurrentQaThread("anonymous", "", "thread");
    vi.mocked(chatApi.getThreadMessages).mockImplementation(async () => history());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restores the completed answer even when the thread list fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(chatApi.listThreads).mockRejectedValue(new Error("list unavailable"));
    const store = useChatStore();
    await Promise.all([store.loadThreads(), store.restoreCurrentThread()]);
    expect(store.currentThreadId).toBe("thread");
    expect(store.messages.at(-1)?.snapshot).toMatchObject({
      status: "completed",
      primaryText: "6669",
    });
    expect(store.isLoading).toBe(false);
    expect(chatApi.openResumeStream).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "preserves the saved title when list/history resolve in either order (list first: %s)",
    async (listFirst) => {
      let resolveList!: (value: Awaited<ReturnType<typeof chatApi.listThreads>>) => void;
      let resolveHistory!: (value: Response) => void;
      vi.mocked(chatApi.listThreads).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveList = resolve;
        })
      );
      vi.mocked(chatApi.getThreadMessages).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHistory = resolve;
        })
      );
      const store = useChatStore();
      const list = store.loadThreads();
      const restore = store.restoreCurrentThread();
      const threads = {
        total: 1,
        threads: [
          {
            threadId: "thread",
            title: "Named conversation",
            createdAt: "",
            updatedAt: "",
            messageCount: 2,
            lastCheckpointId: "checkpoint",
          },
        ],
      };
      if (listFirst) {
        resolveList(threads);
        await list;
        resolveHistory(history());
      } else {
        resolveHistory(history());
        await restore;
        resolveList(threads);
      }
      await Promise.all([list, restore]);
      expect(store.currentThreadTitle).toBe("Named conversation");
      expect(store.messages.at(-1)?.snapshot?.primaryText).toBe("6669");
    }
  );

  it("detaches without cancelling, then reloads the completed server result on return", async () => {
    const source = new Stream();
    vi.mocked(chatApi.openResumeStream).mockReturnValue(source as unknown as EventSource);
    vi.mocked(chatApi.getThreadMessages).mockResolvedValueOnce(history(true));
    const store = useChatStore();
    await store.restoreCurrentThread();
    await source.emit({ type: "token", content: "Partial content" });
    expect(store.messages.at(-1)?.snapshot?.status).toBe("streaming");
    await store.restoreCurrentThread();
    expect(chatApi.openResumeStream).toHaveBeenCalledOnce();

    store.detachCurrentStream();
    expect(source.close).toHaveBeenCalledOnce();
    expect(chatApi.cancelRun).not.toHaveBeenCalled();
    await store.restoreCurrentThread();
    await source.emit({ type: "token", content: "Stale late content" });
    expect(store.messages.at(-1)?.snapshot).toMatchObject({
      status: "completed",
      primaryText: "6669",
    });
    expect(store.streamingSnapshot).toBeNull();
  });

  it("reconnects a still-running turn after leaving the page", async () => {
    const first = new Stream();
    const second = new Stream();
    vi.mocked(chatApi.openResumeStream)
      .mockReturnValueOnce(first as unknown as EventSource)
      .mockReturnValueOnce(second as unknown as EventSource);
    vi.mocked(chatApi.getThreadMessages).mockImplementation(async () => history(true));
    const store = useChatStore();
    await store.restoreCurrentThread();
    store.detachCurrentStream();
    await store.restoreCurrentThread();
    await first.emit({ type: "token", content: "Old subscription" });
    await second.emit({ type: "token", content: "New subscription" });
    expect(store.messages.at(-1)?.snapshot?.primaryText).toBe("New subscription");
    expect(store.isLoading).toBe(true);
    store.detachCurrentStream();
  });

  it("does not reopen a stream from a stale history request after leaving and returning", async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(chatApi.getThreadMessages).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    const store = useChatStore();
    const oldRestore = store.restoreCurrentThread();
    store.ensureConversation();
    expect(store.currentThreadId).toBe("thread");
    store.detachCurrentStream();
    await store.restoreCurrentThread();
    resolveOld(history(true));
    await oldRestore;
    expect(store.messages.at(-1)?.snapshot).toMatchObject({
      status: "completed",
      primaryText: "6669",
    });
    expect(chatApi.openResumeStream).not.toHaveBeenCalled();
  });
});
