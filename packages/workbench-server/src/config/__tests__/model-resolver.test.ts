import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSettingsData } from "@ontomato/contracts/model-settings";
import { runWithLogContext } from "../../logging/log-context";
import {
  ModelNotConfiguredError,
  parseTimeoutSeconds,
  resolveModelForRole,
  validateSystemModelApiKey,
} from "../model-resolver";

const mockBackendGet = vi.fn();

vi.mock("../../utils/backend-client", () => ({
  backendGet: (...args: unknown[]) => mockBackendGet(...args),
}));

describe("model-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseTimeoutSeconds", () => {
    it("returns numbers as rounded values", () => {
      expect(parseTimeoutSeconds(60)).toBe(60);
      expect(parseTimeoutSeconds(45.6)).toBe(46);
    });

    it("parses ISO duration format PT{seconds}S", () => {
      expect(parseTimeoutSeconds("PT120S")).toBe(120);
      expect(parseTimeoutSeconds("PT0S")).toBe(0);
      expect(parseTimeoutSeconds("PT3600S")).toBe(3600);
    });

    it("falls back to 300 for missing or invalid formats", () => {
      expect(parseTimeoutSeconds(undefined)).toBe(300);
      expect(parseTimeoutSeconds("invalid")).toBe(300);
      expect(parseTimeoutSeconds(-5)).toBe(300);
    });
  });

  describe("validateSystemModelApiKey", () => {
    it("passes for non-empty string", () => {
      expect(() => validateSystemModelApiKey("key-123")).not.toThrow();
    });

    it("throws ModelNotConfiguredError for empty, whitespace, or undefined", () => {
      expect(() => validateSystemModelApiKey(undefined)).toThrow(ModelNotConfiguredError);
      expect(() => validateSystemModelApiKey("")).toThrow(ModelNotConfiguredError);
      expect(() => validateSystemModelApiKey("   ")).toThrow(ModelNotConfiguredError);
    });
  });

  describe("resolveModelForRole", () => {
    const validSettings: ModelSettingsData = {
      models: [
        {
          name: "m-general",
          baseUrl: "https://llm.example.com/v1",
          apiKeys: ["key-gen-1", "key-gen-2"],
          modelName: "gpt-4o",
          timeout: "PT180S",
          maxRetries: 2,
          maxTokens: 4096,
          contextWindow: 128000,
          customRequestParameters: { temperature_policy: "strict" },
        },
        {
          name: "m-diag",
          baseUrl: "https://diag.example.com/v1",
          apiKeys: ["key-diag-1"],
          modelName: "diag-model",
          timeout: "PT60S",
          maxRetries: 1,
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

    it("fetches settings from Java using credentials and domainId from LogContext", async () => {
      mockBackendGet.mockResolvedValueOnce({
        success: true,
        data: validSettings,
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
        timeoutSeconds: 180,
        maxRetries: 2,
        maxTokens: 4096,
        contextWindow: 128000,
        customRequestParameters: { temperature_policy: "strict" },
      });
    });

    it("resolves diagnosis role correctly", async () => {
      mockBackendGet.mockResolvedValueOnce({
        success: true,
        data: validSettings,
      });

      const resolved = await runWithLogContext(
        { domainId: "domain-test", apiKey: "datarag-api-key" },
        () => resolveModelForRole("diagnosis")
      );

      expect(mockBackendGet).toHaveBeenCalledWith(
        "/businessConfig/getModelSettings",
        "/businessConfig/getModelSettings",
        {
          token: undefined,
          apiKey: "datarag-api-key",
        }
      );

      expect(resolved.modelName).toBe("diag-model");
      expect(resolved.apiKey).toBe("key-diag-1");
      expect(resolved.timeoutSeconds).toBe(60);
      expect(resolved.maxTokens).toBe(8192);
      expect(resolved.contextWindow).toBe(64000);
    });

    it("throws ModelNotConfiguredError when role has model null", async () => {
      mockBackendGet.mockResolvedValueOnce({
        success: true,
        data: validSettings,
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("knowledgeGovernance"))
      ).rejects.toThrow(ModelNotConfiguredError);
    });

    it("throws ModelNotConfiguredError when role references nonexistent model ID", async () => {
      mockBackendGet.mockResolvedValueOnce({
        success: true,
        data: {
          ...validSettings,
          agents: {
            ...validSettings.agents,
            general: { model: "nonexistent-id" },
          },
        },
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("general"))
      ).rejects.toThrow(ModelNotConfiguredError);
    });

    it("throws ModelNotConfiguredError when model apiKeys array is empty", async () => {
      mockBackendGet.mockResolvedValueOnce({
        success: true,
        data: {
          ...validSettings,
          models: [
            {
              name: "m-general",
              baseUrl: "https://llm.example.com/v1",
              apiKeys: [],
              modelName: "gpt-4o",
            },
          ],
        },
      });

      await expect(
        runWithLogContext({ domainId: "d1" }, () => resolveModelForRole("general"))
      ).rejects.toThrow(ModelNotConfiguredError);
    });
  });
});
