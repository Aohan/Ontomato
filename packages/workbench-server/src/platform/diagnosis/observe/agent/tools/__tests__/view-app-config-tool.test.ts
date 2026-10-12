import express from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticConfigSchema } from "@ontomato/contracts/diagnostic-config";
import { configureI18n } from "../../../../../../i18n";
import { appTextEn } from "../../../../../../i18n/app-text-en";
import { appTextDiagnosisEn } from "../../../../../../i18n/app-text-diagnosis-en";
import { en, enLocaleMeta } from "../../../../../../i18n/locales/en";
import { createViewAppConfigTool } from "../view-app-config-tool";

// Over real local HTTP with a synthetic data engine. The samples are the ones the Java test serializes its
// getConfigAndDesc response against, so both sides agree on the same wire shape.
const fixture = (name: string) =>
  JSON.parse(
    fs.readFileSync(
      fileURLToPath(new URL(`../../../../../../../../contracts/src/__tests__/fixtures/${name}`, import.meta.url)),
      "utf8"
    )
  );
const full = fixture("diagnostic-config-full.json");
const sparse = fixture("diagnostic-config-sparse.json");

/** What the stand-in answers next: an HTTP status and a raw body. */
let reply: { status: number; body: string };
let server: http.Server;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  const app = express();
  app.use((_req, res) => {
    res.status(reply.status).type("application/json").send(reply.body);
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  vi.stubEnv("DATA_QUERY_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  reply = { status: 200, body: "" };
});

const answer = (config: unknown, extra: Record<string, unknown> = {}) => {
  reply = { status: 200, body: JSON.stringify({ success: true, data: { config, desc: "Effect notes.", ...extra } }) };
};

const run = async (params: Record<string, unknown> = {}) => {
  const tool = createViewAppConfigTool({ domainId: "d1", token: "tk", apiKey: "key" });
  return (await tool.execute("call", params)).content[0].text as string;
};

/** The full sample with secret-marked keys added at every level the data engine's raw config has them. */
function withSecrets() {
  const config = structuredClone(full);
  const openAi = config.langchain4j["open-ai"];
  Object.assign(openAi.models[0], {
    baseUrl: "https://u:SECRET-URL@llm.test/v1?key=SECRET-URL",
    apiKeys: ["SECRET-MODEL-KEY"],
    customHeaders: { Authorization: "Bearer SECRET-HEADER" },
    customRequestParameters: { nested: { token: "SECRET-PARAM" } },
  });
  Object.assign(openAi["embedding-model"], {
    apiKey: "SECRET-EMBEDDING-KEY",
    customHeaders: { "X-Key": "SECRET-EMB-HEADER" },
  });
  openAi.agents.query.extra = "SECRET-ROLE";
  config.ontomato.sso = { clientSecret: "SECRET-SSO" };
  config.ontomato["data-engine"].productionEnvPwd = "SECRET-PROD";
  config.newSection = { anything: "SECRET-NEW" };
  return config;
}

describe("the shared diagnosis samples", () => {
  it("are exactly the contract: parsing keeps every field and adds none", () => {
    expect(diagnosticConfigSchema.parse(full)).toEqual(full);
    expect(diagnosticConfigSchema.parse(sparse)).toEqual(sparse);
  });
});

describe("view_app_config", () => {
  it("renders the contract's fields and the effect notes", async () => {
    answer(full);
    const text = await run();
    expect(text).toContain("Effect notes.");
    expect(text).toContain("- `open-ai.models[0].connectionConfigured`: true");
    expect(text).toContain("- `open-ai.embedding-model.apiKeyConfigured`: true");
    expect(text).toContain("- `data-engine.dataAdapter`: postgresql");

    answer(sparse);
    expect(await run()).toContain("- `open-ai.models`: []");
  });

  it("drops secrets put at any level or under any new key, in the full view and in a section", async () => {
    answer(withSecrets(), { message: "SECRET-ENVELOPE" });
    for (const params of [{}, { section: "langchain4j" }, { section: "ontomato" }, { section: "newSection" }]) {
      const text = await run(params);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("https://");
    }
  });

  it("reports a malformed or off-contract body as such and echoes none of it", async () => {
    reply = { status: 200, body: '{"success":true,"data":{"config":"SECRET-RAW' };
    expect(await run()).toBe(appTextDiagnosisEn["diag.observe.agent.tools.view-app-config-tool.17"]);

    // The old full raw configuration is not this contract.
    answer({ langchain4j: { "open-ai": { models: [{ name: "m", apiKeys: ["SECRET-OLD"] }] } } });
    expect(await run()).toBe(appTextDiagnosisEn["diag.observe.agent.tools.view-app-config-tool.17"]);
  });

  it("reports a refused read or an HTTP error without the response's message or body", async () => {
    reply = { status: 200, body: JSON.stringify({ success: false, message: "SECRET-IN-MESSAGE" }) };
    expect(await run()).toBe(appTextDiagnosisEn["diag.observe.agent.tools.view-app-config-tool.16"]);

    for (const status of [400, 500]) {
      reply = { status, body: JSON.stringify({ success: false, message: "SECRET-IN-HTTP-DETAIL" }) };
      const text = await run();
      expect(text).toContain(String(status));
      expect(text).not.toContain("SECRET");
    }
  });
});
