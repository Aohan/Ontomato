import type { DiagnosisStreamEvent } from "@ontomato/contracts/diagnosis";
import type { HttpResponse } from "@ontomato/contracts/http";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../../../utils/api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
    }
  },
  nodeApiGet: api.get,
  nodeApiPost: api.post,
  nodeApiPatch: api.patch,
  nodeApiDelete: api.remove,
  nodeApiFetch: api.fetch,
}));

import { useDiagnosisChatStore } from "../agent-chat";

function apiData<T>(data: T): Extract<HttpResponse<T>, { success: true }> {
  return { success: true, data };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function streamResponse(events: DiagnosisStreamEvent[], signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((event, index) => {
          controller.enqueue(
            encoder.encode(`id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        });
        signal?.addEventListener("abort", () => controller.error(new Error("cancelled")), {
          once: true,
        });
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}

describe("diagnosis chat store session isolation", () => {
  const running = new Set<string>();
  let nextSession = 1;

  beforeEach(() => {
    setActivePinia(createPinia());
    running.clear();
    nextSession = 1;
    vi.clearAllMocks();

    api.get.mockImplementation((path: string) => {
      const historyMatch = path.match(/\/sessions\/([^/]+)\/history$/);
      return Promise.resolve(
        apiData(
          historyMatch
            ? {
                messages: [],
                responseStatus: running.has(historyMatch[1]!) ? "running" : "idle",
              }
            : []
        )
      );
    });
    api.post.mockImplementation(async (path: string, body: { title?: string }) => {
      if (path.endsWith("/sessions")) {
        const id = `session-${nextSession++}`;
        return apiData({
          id,
          title: body.title || id,
          createdAt: "2026-07-21T00:00:00.000Z",
          responseStatus: "idle",
        });
      }
      return apiData({ cancelled: true });
    });
    api.patch.mockResolvedValue(apiData({}));
    api.remove.mockResolvedValue(apiData(undefined));
    api.fetch.mockImplementation(
      async (
        _path: string,
        _method: string,
        body: { sessionId: string; message: string },
        options: { signal: AbortSignal }
      ) => {
        running.add(body.sessionId);
        return streamResponse(
          [{ type: "response_started", message: body.message }],
          options.signal
        );
      }
    );
  });

  it("keeps drafts and running state independent while switching sessions", async () => {
    const store = useDiagnosisChatStore();

    store.draft = "draft-a";
    const first = (await store.createSession({ title: "A" }))!;
    store.clearSession();

    store.draft = "draft-b";
    const second = (await store.createSession({ title: "B" }))!;

    await store.selectSession(first.id);
    expect(store.draft).toBe("draft-a");
    store.draft = "question-a";
    expect(await store.sendMessage("question-a")).toBe(true);
    store.draft = "next-a";

    await store.selectSession(second.id);
    expect([store.isSending, store.draft]).toEqual([false, "draft-b"]);
    store.draft = "question-b";
    expect(await store.sendMessage("question-b")).toBe(true);
    store.draft = "next-b";

    await store.selectSession(first.id);
    expect([store.isSending, store.draft]).toEqual([true, "next-a"]);
    await store.selectSession(second.id);
    expect([store.isSending, store.draft]).toEqual([true, "next-b"]);

    await store.deleteSession(first.id);
    await store.deleteSession(second.id);
  });

  it("does not overwrite a newly typed draft when the preceding send fails", async () => {
    const store = useDiagnosisChatStore();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.createSession({ title: "failure" });
    const request = deferred<Response>();
    api.fetch.mockImplementationOnce(() => request.promise);

    store.draft = "draft typed while session creation completed";
    const sending = store.sendMessage("failed message");
    expect(store.isSending).toBe(true);
    expect(store.draft).toBe("draft typed while session creation completed");
    store.draft = "new draft written while connecting";
    request.reject(new Error("network failed"));

    await expect(sending).resolves.toBe(false);
    expect(store.isSending).toBe(false);
    expect(store.draft).toBe("new draft written while connecting");
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("keeps a closing response and stale history from overwriting the next response", async () => {
    const store = useDiagnosisChatStore();
    const session = (await store.createSession({ title: "race" }))!;
    const staleHistory = deferred<unknown>();
    api.get.mockImplementation((path: string) =>
      path.endsWith("/history") ? staleHistory.promise : Promise.resolve(apiData([]))
    );
    let responseNumber = 0;
    api.fetch.mockImplementation(
      async (_path, _method, _body, options: { signal: AbortSignal }) => {
        responseNumber += 1;
        return streamResponse(
          responseNumber === 1
            ? [
                { type: "response_started", message: "first" },
                { type: "response_end", status: "completed" },
              ]
            : [
                { type: "response_started", message: "second" },
                { type: "token", content: "fresh answer" },
              ],
          options.signal
        );
      }
    );

    const staleLoad = store.loadHistory(session.id);
    expect(await store.sendMessage("first")).toBe(true);
    await vi.waitFor(() => expect(store.isSending).toBe(false));
    expect(await store.sendMessage("second")).toBe(true);
    await vi.waitFor(() =>
      expect(store.messages.map((message) => message.content)).toEqual(["second", "fresh answer"])
    );

    staleHistory.resolve(
      apiData({
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "old answer" },
        ],
        responseStatus: "completed",
      })
    );
    await staleLoad;
    expect(store.isSending).toBe(true);
    expect(store.messages.map((message) => message.content)).toEqual(["second", "fresh answer"]);

    await store.deleteSession(session.id);
  });
});
