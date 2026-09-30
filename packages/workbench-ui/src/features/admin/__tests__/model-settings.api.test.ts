import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: unknown }> }));

vi.mock("../../../utils/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn((path: string, body?: unknown) => {
    calls.posts.push({ path, body });
    return Promise.resolve({ success: true });
  }),
  nodeApiDelete: vi.fn(),
  nodeApiFetch: vi.fn(),
  nodeApiGet: vi.fn(),
  nodeApiPatch: vi.fn(),
  nodeApiPost: vi.fn(),
}));

import { adminApi } from "../api";

describe("model settings api", () => {
  beforeEach(() => {
    calls.posts.length = 0;
  });
  it("saves the model list and the five role references in one request", async () => {
    const payload = {
      models: [
        {
          name: "qwen-main",
          displayName: "Qwen",
          baseUrl: "https://example/v1",
          apiKeys: ["sk-fake-ab12", "sk-fake-cd34"],
          modelName: "qwen3",
          maxTokens: 50000,
          contextWindow: 256000,
          timeout: "PT300S",
        },
      ],
      agents: {
        query: "qwen-main",
        coding: "qwen-main",
        general: "qwen-main",
        diagnosis: null,
        knowledgeGovernance: null,
      },
    };
    await adminApi.saveModelSettings(payload);

    expect(calls.posts).toEqual([{ path: "/businessConfig/saveModelSettings", body: payload }]);
  });

  it("saves only the skill directory", async () => {
    await adminApi.saveToolSkillDir("skills/aftercalculate");

    expect(calls.posts).toEqual([
      { path: "/businessConfig/saveToolSkillDir", body: { skilldir: "skills/aftercalculate" } },
    ]);
  });

  it("tests a draft model with the contract field names", async () => {
    const model = {
      name: "qwen-main",
      displayName: "Qwen",
      baseUrl: "https://example/v1",
      apiKeys: ["sk-fake-ab12"],
      modelName: "qwen3",
      maxTokens: null,
      contextWindow: null,
    };
    await adminApi.testModel(model, "hello");

    expect(calls.posts).toEqual([
      { path: "/businessConfig/testModel", body: { model, prompt: "hello" } },
    ]);
  });
});
