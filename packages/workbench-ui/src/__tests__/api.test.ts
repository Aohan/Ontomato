import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "element-plus/es/locale/lang/en";
import { installWorkbenchI18n } from "../i18n";
import { installAuthHost, type WorkbenchAuthHost } from "../utils/auth";
import { installErrorPunctuation } from "../utils/error-punctuation";
import { apiGet, apiPost, ApiRequestError } from "../utils/api";

const credential = { token: null as string | null, apiKey: null as string | null };
const statusCalls: [number, string | null][] = [];
let statusError: Error | null = null;

const host: WorkbenchAuthHost = {
  getToken: () => credential.token,
  getApiKey: () => credential.apiKey,
  responseStatusError: (status, requestCredential) => {
    statusCalls.push([status, requestCredential]);
    return statusError;
  },
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("shared request boundary", () => {
  beforeEach(() => {
    installWorkbenchI18n({
      supported: ["en"],
      defaultLocale: "en",
      initialLocale: "en",
      switchEnabled: false,
      save: null,
      messages: { en: { admin: { requestFailed: "Request failed" }, user: { sessionExpired: "Session expired" } } },
      elementLocale: () => en,
    });
    installAuthHost(host);
    installErrorPunctuation({ detailSeparator: " — ", listSeparator: " | " });
    credential.token = null;
    credential.apiKey = null;
    statusCalls.length = 0;
    statusError = null;
    vi.unstubAllGlobals();
  });

  it("a token sends tk first, an apiKey alone sends x-api-key, neither sends no credential header; the language is the current UI locale", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);
    credential.token = "tok";
    credential.apiKey = "key";
    await apiGet("/auditLog/queryPage");
    credential.token = null;
    await apiGet("x");
    credential.apiKey = null;
    await apiGet("x");
    const headers = fetchMock.mock.calls.map((call) => (call[1] as Parameters<typeof fetch>[1])!.headers as Record<string, string>);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/data-query/auditLog/queryPage");
    expect(headers[0]).toMatchObject({ tk: "tok", "Accept-Language": "en" });
    expect(headers[0]["x-api-key"]).toBeUndefined();
    expect(headers[1]).toMatchObject({ "x-api-key": "key" });
    expect(headers[2].tk).toBeUndefined();
    expect(headers[2]["x-api-key"]).toBeUndefined();
  });

  it("unsuccessful statuses go to the host with the credential captured when the request was sent (unchanged even if the login changes meanwhile)", async () => {
    credential.token = "old";
    statusError = new Error("host error");
    vi.stubGlobal("fetch", async () => {
      credential.token = "new";
      return jsonResponse(401, {});
    });
    await expect(apiPost("/x", {})).rejects.toThrow("host error");
    expect(statusCalls).toEqual([[401, "old"]]);
  });

  it("without host takeover a generic ApiRequestError is thrown, with field details joined by the app punctuation", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(400, {
        message: "Invalid",
        details: [
          { field: "a", message: "bad" },
          { field: "b", message: "worse" },
        ],
      })
    );
    const error = await apiPost("/x", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid — a: bad | b: worse");
    expect(statusCalls).toEqual([[400, null]]);
  });

  it("if the credential changed by the time a successful response's JSON is read, it is dropped as an expired session; otherwise it is returned, and business failures throw the original message", async () => {
    credential.token = "old";
    vi.stubGlobal("fetch", async () => {
      const res = jsonResponse(200, { success: true, data: 1 });
      const json = res.json.bind(res);
      res.json = async () => {
        credential.token = "new";
        return json();
      };
      return res;
    });
    await expect(apiGet("/x")).rejects.toMatchObject({ name: "AbortError", message: "Session expired" });

    credential.token = "same";
    vi.stubGlobal("fetch", async () => jsonResponse(200, { success: true, data: 2 }));
    await expect(apiGet("/x")).resolves.toEqual({ success: true, data: 2 });
    vi.stubGlobal("fetch", async () => jsonResponse(200, { success: false, message: "denied" }));
    await expect(apiGet("/x")).rejects.toThrow("denied");
  });
});
