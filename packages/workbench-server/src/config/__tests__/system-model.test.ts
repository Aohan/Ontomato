import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installContentLayout } from "../../content/layout";
import { runWithLogContext } from "../../logging/log-context";
import {
  DEFAULT_ABC_QUESTION_MODE,
  DEFAULT_QUERY_TIMEOUT_SECONDS,
  SystemModelConfigError,
  getSystemModelConfig,
  saveSystemModelConfig,
} from "../system-model";

describe("system-model configuration", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "system-model-test-"));
    installContentLayout({
      runtimeRoot: tmpDir,
      prompts: [],
      skillTemplate: [],
      runtimeResources: [],
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default values when configuration file does not exist", () => {
    const config = getSystemModelConfig("domain-new");
    expect(config).toEqual({
      abcQuestionMode: DEFAULT_ABC_QUESTION_MODE,
      queryTimeoutSeconds: DEFAULT_QUERY_TIMEOUT_SECONDS,
    });
  });

  it("saves and reads configuration containing only abcQuestionMode and queryTimeoutSeconds", () => {
    const saved = saveSystemModelConfig("domain-1", {
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
    });
    expect(saved).toEqual({
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
    });

    const loaded = getSystemModelConfig("domain-1");
    expect(loaded).toEqual({
      abcQuestionMode: "tool_fixed",
      queryTimeoutSeconds: 60,
    });
  });

  it("reads domainId from LogContext when domainId argument is omitted", () => {
    runWithLogContext({ domainId: "domain-ctx" }, () => {
      saveSystemModelConfig(undefined as any, { queryTimeoutSeconds: 120 });
      const loaded = getSystemModelConfig();
      expect(loaded.queryTimeoutSeconds).toBe(120);
    });
  });

  it("throws SystemModelConfigError when domainId is missing both in arg and LogContext", () => {
    expect(() => getSystemModelConfig()).toThrow(SystemModelConfigError);
    expect(() => saveSystemModelConfig("", {})).toThrow(SystemModelConfigError);
  });

  it("rejects legacy shape in saveSystemModelConfig with models or agents", () => {
    expect(() =>
      saveSystemModelConfig("domain-legacy-save", {
        models: [{ baseUrl: "http://example.com" }],
      } as any)
    ).toThrow(SystemModelConfigError);

    expect(() =>
      saveSystemModelConfig("domain-legacy-save", {
        agents: { query: { model: "m1" } },
      } as any)
    ).toThrow(SystemModelConfigError);
  });

  it("detects legacy config file with models or agents on read and throws SystemModelConfigError", () => {
    const domainId = "domain-legacy-file";
    const encoded = encodeURIComponent(domainId).replace(/\./g, "%2E");
    const filePath = path.join(tmpDir, "data", "system-model-config", `${encoded}.json`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Write file with legacy models field
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        models: [{ id: "m1", modelName: "legacy" }],
        abcQuestionMode: "fast",
        queryTimeoutSeconds: 300,
      }),
      "utf-8"
    );

    expect(() => getSystemModelConfig(domainId)).toThrow(SystemModelConfigError);
  });

  it("validates invalid queryTimeoutSeconds and abcQuestionMode", () => {
    expect(() =>
      saveSystemModelConfig("domain-invalid", {
        queryTimeoutSeconds: -1,
      })
    ).toThrow(SystemModelConfigError);

    expect(() =>
      saveSystemModelConfig("domain-invalid", {
        abcQuestionMode: "invalid-mode" as any,
      })
    ).toThrow(SystemModelConfigError);
  });
});
