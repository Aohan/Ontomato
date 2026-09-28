import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import BackendModelListCard from "../business-config/BackendModelListCard.vue";
import SystemModelConfigCard from "../business-config/SystemModelConfigCard.vue";
import BackendAgentConfigCard from "../business-config/BackendAgentConfigCard.vue";
import EmbeddingModelConfigCard from "../business-config/EmbeddingModelConfigCard.vue";
import SkillDirConfigCard from "../business-config/SkillDirConfigCard.vue";
import QuerySettingsCard from "../business-config/QuerySettingsCard.vue";
import BusinessConfig from "../BusinessConfig.vue";
import type { BackendModelConfig, EmbeddingModelConfig } from "../../types";
import { agentKeys } from "../../types";
import { adminApi } from "../../../admin";
import { workbenchI18n } from "../../../../i18n";
import { businessConfig } from "../../../../../../../apps/workbench/web/src/business-config";

const BACKEND_CUSTOMS =
  '{"__v_isRef":true,"__v_isReactive":1,"__v_isReadonly":0,"__v_raw":{"nested":"user-value"},"value":"keep-me","temperature":null,"constructor":{"x":1},"__proto__":{"polluted":false},"arr":[1,null,{"k":"v"}]}';
const FRONTEND_CUSTOMS =
  '{"__v_raw":{"deep":"frontend-value"},"__v_isRef":true,"__v_isReactive":true,"__v_isReadonly":true,"value":7,"note":null}';

const savedPayload = vi.hoisted(() => ({
  models: null as unknown,
  system: null as unknown,
  test: null as unknown,
  roleModels: null as unknown,
  skilldir: null as unknown,
  embedding: null as unknown,
  embeddingTest: null as unknown,
}));

const calls = vi.hoisted(() => ({ getConfig: 0 }));

// 模拟服务端持久的模型库：GET 返回副本（含完整假 Key），保存原样落库。
const server = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  failNextRead: false,
}));

const fixtures = vi.hoisted(() => ({
  models: [
    {
      name: "qwen-main",
      displayName: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeys: ["", "sk-fake-ab12", "sk-fake-cd34"],
      modelName: "qwen3",
      timeout: "PT300S",
      maxRetries: 99,
      organizationId: "org-existing",
      projectId: "project-existing",
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
      temperature: 0.7,
      topP: null,
      maxTokens: null,
      maxCompletionTokens: null,
      customRequestParameters: JSON.parse(
        '{"__v_isRef":true,"__v_isReactive":1,"__v_isReadonly":0,"__v_raw":{"nested":"user-value"},"value":"keep-me","temperature":null,"constructor":{"x":1},"__proto__":{"polluted":false},"arr":[1,null,{"k":"v"}]}'
      ),
    },
    {
      name: "qwen-lite",
      displayName: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeys: ["sk-fake-ef56"],
      modelName: "qwen3-lite",
      timeout: "PT120S",
      maxRetries: 3,
      temperature: null,
      topP: null,
      maxTokens: null,
      maxCompletionTokens: null,
      customRequestParameters: {},
    },
  ],
  agents: {
    normalChat: { model: "qwen-main", actorCopies: 7 },
    questionSpliter: { model: "qwen-main", actorCopies: 1 },
    cleverNormalChat: { model: "qwen-main", actorCopies: 1 },
    pythonChat: { model: "qwen-main", actorCopies: 1 },
    toolChat: { model: "qwen-main", actorCopies: 1, skilldir: "skills/legacy" },
  },
  embedding: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-embed",
    modelName: "text-embedding-v3",
    timeout: "PT300S",
    customHeaders: { "X-Embed-Key": "keep" },
  },
  system: {
    models: [
      {
        name: "default",
        displayName: "GPT-4o",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-preview",
        modelName: "gpt-4o",
        customRequestParameters: JSON.parse(
          '{"__v_raw":{"deep":"frontend-value"},"__v_isRef":true,"__v_isReactive":true,"__v_isReadonly":true,"value":7,"note":null}'
        ),
        timeoutSeconds: 300,
        maxRetries: 3,
        contextWindow: 256000,
      },
    ],
    agents: { default: { model: "default" }, diagnosis: { model: "default" } },
    abcQuestionMode: "harness",
    queryTimeoutSeconds: 600,
    hasCustomConfig: false,
  },
}));

