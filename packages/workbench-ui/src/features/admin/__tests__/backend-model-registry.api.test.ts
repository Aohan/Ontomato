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

describe("backend model registry api", () => {
  beforeEach(() => {
    calls.posts.length = 0;
  });
  it("saves the whole model list with the contract field names", async () => {
    const models = [
      {
        name: "qwen-main",
        displayName: "Qwen",
        baseUrl: "https://example/v1",
        apiKeys: ["sk-fake-ab12", "sk-fake-cd34"],
        modelName: "qwen3",
        timeout: "PT300S",
        maxRetries: 3,
        temperature: 0.7,
        topP: null,
        maxTokens: null,
        maxCompletionTokens: null,
        customRequestParameters: {},
      },
    ];
    await adminApi.saveBackendModels(models);

    expect(calls.posts).toEqual([{ path: "/businessConfig/saveModels", body: { models } }]);
  });

  it("saves the five role references in one request without execution fields", async () => {
    const modelsByRole = {
      normalChat: "qwen-main",
      questionSpliter: "qwen-main",
      cleverNormalChat: "qwen-main",
      pythonChat: "qwen-main",
      toolChat: "qwen-main",
    };
    await adminApi.saveBackendAgentModels(modelsByRole);

    expect(calls.posts).toEqual([
      { path: "/businessConfig/saveAgentModels", body: { modelsByRole } },
    ]);
  });

  it("saves only the skill directory", async () => {
    await adminApi.saveToolSkillDir("skills/aftercalculate");

    expect(calls.posts).toEqual([
      { path: "/businessConfig/saveToolSkillDir", body: { skilldir: "skills/aftercalculate" } },
    ]);
  });

  it("tests a draft model with the contract field names", async () => {
    const model = { name: "qwen-main" };
    await adminApi.testBackendModel(model, "hello");

    expect(calls.posts).toEqual([
      { path: "/businessConfig/testModel", body: { model, prompt: "hello" } },
    ]);
  });
});
