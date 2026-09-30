import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelNotConfiguredError } from "../model-resolver";
import { createModel } from "../model-factory";

const mockResolveModelForRole = vi.fn();

vi.mock("../model-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-resolver")>();
  return {
    ...actual,
    resolveModelForRole: (...args: unknown[]) => mockResolveModelForRole(...args),
  };
});

describe("model-factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates ChatOpenAI instance using resolved model with maxTokens", async () => {
    mockResolveModelForRole.mockResolvedValueOnce({
      baseUrl: "https://llm.example.com/v1",
      apiKey: "test-key-123",
      modelName: "test-model-name",
      timeout: 120,
      maxRetries: 2,
      maxTokens: 4096,
      contextWindow: 128000,
      customRequestParameters: { custom_param: "value" },
    });

    const model = await createModel({
      temperature: 0.7,
      stream: true,
      agentName: "test-agent",
    });

    expect(mockResolveModelForRole).toHaveBeenCalledWith("general");
    expect(model.model).toBe("test-model-name");
    expect(model.temperature).toBe(0.7);
    expect(model.maxTokens).toBe(4096);
  });

  it("propagates ModelNotConfiguredError when role has no model", async () => {
    mockResolveModelForRole.mockRejectedValueOnce(
      new ModelNotConfiguredError("Role not configured")
    );

    await expect(createModel()).rejects.toThrow(ModelNotConfiguredError);
  });
});
