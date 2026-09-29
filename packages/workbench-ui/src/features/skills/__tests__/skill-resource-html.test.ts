import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withSkillResourceCredentials } from "../utils/skill-resource";
import { installAuthHost } from "../../../utils/auth";

// The original test wrote credentials through the auth module; shared code now reads them through the app host, so an in-memory credential with the same semantics is used here.
const credential: { token: string | null; apiKey: string | null } = { token: null, apiKey: null };
installAuthHost({
  getToken: () => credential.token,
  getApiKey: () => credential.apiKey,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
  getUserInfo: () => null,
  responseStatusError: () => null,
});
const setApiKey = (apiKey: string) => (credential.apiKey = apiKey);
const setToken = (token: string) => (credential.token = token);

describe("skill resource HTML credentials", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    credential.token = null;
    credential.apiKey = null;
    storage = new Map();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("credentializes only the displayed copy with token precedence", () => {
    setApiKey("current-key");
    setToken("current-token");
    const historicalHtml =
      '<script src="/api/skills/resources/example.js?v=2&apiKey=stale#runtime"></script>';
    const displayedHtml = withSkillResourceCredentials(historicalHtml);

    expect(displayedHtml).toContain(
      'src="/api/skills/resources/example.js?v=2&tk=current-token#runtime"'
    );
    expect(displayedHtml).not.toContain("apiKey=");
    expect(historicalHtml).toContain("apiKey=stale");
  });

  it("removes credentials stored in old HTML when no current identity exists", () => {
    const historicalHtml =
      '<script src="/api/skills/resources/example.js?v=2&tk=stale&apiKey=stale-key#runtime"></script>';

    const displayedHtml = withSkillResourceCredentials(historicalHtml);

    expect(displayedHtml).not.toMatch(/(?:tk|apiKey)=/);
    expect(historicalHtml).toContain("tk=stale");
  });
});
