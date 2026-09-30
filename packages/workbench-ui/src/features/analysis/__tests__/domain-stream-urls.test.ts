import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamDeepAnalysis, streamFollowUp, streamTaskExecution } from "../api";
import { installAuthHost } from "../../../utils/auth";

// The original test doubled the auth module; shared code now gets credentials from the app host, so the same double is installed here.
const host = {
  getApiKey: vi.fn((): string | null => null),
  getToken: vi.fn((): string | null => null),
  verifySessionOnce: vi.fn(async () => "valid" as const),
  handleAuthExpired: vi.fn(),
  getUserInfo: () => null,
  responseStatusError: () => null,
};
installAuthHost(host);
const { getApiKey, getToken } = host;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null = null;
  onerror: ((event?: Event) => void | Promise<void>) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener() {}
  close() {}
}

describe("credential-only analysis stream URLs", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.mocked(getApiKey).mockReturnValue(null);
    vi.mocked(getToken).mockReturnValue(null);
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("keeps reusable deep-analysis and follow-up streams credential-only", () => {
    vi.mocked(getApiKey).mockReturnValue("api-key-a");
    streamDeepAnalysis("question", {
      agentId: "agent-a",
      threadId: "thread-a",
      token: "token-a",
    });
    streamFollowUp("follow-up", {
      agentId: "agent-a",
      threadId: "thread-a",
      token: "token-a",
    });

    for (const source of FakeEventSource.instances) {
      const params = new URL(source.url, "http://localhost").searchParams;
      expect(params.get("tk")).toBe("token-a");
      expect(params.has("apiKey")).toBe(false);
      expect(params.has("domainId") || params.has("userId")).toBe(false);
    }
  });

  it("uses the API Key for task streams only when no token exists", () => {
    vi.mocked(getApiKey).mockReturnValue("api-key-a");
    streamTaskExecution("task-a", {});
    vi.mocked(getToken).mockReturnValue("token-a");
    streamTaskExecution("task-b", {});

    const apiKeyParams = new URL(FakeEventSource.instances[0]!.url, "http://localhost")
      .searchParams;
    expect([...apiKeyParams.keys()]).toEqual(["apiKey"]);

    const tokenParams = new URL(FakeEventSource.instances[1]!.url, "http://localhost").searchParams;
    expect([...tokenParams.keys()]).toEqual(["tk"]);
  });
});