vi.mock("../../../admin", () => ({
  adminApi: {
    getBusinessConfig: vi.fn(async () => {
      calls.getConfig += 1;
      if (server.failNextRead) {
        server.failNextRead = false;
        return { success: false, message: "reread down" };
      }
      return {
        success: true,
        data: JSON.parse(
          JSON.stringify({
            models: server.models,
            agents: fixtures.agents,
            embeddingModelProperties: fixtures.embedding,
            knowledgeMaxResult: 10,
            toolAndPythonRetry: 0,
            dslCookerTries: 1,
            dslCookerTimeout: 300000,
            questionSpliterTries: 1,
            questionSpliterTimeout: 300000,
            lang: "zh-CN",
            dataAdapter: "m3",
            mysqlDataAdapterProperties: null,
            pgsqlDataAdapterProperties: null,
            oracleDataAdapterProperties: null,
            sqlServerDataAdapterProperties: null,
            db2DataAdapterProperties: null,
            gaussDBDataAdapterProperties: null,
          })
        ),
      };
    }),
    getSystemModelConfig: vi.fn(async () => ({
      success: true,
      data: JSON.parse(JSON.stringify(fixtures.system)),
    })),
    testSystemModelConfig: vi.fn(async (payload: unknown) => {
      savedPayload.test = JSON.parse(JSON.stringify(payload));
      return new Response('data: {"content":"ok"}\n\ndata: {"done":true}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }),
    saveSystemModelConfig: vi.fn(async (payload: Record<string, unknown>) => {
      savedPayload.system = JSON.parse(JSON.stringify(payload));
      return { success: true, data: { ...payload, hasCustomConfig: true } };
    }),
    saveBackendModels: vi.fn(async (models: Array<Record<string, unknown>>) => {
      savedPayload.models = JSON.parse(JSON.stringify(models));
      server.models = JSON.parse(JSON.stringify(models));
      return { success: true };
    }),
    saveBackendAgentModels: vi.fn(async (modelsByRole: unknown) => {
      savedPayload.roleModels = JSON.parse(JSON.stringify(modelsByRole));
      return { success: true };
    }),
    saveToolSkillDir: vi.fn(async (skilldir: string) => {
      savedPayload.skilldir = skilldir;
      return { success: true };
    }),
    saveEmbeddingModel: vi.fn(async (payload: unknown) => {
      savedPayload.embedding = JSON.parse(JSON.stringify(payload));
      return { success: true };
    }),
    testBackendModel: vi.fn(async (model: unknown, prompt: string) => {
      savedPayload.test = JSON.parse(JSON.stringify({ model, prompt }));
      return { success: true, data: "ok" };
    }),
    testEmbeddingModel: vi.fn(async (payload: unknown) => {
      savedPayload.embeddingTest = JSON.parse(JSON.stringify(payload));
      return { success: true, data: "ok" };
    }),
  },
}));

const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const global = {
  plugins: [i18n, ElementPlus],
  stubs: {
    teleport: true,
    "el-tooltip": { template: "<span><slot /></span>" },
    "el-icon": { template: "<i><slot /></i>" },
    ElDialog: {
      name: "ElDialog",
      props: ["modelValue", "title"],
      template: '<section v-if="modelValue"><slot /><slot name="footer" /></section>',
    },
  },
};

const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => {
  Object.assign(savedPayload, {
    models: null,
    system: null,
    test: null,
    roleModels: null,
    skilldir: null,
    embedding: null,
    embeddingTest: null,
  });
  calls.getConfig = 0;
  server.models = JSON.parse(JSON.stringify(fixtures.models));
  server.failNextRead = false;
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function track<T extends ReturnType<typeof mount>>(wrapper: T): T {
  wrappers.push(wrapper);
  return wrapper;
}

function button(wrapper: Pick<ReturnType<typeof mount>, "findAll">, text: string) {
  return wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
}

/** 问数引擎模型新增弹窗的连接三项：连接地址、新增一条 Key、模型名。 */
async function fillBackendConnection(dialog: Pick<ReturnType<typeof mount>, "findAll">) {
  await dialog.findAll("input")[2]!.setValue("https://new.example/v1");
  await button(dialog, t("admin.addApiKey"))!.trigger("click");
  const inputs = dialog.findAll("input");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

/** 应用模型新增弹窗的连接三项（连接地址、Key、模型名）是必填项。 */
async function fillConnection(dialog: Pick<ReturnType<typeof mount>, "findAll">) {
  const inputs = dialog.findAll("input");
  await inputs[2]!.setValue("https://new.example/v1");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

function mountBackend(models: BackendModelConfig[], extra: Record<string, unknown> = {}) {
  return track(
    mount(BackendModelListCard, {
      props: { models, saving: false, loading: false, loadError: "", ...extra },
      global,
    })
  );
}

async function mountPage() {
  const wrapper = track(mount(BusinessConfig, { props: businessConfig, global }));
  await flushPromises();
  return wrapper;
}

describe("backend model list card", () => {
  it("shows an add entry when the library is legitimately empty", () => {
    const wrapper = mountBackend([]);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    expect(button(wrapper, t("admin.addModel"))).toBeTruthy();
    expect(wrapper.find("button").attributes("disabled")).toBeUndefined();
  });

  it("shows the error with retry and disables save when loading failed", async () => {
    const wrapper = mountBackend([], { loadError: "boom" });
    expect(wrapper.text()).toContain(t("admin.modelListLoadFailed"));
    const retry = button(wrapper, t("common.retry"));
    await retry?.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    const save = button(wrapper, t("admin.saveModelList"));
    expect(save?.attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(button(wrapper, t("admin.addModel"))!.attributes("disabled")).toBeDefined();
  });

  it("blocks new drafts and writes while the model library is loading", async () => {
    const wrapper = mountBackend([], { loading: true });
    const add = button(wrapper, t("admin.addModel"))!;
    expect(add.attributes("disabled")).toBeDefined();
    await add.trigger("click");
    expect(wrapper.find("section").exists()).toBe(false);
    expect(button(wrapper, t("admin.saveModelList"))!.attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("cancelling an edit leaves the original entry untouched", async () => {
    const models = reactive([
      {
        name: "qwen-main",
        displayName: "Qwen",
        baseUrl: "https://example/v1",
        apiKeys: ["sk-1"],
        modelName: "qwen3",
        timeout: "PT300S",
        maxRetries: 3,
        customRequestParameters: { temperature: 0.1 },
        temperature: null,
        topP: null,
        maxTokens: null,
        maxCompletionTokens: null,
      },
    ]);
    const wrapper = mountBackend(models);
    await button(wrapper, t("common.edit"))?.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("changed");
    await button(wrapper, t("common.cancel"))?.trigger("click");
    expect(models[0]!.displayName).toBe("Qwen");
  });

  it("starts a new draft empty instead of reusing the previous entry", async () => {
    const models = reactive([
      {
        name: "qwen-main",
        displayName: "Qwen",
        baseUrl: "https://example/v1",
        apiKeys: ["sk-1"],
        modelName: "qwen3",
        timeout: "PT300S",
        maxRetries: 3,
        customRequestParameters: {},
        temperature: null,
        topP: null,
        maxTokens: null,
        maxCompletionTokens: null,
      },
    ]);
    const wrapper = mountBackend(models);
    await button(wrapper, t("common.edit"))?.trigger("click");
    await button(wrapper, t("common.cancel"))?.trigger("click");
    await button(wrapper, t("admin.addModel"))?.trigger("click");
    const nameInput = wrapper.find("section input");
    expect((nameInput.element as HTMLInputElement).value).toBe("");
  });

  it("fixes the config ID once created while the display name stays editable", async () => {
    const models = reactive<BackendModelConfig[]>([
      {
        name: "qwen-main",
        displayName: "Qwen",
        baseUrl: "https://example/v1",
        apiKeys: ["sk-1"],
        modelName: "qwen3",
        timeout: "PT300S",
        maxRetries: 3,
        customRequestParameters: {},
        temperature: null,
        topP: null,
        maxTokens: null,
        maxCompletionTokens: null,
      },
    ]);
    const wrapper = mountBackend(models);
    expect(wrapper.find(".model-name").text()).toBe("Qwen");
    expect(wrapper.find(".model-main .model-id").text()).toBe("qwen-main");

    await button(wrapper, t("common.edit"))!.trigger("click");
    const [idInput, displayInput] = wrapper.findAll("section input");
    expect(idInput!.attributes("disabled")).toBeDefined();
    await displayInput!.setValue("Qwen Max");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(models[0]).toMatchObject({ name: "qwen-main", displayName: "Qwen Max" });
    // 显示名与 ID 相同时只显示一次。
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("qwen-main");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(wrapper.find(".model-main").text()).toBe("qwen-main");
    expect(wrapper.find(".model-main .model-id").exists()).toBe(false);

    // 新建时 ID 可填；ID、显示名与连接三项都填写后才能加入列表。
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const dialog = wrapper.find("section");
    const confirm = () => button(dialog, t("admin.addModel"))!;
    expect(dialog.findAll("input")[0]!.attributes("disabled")).toBeUndefined();
    await dialog.findAll("input")[0]!.setValue("deepseek-main");
    await dialog.findAll("input")[1]!.setValue("DeepSeek");
    expect(confirm().attributes("disabled")).toBeDefined();
    await fillBackendConnection(dialog);
    await confirm().trigger("click");
    expect(models[1]).toMatchObject({ name: "deepseek-main", displayName: "DeepSeek" });
  });

  it("reveals the full fake key and deletes several keys without shifting the rest", async () => {
    const models = reactive<BackendModelConfig[]>([
      {
        name: "qwen-main",
        displayName: "Qwen",
        baseUrl: "https://example/v1",
        apiKeys: ["sk-fake-1", "sk-fake-2", "sk-fake-3"],
        modelName: "qwen3",
        timeout: "PT300S",
        maxRetries: 3,
        customRequestParameters: {},
        temperature: null,
        topP: null,
        maxTokens: null,
        maxCompletionTokens: null,
      },
    ]);
    const wrapper = mountBackend(models);
    // 列表只显示数量，不出现密钥原文。
    expect(wrapper.text()).not.toContain("sk-fake");
    expect(wrapper.text()).toContain(t("admin.keyCountConfigured", { n: 3 }));

    await button(wrapper, t("common.edit"))!.trigger("click");
    const keyInputs = () => wrapper.findAll(".api-key-row input");
    const keyValues = () => keyInputs().map((input) => (input.element as HTMLInputElement).value);
    expect(keyInputs()[0]!.attributes("type")).toBe("password");
    await wrapper.find(".api-key-row .el-input__password").trigger("click");
    expect(keyInputs()[0]!.attributes("type")).toBe("text");
    expect(keyValues()[0]).toBe("sk-fake-1");

    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await wrapper.findAll(trash)[0]!.trigger("click");
    expect(keyValues()).toEqual(["sk-fake-2", "sk-fake-3"]);
    await wrapper.findAll(trash)[1]!.trigger("click");
    expect(keyValues()).toEqual(["sk-fake-2"]);
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(models[0]!.apiKeys).toEqual(["sk-fake-2"]);
  });

  it("exposes the outer save entry and reflects the saving state", async () => {
    const wrapper = mountBackend([]);
    await button(wrapper, t("admin.saveModelList"))?.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
    const saving = mountBackend([], { saving: true });
    expect(saving.find(".is-loading").exists()).toBe(true);
  });
});

describe("frontend system model card", () => {
  function mountSystem(extra: Record<string, unknown> = {}) {
    return track(
      mount(SystemModelConfigCard, {
        props: {
          model: {
            models: [],
            agents: { default: { model: "" }, diagnosis: { model: "" } },
            abcQuestionMode: "harness",
            queryTimeoutSeconds: 600,
            hasCustomConfig: false,
          },
          loading: false,
          saving: false,
          loadError: "",
          ...extra,
        },
        global,
      })
    );
  }

  it("hides the key plaintext and keeps empty/failed states apart", () => {
    const empty = mountSystem();
    expect(empty.text()).toContain(t("admin.modelListEmpty"));
    const failed = mountSystem({ loadError: "down" });
    expect(failed.text()).toContain(t("admin.modelListLoadFailed"));
    expect(button(failed, t("admin.saveApplicationModels"))?.attributes("disabled")).toBeDefined();
  });

  it("offers the system and diagnosis model selects but no query settings", () => {
    const wrapper = mountSystem();
    expect(wrapper.text()).toContain(t("admin.systemModel"));
    expect(wrapper.text()).toContain(t("admin.diagnosisModel"));
    expect(wrapper.text()).not.toContain(t("admin.queryMode"));
    expect(wrapper.text()).not.toContain(t("admin.queryTimeoutSec"));
    expect(wrapper.findAll(".el-input-number")).toHaveLength(0);
  });

  it("marks the section unsaved when either role reference changes", async () => {
    const model = reactive({
      models: [],
      agents: { default: { model: "" }, diagnosis: { model: "" } },
      abcQuestionMode: "harness" as const,
      queryTimeoutSeconds: 600,
      hasCustomConfig: false,
    });
    const wrapper = track(
      mount(SystemModelConfigCard, {
        props: { model, loading: false, saving: false, loadError: "" },
        global,
      })
    );
    expect(wrapper.find(".dirty-tag").exists()).toBe(false);
    // The diagnosis reference is tracked on its own, not only the system one.
    model.agents.diagnosis.model = "diag";
    await flushPromises();
    expect(wrapper.find(".dirty-tag").exists()).toBe(true);
    model.agents.diagnosis.model = "";
    await flushPromises();
    expect(wrapper.find(".dirty-tag").exists()).toBe(false);
    model.agents.default.model = "main";
    await flushPromises();
    expect(wrapper.find(".dirty-tag").exists()).toBe(true);
  });

  it("fixes the config ID, edits the display name and labels duplicate names by ID", async () => {
    const model = reactive({
      models: [
        {
          name: "default",
          displayName: "GPT",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-secret",
          modelName: "gpt-4o",
          customRequestParameters: {},
          timeoutSeconds: 300,
          maxRetries: 3,
          contextWindow: 256000,
        },
        {
          name: "backup",
          displayName: "GPT",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          modelName: "gpt-4o-mini",
          customRequestParameters: {},
          timeoutSeconds: 300,
          maxRetries: 3,
          contextWindow: 256000,
        },
        {
          name: "legacy",
          displayName: "legacy",
          baseUrl: "",
          apiKey: "",
          modelName: "",
          customRequestParameters: {},
          timeoutSeconds: 300,
          maxRetries: 3,
          contextWindow: 256000,
        },
      ],
      agents: { default: { model: "default" }, diagnosis: { model: "default" } },
      abcQuestionMode: "harness" as const,
      queryTimeoutSeconds: 600,
      hasCustomConfig: false,
    });
    const wrapper = track(
      mount(SystemModelConfigCard, {
        props: { model, loading: false, saving: false, loadError: "" },
        global: {
          ...global,
          stubs: {
            ...global.stubs,
            "el-tooltip": { template: '<span><slot /><slot name="content" /></span>' },
          },
        },
      })
    );
    expect(wrapper.text()).not.toContain("sk-secret");
    expect(wrapper.text()).toContain(t("admin.keyCountConfigured", { n: 1 }));
    // 重名附 ID 区分；显示名与 ID 相同只显示一次。
    expect(wrapper.findAll(".model-main").map((main) => main.text())).toEqual([
      "GPTdefault",
      "GPTbackup",
      "legacy",
    ]);
    const options = () =>
      wrapper
        .findAllComponents({ name: "ElOption" })
        .map((option) => [option.props("label"), option.props("value")]);
    // 系统模型与诊断模型两个角色选择同一模型库。
    const library = [
      ["GPT (default)", "default"],
      ["GPT (backup)", "backup"],
      ["legacy", "legacy"],
    ];
    expect(options()).toEqual([...library, ...library]);

    await button(wrapper, t("common.edit"))!.trigger("click");
    const [idInput, displayInput] = wrapper.find("section").findAll("input");
    expect(idInput!.attributes("disabled")).toBeDefined();
    await displayInput!.setValue("GPT Main");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(model.models[0]).toMatchObject({
      name: "default",
      displayName: "GPT Main",
      apiKey: "sk-secret",
    });
    expect(model.agents.default.model).toBe("default");
    expect(options()[0]).toEqual(["GPT Main (default)", "default"]);

    // 新建时 ID 可填；ID、显示名与连接三项都填写后才能加入列表。
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const dialog = wrapper.find("section");
    const confirm = () => button(dialog, t("admin.addModel"))!;
    expect(dialog.findAll("input")[0]!.attributes("disabled")).toBeUndefined();
    await dialog.findAll("input")[0]!.setValue("claude");
    await dialog.findAll("input")[1]!.setValue("GPT");
    expect(confirm().attributes("disabled")).toBeDefined();
    await fillConnection(dialog);
    await confirm().trigger("click");
    expect(model.models[3]).toMatchObject({ name: "claude", displayName: "GPT" });
  });
});

describe("query settings card", () => {
  it("tracks only its two fields and clears the marker when reverted", async () => {
    const model = reactive({
      models: [],
      agents: { default: { model: "" }, diagnosis: { model: "" } },
      abcQuestionMode: "harness" as const,
      queryTimeoutSeconds: 600,
      hasCustomConfig: false,
    });
    const wrapper = track(
      mount(QuerySettingsCard, {
        props: { model, loading: false, saving: false, loadError: "" },
        global,
      })
    );
    const input = wrapper.find(".el-input-number input");
    expect(wrapper.find(".dirty-tag").exists()).toBe(false);
    await input.setValue("900");
    expect(model.queryTimeoutSeconds).toBe(900);
    expect(wrapper.find(".dirty-tag").exists()).toBe(true);
    await input.setValue("600");
    expect(wrapper.find(".dirty-tag").exists()).toBe(false);
    // 应用模型草稿变化不算本区未保存。
    model.agents.default.model = "other";
    await flushPromises();
    expect(wrapper.find(".dirty-tag").exists()).toBe(false);
  });

  it("shows the load error with retry and blocks save", async () => {
    const wrapper = track(
      mount(QuerySettingsCard, {
        props: {
          model: { ...fixtures.system, abcQuestionMode: "harness" as const },
          loading: false,
          saving: false,
          loadError: "node down",
        },
        global,
      })
    );
    expect(wrapper.find(".load-error").text()).toContain("node down");
    expect(button(wrapper, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(wrapper, t("common.retry"))!.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});

describe("backend agent reference card", () => {
  function mountRoles(extra: Record<string, unknown> = {}) {
    const agents = reactive(
      Object.fromEntries(agentKeys.map((key) => [key, { model: "qwen-main", actorCopies: 1 }]))
    ) as Record<string, { model: string; actorCopies: number }>;
    return {
      agents,
      wrapper: track(
        mount(BackendAgentConfigCard, {
          props: {
            agents,
            models: [
              { name: "qwen-main", displayName: "Qwen" },
              { name: "qwen-lite", displayName: "Qwen" },
              { name: "legacy", displayName: "legacy" },
            ],
            saving: false,
            disabled: false,
            ...extra,
          },
          global,
        })
      ),
    };
  }

  it("renders the five roles as one list and saves them together", async () => {
    const { wrapper } = mountRoles();
    expect(wrapper.text()).toContain(t("admin.agentRoles.normalChat"));
    expect(wrapper.text()).toContain(t("admin.agentRoles.toolChat"));
    await button(wrapper, t("admin.saveAgentModels"))!.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });

  it("does not offer tests or per-role saves", () => {
    const { wrapper } = mountRoles();
    expect(wrapper.text()).not.toContain(t("common.testModel"));
    expect(wrapper.text()).not.toContain(t("common.saveConfig"));
    expect(wrapper.findAll(".el-tabs__item")).toHaveLength(0);
  });

  it("blocks the single save while a role reference is still unselected", async () => {
    const { agents, wrapper } = mountRoles();
    agents.pythonChat.model = "";
    await flushPromises();
    const save = button(wrapper, t("admin.saveAgentModels"))!;
    expect(save.attributes("disabled")).toBeDefined();
    await save.trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("uses the config ID as option value and shows it beside duplicate display names", async () => {
    // 选项渲染在下拉浮层的 content 插槽里，这里让 tooltip 桩一并渲染它。
    const wrapper = track(
      mount(BackendAgentConfigCard, {
        props: {
          agents: mountRoles().agents,
          models: [
            { name: "qwen-main", displayName: "Qwen" },
            { name: "qwen-lite", displayName: "Qwen" },
            { name: "legacy", displayName: "legacy" },
          ],
          saving: false,
          disabled: false,
        },
        global: {
          ...global,
          stubs: {
            ...global.stubs,
            "el-tooltip": { template: '<span><slot /><slot name="content" /></span>' },
          },
        },
      })
    );
    const options = wrapper
      .findAllComponents({ name: "ElOption" })
      .slice(0, 3)
      .map((option) => [option.props("label"), option.props("value")]);
    expect(options).toEqual([
      ["Qwen (qwen-main)", "qwen-main"],
      ["Qwen (qwen-lite)", "qwen-lite"],
      ["legacy", "legacy"],
    ]);
  });

  it("labels every role select with its role name", () => {
    const { wrapper } = mountRoles();
    const labels = wrapper
      .findAllComponents({ name: "ElSelect" })
      .map((select) => select.props("ariaLabel"));
    expect(labels).toEqual(agentKeys.map((key) => t(`admin.agentRoles.${key}`)));
  });
});

describe("embedding model card", () => {
  function mountEmbedding(extra: Record<string, unknown> = {}) {
    const model = reactive<EmbeddingModelConfig>({ ...fixtures.embedding });
    return {
      model,
      wrapper: track(
        mount(EmbeddingModelConfigCard, {
          props: { model, loading: false, saving: false, loadError: "", ...extra },
          global,
        })
      ),
    };
  }

  it("shows one compact row with the key masked and keeps unshown fields when editing", async () => {
    const { wrapper } = mountEmbedding();
    expect(wrapper.findAll(".model-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("text-embedding-v3");
    expect(wrapper.text()).not.toContain("sk-embed");
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.find("section input").setValue("https://proxy.example/v1");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    const updated = wrapper.emitted("update:model")![0]![0] as EmbeddingModelConfig;
    expect(updated.baseUrl).toBe("https://proxy.example/v1");
    expect(updated.timeout).toBe("PT300S");
    // 弹窗只覆盖展示的4个字段，customHeaders 等未展示字段必须原样保留。
    expect(updated.customHeaders).toEqual({ "X-Embed-Key": "keep" });
    await button(wrapper, t("common.saveConfig"))!.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });

  it("offers the row test entry", async () => {
    const { wrapper } = mountEmbedding();
    await button(wrapper, t("common.testModel"))!.trigger("click");
    expect(wrapper.emitted("test")).toHaveLength(1);
  });

  it("does not fake a model row while loading or after a load failure", async () => {
    const loading = mountEmbedding({ loading: true });
    expect(loading.wrapper.findAll(".model-item")).toHaveLength(0);
    const failed = mountEmbedding({ loadError: "down" });
    expect(failed.wrapper.findAll(".model-item")).toHaveLength(0);
    expect(failed.wrapper.text()).toContain("down");
    expect(button(failed.wrapper, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(failed.wrapper, t("common.retry"))!.trigger("click");
    expect(failed.wrapper.emitted("retry")).toHaveLength(1);
  });

  it("shows an add entry when no embedding model is configured", async () => {
    const { wrapper } = mountEmbedding({ model: null });
    expect(wrapper.findAll(".model-item")).toHaveLength(0);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    expect(button(wrapper, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    await wrapper.find("section").findAll("input")[0]!.setValue("https://new.example/v1");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    const updated = wrapper.emitted("update:model")![0]![0] as EmbeddingModelConfig;
    expect(updated.baseUrl).toBe("https://new.example/v1");
    expect(updated.modelName).toBe("");
    expect(updated.timeout).toBe("PT300S");
  });
});

describe("skill directory card", () => {
  it("keeps an independent draft and save entry", async () => {
    const skilldir = reactive({ value: "skills/legacy" });
    const wrapper = track(
      mount(SkillDirConfigCard, {
        props: { skilldir: skilldir.value, saving: false, disabled: false },
        global,
      })
    );
    await wrapper.find("input").setValue("skills/aftercalculate");
    await button(wrapper, t("common.saveConfig"))!.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });
});

describe("password visibility with the real dialog", () => {
  // 不替换 ElDialog/teleport：验证真实关闭销毁与密钥行重建后，密码输入回到默认隐藏。
  const realDialog = { plugins: [i18n, ElementPlus], stubs: { transition: false } };
  // 弹窗打开/关闭经由定时器与过渡完成。
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  };
  const backendEntry = (name: string, apiKeys: string[]): BackendModelConfig => ({
    name,
    displayName: name,
    baseUrl: "https://example/v1",
    apiKeys,
    modelName: "qwen3",
    timeout: "PT300S",
    maxRetries: 3,
    customRequestParameters: {},
    temperature: null,
    topP: null,
    maxTokens: null,
    maxCompletionTokens: null,
  });
  const keyTypes = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => input.attributes("type"));
  const keyValues = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => (input.element as HTMLInputElement).value);

  it("keeps remaining keys hidden after deleting a revealed row and when reopening another entry", async () => {
    const models = reactive([
      backendEntry("a", ["sk-fake-1", "sk-fake-2", "sk-fake-3"]),
      backendEntry("b", ["sk-fake-9"]),
    ]);
    const wrapper = track(
      mount(BackendModelListCard, {
        props: { models, saving: false, loading: false, loadError: "" },
        global: realDialog,
        attachTo: document.body,
      })
    );
    const edits = () => wrapper.findAll("button").filter((b) => b.text() === t("common.edit"));
    await edits()[0]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password", "password", "password"]);

    // 显示第1、2行后删第1行：剩余行默认隐藏，值不错位。
    await wrapper.findAll(".api-key-row .el-input__password")[0]!.trigger("click");
    await wrapper.findAll(".api-key-row .el-input__password")[1]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["text", "text", "password"]);
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await wrapper.findAll(trash)[0]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["password", "password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-2", "sk-fake-3"]);
    await wrapper.find(".api-key-row .el-input__password").trigger("click");
    expect(keyTypes(wrapper)).toEqual(["text", "password"]);
    expect(keyValues(wrapper)[0]).toBe("sk-fake-2");

    // 关闭后打开另一条目：显示状态不继承。
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await settle();
    await edits()[1]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-9"]);
  });

  it("re-hides the application and embedding keys when their editor is reopened", async () => {
    const system = track(
      mount(SystemModelConfigCard, {
        props: {
          model: reactive(JSON.parse(JSON.stringify(fixtures.system))),
          loading: false,
          saving: false,
          loadError: "",
        },
        global: realDialog,
        attachTo: document.body,
      })
    );
    const embedding = track(
      mount(EmbeddingModelConfigCard, {
        props: { model: { ...fixtures.embedding }, loading: false, saving: false, loadError: "" },
        global: realDialog,
        attachTo: document.body,
      })
    );
    for (const [wrapper, key] of [
      [system, "sk-preview"],
      [embedding, "sk-embed"],
    ] as const) {
      const keyInput = () =>
        wrapper.find(
          ".el-dialog input[type='password'], .el-dialog input[type='text'][placeholder='sk-...']"
        );
      await button(wrapper, t("common.edit"))!.trigger("click");
      await settle();
      await wrapper.find(".el-dialog .el-input__password").trigger("click");
      expect(keyInput().attributes("type")).toBe("text");
      expect((keyInput().element as HTMLInputElement).value).toBe(key);
      await button(wrapper, t("common.cancel"))!.trigger("click");
      await settle();
      await button(wrapper, t("common.edit"))!.trigger("click");
      await settle();
      expect(keyInput().attributes("type")).toBe("password");
      expect((keyInput().element as HTMLInputElement).value).toBe(key);
    }
  });
});

describe("business config page wiring", () => {
  it("groups application and query engine models, embedding as a card, query settings under other", async () => {
    const wrapper = await mountPage();
    const labels = wrapper.findAll(".el-tabs__item").map((item) => item.text());
    expect(labels).toEqual([
      t("admin.modelConfig"),
      t("admin.otherSettings"),
      t("admin.applicationModels"),
      t("admin.queryEngineModels"),
    ]);
    expect(labels.join(" ")).not.toMatch(/Frontend|Backend|前端|后端|Embedding/);

    const modelPanes = wrapper.find(".model-type-tabs").findAll(".el-tab-pane");
    expect(modelPanes).toHaveLength(2);
    const [application, queryEngine] = modelPanes;
    expect(application!.findComponent(SystemModelConfigCard).exists()).toBe(true);
    expect(application!.findComponent(BackendModelListCard).exists()).toBe(false);
    expect(queryEngine!.findComponent(BackendModelListCard).exists()).toBe(true);
    expect(queryEngine!.findComponent(BackendAgentConfigCard).exists()).toBe(true);
    expect(queryEngine!.findComponent(EmbeddingModelConfigCard).exists()).toBe(true);

    const other = wrapper.findAll(".el-tab-pane").at(-1)!;
    expect(other.findComponent(QuerySettingsCard).exists()).toBe(true);
    expect(other.findComponent(SkillDirConfigCard).exists()).toBe(true);
    expect(other.findComponent(EmbeddingModelConfigCard).exists()).toBe(false);
    expect(other.findComponent(SystemModelConfigCard).exists()).toBe(false);
  });

  it("saves application models and query settings as isolated partial updates", async () => {
    const wrapper = await mountPage();
    const application = wrapper.findComponent(SystemModelConfigCard);
    const query = wrapper.findComponent(QuerySettingsCard);
    const timeout = query.find(".el-input-number input");
    await timeout.setValue("900");
    await button(application, t("common.delete"))!.trigger("click");
    expect(application.find(".dirty-tag").exists()).toBe(true);
    expect(query.find(".dirty-tag").exists()).toBe(true);

    await button(application, t("admin.saveApplicationModels"))!.trigger("click");
    await flushPromises();
    expect(Object.keys(savedPayload.system as object)).toEqual(["models", "agents"]);
    // 问数设置草稿与未保存标记保留。
    expect(application.find(".dirty-tag").exists()).toBe(false);
    expect(query.find(".dirty-tag").exists()).toBe(true);
    expect((timeout.element as HTMLInputElement).value).toBe("900");

    await button(application, t("admin.addModel"))!.trigger("click");
    await application.findAll("section input")[0]!.setValue("draft-app");
    await application.findAll("section input")[1]!.setValue("Draft App");
    await fillConnection(application.find("section"));
    await button(application.find("section"), t("admin.addModel"))!.trigger("click");
    await button(query, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.system).toEqual({ abcQuestionMode: "harness", queryTimeoutSeconds: 900 });
    expect(query.find(".dirty-tag").exists()).toBe(false);
    // 应用模型草稿不被问数设置的保存响应覆盖。
    expect(application.text()).toContain("draft-app");
    expect(application.find(".dirty-tag").exists()).toBe(true);
  });

  it("offers roles only the saved models and never a draft model", async () => {
    const wrapper = await mountPage();
    const roles = wrapper.findComponent(BackendAgentConfigCard);
    const roleIds = () => (roles.props("models") as Array<{ name: string }>).map((m) => m.name);
    expect(roleIds()).toEqual(["qwen-main", "qwen-lite"]);

    const list = wrapper.findComponent(BackendModelListCard);
    await button(list, t("admin.addModel"))!.trigger("click");
    const addDialog = list.find("section");
    await addDialog.findAll("input")[0]!.setValue("draft-new");
    await addDialog.findAll("input")[1]!.setValue("Draft");
    await fillBackendConnection(addDialog);
    await button(addDialog, t("admin.addModel"))!.trigger("click");
    expect(roleIds()).toEqual(["qwen-main", "qwen-lite"]);

    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();
    expect(roleIds()).toEqual(["qwen-main", "qwen-lite", "draft-new"]);
  });

  it("renaming a display name keeps role references on the config ID", async () => {
    const wrapper = await mountPage();
    const list = wrapper.findComponent(BackendModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.findAll("section input")[1]!.setValue("Qwen Max");
    await button(list, t("admin.doneEdit"))!.trigger("click");
    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();
    expect((savedPayload.models as BackendModelConfig[])[0]).toMatchObject({
      name: "qwen-main",
      displayName: "Qwen Max",
    });
    const roles = wrapper.findComponent(BackendAgentConfigCard);
    expect(roles.props("models")).toEqual([
      { name: "qwen-main", displayName: "Qwen Max" },
      { name: "qwen-lite", displayName: "Qwen" },
    ]);
    await button(roles, t("admin.saveAgentModels"))!.trigger("click");
    await flushPromises();
    expect((savedPayload.roleModels as Record<string, string>).normalChat).toBe("qwen-main");
  });

  it("saves the five role references in one request without actorCopies or skilldir", async () => {
    const wrapper = await mountPage();
    await button(
      wrapper.findComponent(BackendAgentConfigCard),
      t("admin.saveAgentModels")
    )!.trigger("click");
    await flushPromises();
    const sent = savedPayload.roleModels as Record<string, string>;
    expect(Object.keys(sent)).toEqual([
      "normalChat",
      "questionSpliter",
      "cleverNormalChat",
      "pythonChat",
      "toolChat",
    ]);
    expect(sent).toEqual({
      normalChat: "qwen-main",
      questionSpliter: "qwen-main",
      cleverNormalChat: "qwen-main",
      pythonChat: "qwen-main",
      toolChat: "qwen-main",
    });
    expect(JSON.stringify(sent)).not.toContain("actorCopies");
    expect(savedPayload.models).toBeNull();
  });

  it("saves the skill directory alone from the other settings pane", async () => {
    const wrapper = await mountPage();
    const skill = wrapper.findComponent(SkillDirConfigCard);
    expect((skill.find("input").element as HTMLInputElement).value).toBe("skills/legacy");
    await button(skill, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.skilldir).toBe("skills/legacy");
    expect(savedPayload.roleModels).toBeNull();
  });

  it("saves the embedding draft as a full snapshot", async () => {
    const wrapper = await mountPage();
    const embedding = wrapper.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await button(embedding, t("admin.doneEdit"))!.trigger("click");
    await button(embedding, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.embedding).toMatchObject({
      baseUrl: fixtures.embedding.baseUrl,
      apiKey: "sk-embed-2",
      modelName: "text-embedding-v3",
      timeout: "PT300S",
      // 后端支持但弹窗不展示的字段不能在保存时丢失。
      customHeaders: { "X-Embed-Key": "keep" },
    });
  });

  it("tests the embedding row through its own list entry", async () => {
    const wrapper = await mountPage();
    await button(wrapper.findComponent(EmbeddingModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    const testDialog = wrapper.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    const tested = savedPayload.embeddingTest as { modelConfig: Record<string, unknown> };
    expect(tested.modelConfig.modelName).toBe("text-embedding-v3");
    expect(tested.modelConfig.customHeaders).toEqual({ "X-Embed-Key": "keep" });
  });

  it("keeps unsaved role, skill and embedding drafts when the model list is saved", async () => {
    const wrapper = await mountPage();
    const roles = wrapper.findComponent(BackendAgentConfigCard);
    const roleSelect = roles.findAllComponents({ name: "ElSelect" })[0]!;
    roleSelect.vm.$emit("update:modelValue", "qwen-lite");
    const skill = wrapper.findComponent(SkillDirConfigCard);
    await skill.find("input").setValue("skills/draft");
    const embedding = wrapper.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[0]!.setValue("https://draft.example/v1");
    await button(embedding, t("admin.doneEdit"))!.trigger("click");

    await button(wrapper.findComponent(BackendModelListCard), t("admin.saveModelList"))!.trigger(
      "click"
    );
    await flushPromises();

    // 保存后按服务端整理结果重读模型列表，未保存的其它区域草稿必须原样保留。
    expect(calls.getConfig).toBe(2);
    expect(roles.props("agents").normalChat.model).toBe("qwen-lite");
    expect((skill.find("input").element as HTMLInputElement).value).toBe("skills/draft");
    expect((embedding.props("model") as EmbeddingModelConfig).baseUrl).toBe(
      "https://draft.example/v1"
    );
  });

  it("deletes keys as plain array items so re-read, test and save all use the same raw values", async () => {
    const wrapper = await mountPage();
    const list = wrapper.findComponent(BackendModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await list.findAll(trash)[1]!.trigger("click");
    await button(list, t("admin.doneEdit"))!.trigger("click");
    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();
    expect((savedPayload.models as BackendModelConfig[])[0]!.apiKeys).toEqual(["", "sk-fake-cd34"]);
    expect(calls.getConfig).toBe(2);
    expect((list.props("models") as BackendModelConfig[])[0]!.apiKeys).toEqual([
      "",
      "sk-fake-cd34",
    ]);

    await button(list, t("common.testModel"))!.trigger("click");
    const testDialog = wrapper.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    expect((savedPayload.test as { model: BackendModelConfig }).model.apiKeys).toEqual([
      "",
      "sk-fake-cd34",
    ]);
  });

  it("keeps an explicit error and blocks resubmission when the post-save re-read fails", async () => {
    const wrapper = await mountPage();
    const roles = wrapper.findComponent(BackendAgentConfigCard);
    roles.findAllComponents({ name: "ElSelect" })[0]!.vm.$emit("update:modelValue", "qwen-lite");
    server.failNextRead = true;
    const list = wrapper.findComponent(BackendModelListCard);
    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();

    expect(savedPayload.models).not.toBeNull();
    expect(calls.getConfig).toBe(2);
    // 持久错误说明，而不是只靠 toast。
    expect(list.find(".load-error").text()).toContain("reread down");
    // 重读失败时本地视图未与服务端对齐，不允许再提交。
    savedPayload.models = null;
    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.models).toBeNull();
    expect(button(list, t("admin.addModel"))!.attributes("disabled")).toBeDefined();
    // 其它区域未保存草稿不受影响。
    expect(roles.props("agents").normalChat.model).toBe("qwen-lite");

    // 重试只重读模型列表；成功后才恢复可写，不静默当成功。
    await button(list, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(calls.getConfig).toBe(3);
    expect(list.find(".load-error").exists()).toBe(false);
    expect(button(list, t("admin.saveModelList"))!.attributes("disabled")).toBeUndefined();
  });

  it("keeps drafts when a role save fails", async () => {
    const wrapper = await mountPage();
    vi.mocked(adminApi.saveBackendAgentModels).mockResolvedValueOnce({
      success: false,
      message: "boom",
    });
    const skill = wrapper.findComponent(SkillDirConfigCard);
    await skill.find("input").setValue("skills/draft");
    await button(
      wrapper.findComponent(BackendAgentConfigCard),
      t("admin.saveAgentModels")
    )!.trigger("click");
    await flushPromises();
    expect((skill.find("input").element as HTMLInputElement).value).toBe("skills/draft");
    expect(calls.getConfig).toBe(1);
  });

  it("disables every write entry and keeps a persistent error when the config fails to load", async () => {
    vi.mocked(adminApi.getBusinessConfig).mockResolvedValueOnce({
      success: false,
      message: "legacy role params",
    });
    const wrapper = await mountPage();
    const list = wrapper.findComponent(BackendModelListCard);
    expect(list.text()).toContain("legacy role params");
    expect(button(list, t("admin.saveModelList"))!.attributes("disabled")).toBeDefined();
    expect(
      button(wrapper.findComponent(BackendAgentConfigCard), t("admin.saveAgentModels"))!.attributes(
        "disabled"
      )
    ).toBeDefined();
    expect(
      button(wrapper.findComponent(SkillDirConfigCard), t("common.saveConfig"))!.attributes(
        "disabled"
      )
    ).toBeDefined();
    const embedding = wrapper.findComponent(EmbeddingModelConfigCard);
    expect(button(embedding, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    // 嵌入区与其它配置区都要有不依赖 toast 的错误说明和重试入口。
    expect(embedding.find(".load-error").text()).toContain("legacy role params");
    expect(embedding.findAll(".model-item")).toHaveLength(0);
    const banner = wrapper.find(".config-load-error");
    expect(banner.text()).toContain("legacy role params");
    expect(button(banner, t("common.retry"))).toBeTruthy();

    await button(embedding, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(embedding.find(".load-error").exists()).toBe(false);
    expect(embedding.findAll(".model-item")).toHaveLength(1);
  });

  it("does not save anything when switching navigation", async () => {
    const wrapper = await mountPage();
    const otherTab = wrapper
      .findAll(".el-tabs__item")
      .find((item) => item.text() === t("admin.otherSettings"))!;
    await otherTab.trigger("click");
    const queryEngineTab = wrapper
      .findAll(".el-tabs__item")
      .find((item) => item.text() === t("admin.queryEngineModels"))!;
    await queryEngineTab.trigger("click");
    await flushPromises();
    expect(savedPayload.models).toBeNull();
    expect(savedPayload.roleModels).toBeNull();
    expect(savedPayload.skilldir).toBeNull();
    expect(savedPayload.embedding).toBeNull();
    expect(savedPayload.system).toBeNull();
  });

  it("titles every test dialog as a model test named after the selected entry", async () => {
    const wrapper = await mountPage();
    const dialogs = () => wrapper.findAllComponents({ name: "ElDialog" });
    const title = () =>
      dialogs()
        .find((d) => d.props("modelValue"))!
        .props("title") as string;
    await button(wrapper.findComponent(SystemModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: "GPT-4o (default)" }));
    await button(wrapper.findAll("section").at(-1)!, t("common.close"))!.trigger("click");
    await button(wrapper.findComponent(BackendModelListCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: "Qwen (qwen-main)" }));
    await button(wrapper.findAll("section").at(-1)!, t("common.close"))!.trigger("click");
    await button(wrapper.findComponent(EmbeddingModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: t("admin.embeddingModelConfig") }));
    expect(
      dialogs()
        .map((d) => d.props("title") as string)
        .join(" ")
    ).not.toMatch(/后端|系统模型|Backend|System/);
  });

  it("backend edit, save and test keep opaque customs, raw keys and untouched values", async () => {
    const wrapper = await mountPage();
    const list = wrapper.findComponent(BackendModelListCard);
    expect(list.text()).toContain("qwen-main");
    await button(list, t("common.edit"))!.trigger("click");
    await button(list, t("admin.doneEdit"))!.trigger("click");
    expect(list.find(".dirty-tag").exists()).toBe(false);
    await button(list, t("common.edit"))!.trigger("click");
    const dialog = list.find("section");
    // 输入依次是配置 ID、显示名、连接地址。
    await dialog.findAll("input")[2]?.setValue("https://new.example.com/v1");
    // 存量 maxRetries 99 超出控件 max：加载与展示都不夹紧。
    const numberInputs = dialog.findAll(".el-input-number input");
    expect((numberInputs[1]?.element as HTMLInputElement).value).toBe("99");
    // 删除即删项；未动的空字符串保留在原位。
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await dialog.findAll(trash)[1]?.trigger("click");
    await button(list, t("admin.doneEdit"))!.trigger("click");
    await button(list, t("common.testModel"))!.trigger("click");
    const testDialog = wrapper.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    const tested = savedPayload.test as { model: Record<string, unknown> };
    expect(tested.model.apiKeys).toEqual(["", "sk-fake-cd34"]);
    expect(JSON.stringify(tested.model.customRequestParameters)).toBe(BACKEND_CUSTOMS);
    await button(testDialog, t("common.close"))!.trigger("click");
    await button(list, t("admin.saveModelList"))!.trigger("click");
    await flushPromises();
    const sent = (savedPayload.models as Array<Record<string, unknown>>)[0]!;
    expect(sent.baseUrl).toBe("https://new.example.com/v1");
    expect(sent.temperature).toBe(0.7);
    expect(sent.maxRetries).toBe(99);
    expect(sent.apiKeys).toEqual(["", "sk-fake-cd34"]);
    expect(JSON.stringify(sent.customRequestParameters)).toBe(BACKEND_CUSTOMS);
    expect(sent).toMatchObject({
      organizationId: "org-existing",
      projectId: "project-existing",
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
    });
  });

  it("edits context windows and saves distinct system and diagnosis references in the model section", async () => {
    const wrapper = await mountPage();
    const application = wrapper.findComponent(SystemModelConfigCard);
    // 输入依次是配置 ID、显示名、连接地址、Key、API 模型标识、超时、重试、上下文窗口。
    await button(application, t("common.edit"))!.trigger("click");
    const editInputs = application.find("section").findAll("input");
    expect((editInputs[7]!.element as HTMLInputElement).value).toBe("256000");
    await editInputs[7]!.setValue("200000");
    await button(application, t("admin.doneEdit"))!.trigger("click");

    await button(application, t("admin.addModel"))!.trigger("click");
    const addInputs = application.find("section").findAll("input");
    await addInputs[0]!.setValue("diag");
    await addInputs[1]!.setValue("Diagnosis");
    await fillConnection(application.find("section"));
    await addInputs[7]!.setValue("64000");
    await button(application.find("section"), t("admin.addModel"))!.trigger("click");

    const [systemRole, diagnosisRole] = application.findAllComponents({ name: "ElSelect" });
    diagnosisRole!.vm.$emit("update:modelValue", "diag");
    await flushPromises();
    expect(systemRole!.props("modelValue")).toBe("default");
    expect(application.find(".dirty-tag").exists()).toBe(true);

    await button(application, t("admin.saveApplicationModels"))!.trigger("click");
    await flushPromises();
    const saved = savedPayload.system as {
      models: Array<Record<string, unknown>>;
      agents: unknown;
    };
    expect(saved.models.map((entry) => [entry.name, entry.contextWindow])).toEqual([
      ["default", 200000],
      ["diag", 64000],
    ]);
    expect(saved.agents).toEqual({ default: { model: "default" }, diagnosis: { model: "diag" } });
    expect(application.find(".dirty-tag").exists()).toBe(false);
  });

  it("frontend save and test keep the config ID, the renamed display name and opaque customs", async () => {
    const wrapper = await mountPage();
    const frontend = wrapper.findComponent(SystemModelConfigCard);
    await button(frontend, t("common.edit"))!.trigger("click");
    // 输入依次是配置 ID、显示名、连接地址。
    await frontend.find("section").findAll("input")[1]!.setValue("GPT-4o Main");
    await frontend.find("section").findAll("input")[2]!.setValue("https://new.example/v1");
    const editedCustoms = JSON.stringify({
      ...JSON.parse(FRONTEND_CUSTOMS),
      model: "payload-model",
      temperature: null,
    });
    await frontend
      .find(".custom-request-parameters-editor .el-collapse-item__header")
      .trigger("click");
    await frontend.find("section textarea").setValue(editedCustoms);
    await button(frontend, t("admin.doneEdit"))!.trigger("click");
    expect(frontend.find(".dirty-tag").exists()).toBe(true);
    await button(frontend, t("admin.saveApplicationModels"))!.trigger("click");
    await flushPromises();
    expect(frontend.find(".dirty-tag").exists()).toBe(false);
    const saved = savedPayload.system as {
      models: Array<Record<string, unknown>>;
      agents: unknown;
    };
    expect(saved.models[0]).toMatchObject({
      name: "default",
      displayName: "GPT-4o Main",
      baseUrl: "https://new.example/v1",
    });
    expect(saved.agents).toEqual({
      default: { model: "default" },
      diagnosis: { model: "default" },
    });
    expect(JSON.stringify(saved.models[0]!.customRequestParameters)).toBe(editedCustoms);
    await button(frontend, t("common.testModel"))!.trigger("click");
    const testDialog = wrapper.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    const tested = savedPayload.test as Record<string, unknown>;
    expect(JSON.stringify(tested.customRequestParameters)).toBe(editedCustoms);
    expect(tested.apiKey).toBe("sk-preview");
  });
});
