import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../../config/application";
import { resolveModelForRole } from "../../../config/model-resolver";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { runWithLogContext } from "../../../logging/log-context";
import { AuthFailedError, backendGet } from "../../../utils/backend-client";
import { proxyUpstream } from "../proxy";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

// Over real local HTTP with a synthetic Java stand-in: the edition's model settings read header goes only on Node's
// own model read, never on other backend calls, and the Java proxy neither adds it nor forwards one from the browser.
const HEADER = "x-ontomato-model-runtime-token";
const received: { path: string; headers: http.IncomingHttpHeaders }[] = [];
const servers: http.Server[] = [];
/** Status the Java stand-in answers with; 200 serves the model settings. */
let javaStatus = 200;

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let proxyBase: string;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  installWorkbenchIdentity({
    modelSettingsReadHeaders: { "X-Ontomato-Model-Runtime-Token": "synthetic-runtime-token" },
  } as unknown as WorkbenchIdentity);
  const java = express();
  java.use((req, res) => {
    received.push({ path: req.path, headers: req.headers });
    if (javaStatus !== 200) {
      res.status(javaStatus).json({ success: false, code: javaStatus, message: "refused" });
      return;
    }
    res.json({
      success: true,
      data: {
        models: [{ name: "m", baseUrl: "https://llm.test/v1", apiKeys: ["k"], modelName: "x", maxTokens: 1, contextWindow: 2 }],
        agents: { general: { model: "m" } },
      },
    });
  });
  config.dataQuery.baseUrl = await listen(java);

  const node = express();
  node.use((req, res) => void proxyUpstream(req, res, config.dataQuery.baseUrl, req.path));
  proxyBase = await listen(node);
});

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("model runtime read headers", () => {
  it("are sent on the model settings read next to the user's own credentials", async () => {
    received.length = 0;
    await runWithLogContext({ domainId: "d1", token: "user-token", apiKey: "user-key" }, () =>
      resolveModelForRole("general")
    );
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/businessConfig/getModelSettings");
    expect(received[0].headers[HEADER]).toBe("synthetic-runtime-token");
    expect(received[0].headers.tk).toBe("user-token");
    expect(received[0].headers["x-api-key"]).toBe("user-key");
  });

  it("are not added to other backend calls with the same credentials", async () => {
    received.length = 0;
    const endpoint = "/businessConfig/getConfigAndDesc";
    await backendGet(endpoint, `${config.dataQuery.baseUrl}${endpoint}`, { token: "user-token", apiKey: "user-key" });
    expect(received[0].headers.tk).toBe("user-token");
    expect(received[0].headers).not.toHaveProperty(HEADER);
  });

  it("are neither added nor forwarded by the Java proxy, even when the browser supplies one", async () => {
    received.length = 0;
    await fetch(`${proxyBase}/businessConfig/getModelSettings`, {
      headers: { tk: "user-token", "X-Ontomato-Model-Runtime-Token": "browser-supplied" },
    });
    await fetch(`${proxyBase}/businessConfig/getConfig`, { headers: { tk: "user-token" } });
    expect(received.map(({ path }) => path)).toEqual(["/businessConfig/getModelSettings", "/businessConfig/getConfig"]);
    for (const { headers } of received) {
      expect(headers.tk).toBe("user-token");
      expect(headers).not.toHaveProperty(HEADER);
    }
  });

  it("a 403 on the model read is a deployment refusal, not a sign-in failure; a 401 stays a sign-in failure", async () => {
    const read = () =>
      runWithLogContext({ domainId: "d1", token: "user-token" }, () => resolveModelForRole("general"));
    try {
      javaStatus = 403;
      const refused = await read().catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(Error);
      // Chat, query and analysis routes send auth_failed (and so a re-login) only for AuthFailedError.
      expect(refused).not.toBeInstanceOf(AuthFailedError);
      expect((refused as Error).message).toContain("403");
      expect((refused as Error).message).not.toContain("synthetic-runtime-token");

      javaStatus = 401;
      const expired = await read().catch((error: unknown) => error);
      expect(expired).toBeInstanceOf(AuthFailedError);
      expect((expired as AuthFailedError).status).toBe(401);
    } finally {
      javaStatus = 200;
    }
  });
});
