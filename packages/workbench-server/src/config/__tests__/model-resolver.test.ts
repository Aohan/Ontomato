import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSettingsData } from "@ontomato/contracts/model-settings";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { runWithLogContext } from "../../logging/log-context";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import {
  ModelNotConfiguredError,
  getRoleNotConfiguredMessage,
  resolveModelForRole,
} from "../model-resolver";

const mockBackendGet = vi.fn();

vi.mock("../../utils/backend-client", () => ({
  backendGet: (...args: unknown[]) => mockBackendGet(...args),
}));

describe("model-resolver", () => {
  beforeAll(() => {
    configureI18n({
      defaultLocale: "en",
      languageSwitchEnabled: false,
      appTextLocale: "en",
      packs: {
        en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta },
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseIsoDurationSeconds", () => {
    it("parses valid ISO-8601 duration combinations", () => {
      expect(parseIsoDurationSeconds("PT5M")).toBe(300);
      expect(parseIsoDurationSeconds("PT300S")).toBe(300);
      expect(parseIsoDurationSeconds("PT1H")).toBe(3600);
      expect(parseIsoDurationSeconds("PT1H30M")).toBe(5400);
      expect(parseIsoDurationSeconds("PT0.5S")).toBe(0.5);
      expect(parseIsoDurationSeconds("PT1H2M3.5S")).toBe(3723.5);
      expect(parseIsoDurationSeconds("PT0S")).toBe(0);
    });

    it("throws error for invalid formats", () => {
      expect(() => parseIsoDurationSeconds("")).toThrow("Invalid ISO-8601 duration");
      expect(() => parseIsoDurationSeconds("300")).toThrow("Invalid ISO-8601 duration");
      expect(() => parseIsoDurationSeconds("PT")).toThrow("Invalid ISO-8601 duration");
      expect(() => parseIsoDurationSeconds("invalid")).toThrow("Invalid ISO-8601 duration");
      expect(() => parseIsoDurationSeconds("PT5X")).toThrow("Invalid ISO-8601 duration");
    });
  });

  describe("getRoleNotConfiguredMessage", () => {
    it("returns formatted message via i18n", () => {
      expect(getRoleNotConfiguredMessage("general")).toBe(
        "No model configured for role 'General', please configure it in model settings"
      );
      expect(getRoleNotConfiguredMessage("query")).toBe(
        "No model configured for role 'Query', please configure it in model settings"
      );
    });
  });

  describe("resolveModelForRole", () => {
    const validSettings: ModelSettingsData = {
      models: [
        {
          name: "m-general",
          displayName: "m-general",
          baseUrl: "https://llm.example.com/v1",
          apiKeys: ["key-gen-1", "key-gen-2"],
          modelName: "gpt-4o",
          timeout: "PT5M",
          maxRetries: 2,
          maxTokens: 4096,
          contextWindow: 128000,
          customRequestParameters: { temperature_policy: "strict" },
        },
        {
          name: "m-diag",
          displayName: "m-diag",
          baseUrl: "https://diag.example.com/v1",
          apiKeys: ["key-diag-1"],
          modelName: "diag-model",
          maxTokens: 8192,
          contextWindow: 64000,
        },
      ],
      agents: {
        query: { model: null },
        coding: { model: null },
        general: { model: "m-general" },
        diagnosis: { model: "m-diag" },
        knowledgeGovernance: { model: null },
      },
    };

    it("fetches settings from Java using credentials from LogContext and parses JSON text", async () => {
      mockBackendGet.mockResolvedValueOnce({
        text: JSON.stringify({
          success: true,
          data: validSettings,
        }),
      });

      const resolved = await runWithLogContext(
        { domainId: "domain-test", token: "jwt-token-123" },
        () => resolveModelForRole("general")
      );

      expect(mockBackendGet).toHaveBeenCalledWith(
        "/businessConfig/getModelSettings",
        "/businessConfig/getModelSettings",
        {
          token: "jwt-token-123",
          apiKey: undefined,
        }
      );

      expect(resolved).toEqual({
        baseUrl: "https://llm.example.com/v1",
        apiKey: "key-gen-1",
        modelName: "gpt-4o",
        timeoutSeconds: 300,
        maxRetries: 2,
        maxTokens: 4096,
        contextWindow: 128000,
        customRequestParameters: { temperature_policy: "strict" },
      });
    });

    it("does not invent default timeout or maxRetries when missing", async () => {
      mockBackendGet.mockResolvedValueOnce({
        text: JSON.stringify({
          success: true,
          data: validSettings,
        }),
      });

      const resolved = await runWithLogContext(
        { domainId: "domain-test", apiKey: "datarag-api-key" },
        () => resolveModelForRole("diagnosis")
      );

      expect(resolved.modelName).toBe("diag-model");
      expect(resolved.apiKey).toBe("key-diag-1");
      expect(resolved.timeoutSeconds).toBeUndefined();
      expect(resolved.maxRetries).toBeUndefined();
      expect(resolved.maxTokens).toBe(8192);
      expect(resolved.contextWindow).toBe(64000);
    });

    it("throws ModelNotConfiguredError when role has model null", async () => {
      mockBackendGet.mockResolvedValueOnce({
        text: JSON.stringify({
          success: true,
          data: validSettings,
        }),
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("knowledgeGovernance"))
      ).rejects.toThrow(ModelNotConfiguredError);
    });

    it("throws standard error on data inconsistency when referenced model not found in list", async () => {
      mockBackendGet.mockResolvedValueOnce({
        text: JSON.stringify({
          success: true,
          data: {
            ...validSettings,
            agents: {
              ...validSettings.agents,
              general: { model: "nonexistent-id" },
            },
          },
        }),
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("general"))
      ).rejects.toThrow("Model settings are inconsistent");
    });

    it("throws error with Java message when backend returns success false", async () => {
      mockBackendGet.mockResolvedValueOnce({
        text: JSON.stringify({
          success: false,
          message: "Internal Java error",
        }),
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("general"))
      ).rejects.toThrow("Internal Java error");
    });
  });
});
