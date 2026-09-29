import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import BackendModelListCard from "../business-config/BackendModelListCard.vue";
import SystemModelConfigCard from "../business-config/SystemModelConfigCard.vue";
import RoleReferencesCard from "../business-config/RoleReferencesCard.vue";
import BackendAgentConfigCard from "../business-config/BackendAgentConfigCard.vue";
import EmbeddingModelConfigCard from "../business-config/EmbeddingModelConfigCard.vue";
import SkillDirConfigCard from "../business-config/SkillDirConfigCard.vue";
import QuerySettingsCard from "../business-config/QuerySettingsCard.vue";
import BusinessConfig from "../BusinessConfig.vue";
import ModelConfig from "../ModelConfig.vue";
import ExamplesManager from "../../../admin/components/intelligence-engine/ExamplesManager.vue";
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

// Simulates the server-persisted model library: GET returns a copy (with full fake keys) and saves are stored as-is.
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
            dataAdapter: "postgresql",
            dataAdapterConnections: {},
          })
        ),
      };
    }),
    listDataAdapters: vi.fn(async () => ({
      success: true,
      data: [
        {
          type: "postgresql",
          label: "PostgreSQL",
          sql: true,
          fields: ["url", "user", "password"],
          examples: { url: "jdbc:postgresql://host:port/db", user: "postgres" },
        },
      ],
    })),
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

/** The three connection fields of the query engine model add dialog: URL, one added key, model name. */
async function fillBackendConnection(dialog: Pick<ReturnType<typeof mount>, "findAll">) {
  await dialog.findAll("input")[2]!.setValue("https://new.example/v1");
  await button(dialog, t("admin.addApiKey"))!.trigger("click");
  const inputs = dialog.findAll("input");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

/** The three connection fields of the application model add dialog (URL, key, model name) are required. */
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

async function mountModelPage() {
  const wrapper = track(mount(ModelConfig, { global }));
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
    // When the display name equals the ID it is shown only once.
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("qwen-main");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(wrapper.find(".model-main").text()).toBe("qwen-main");
    expect(wrapper.find(".model-main .model-id").exists()).toBe(false);

    // The ID is editable when creating; the entry joins the list only after the ID, display name and the three connection fields are filled in.
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
    // The list shows only the count, never the key text.
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
  });

  it("shows the model list without role selects or query settings", () => {
    const wrapper = mountSystem();
    expect(wrapper.text()).toContain(t("admin.modelList"));
    expect(wrapper.text()).not.toContain(t("admin.systemModel"));
    expect(wrapper.text()).not.toContain(t("admin.diagnosisModel"));
    expect(wrapper.text()).not.toContain(t("admin.queryMode"));
    expect(wrapper.text()).not.toContain(t("admin.queryTimeoutSec"));
    expect(wrapper.findAllComponents({ name: "ElSelect" })).toHaveLength(0);
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
    // Duplicate names get the ID appended; when the display name equals the ID it is shown once.
    expect(wrapper.findAll(".model-main").map((main) => main.text())).toEqual([
      "GPTdefault",
      "GPTbackup",
      "legacy",
    ]);

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

    // The ID is editable when creating; the entry joins the list only after the ID, display name and the three connection fields are filled in.
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
    // Application model draft changes do not count as unsaved in this section.
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
    expect(button(wrapper, t("common.save"))!.attributes("disabled")).toBeDefined();
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
    // Options render in the dropdown popper's content slot, so the tooltip stub renders it too.
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
    // The dialog overwrites only the 4 displayed fields; fields not shown, such as customHeaders, must be kept as-is.
    expect(updated.customHeaders).toEqual({ "X-Embed-Key": "keep" });
    await button(wrapper, t("common.save"))!.trigger("click");
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
    expect(button(failed.wrapper, t("common.save"))!.attributes("disabled")).toBeDefined();
    await button(failed.wrapper, t("common.retry"))!.trigger("click");
    expect(failed.wrapper.emitted("retry")).toHaveLength(1);
  });

  it("shows an add entry when no embedding model is configured", async () => {
    const { wrapper } = mountEmbedding({ model: null });
    expect(wrapper.findAll(".model-item")).toHaveLength(0);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    expect(button(wrapper, t("common.save"))!.attributes("disabled")).toBeDefined();
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
    await button(wrapper, t("common.save"))!.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });
});

describe("password visibility with the real dialog", () => {
  // ElDialog/teleport are not replaced: after a real close/destroy and rebuilt key rows, password inputs return to hidden by default.
  const realDialog = { plugins: [i18n, ElementPlus], stubs: { transition: false } };
  // Opening/closing the dialog completes through timers and transitions.
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

    // Reveal rows 1 and 2, then delete row 1: the remaining row is hidden by default and values do not shift.
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

    // Close, then open another entry: the visibility state is not inherited.
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
  it("model config page shows a single model list with role references at the same level", async () => {
    const wrapper = await mountModelPage();
    expect(wrapper.findAll(".el-tabs__item")).toHaveLength(0);
    expect(wrapper.findComponent(SystemModelConfigCard).exists()).toBe(true);
    expect(wrapper.findComponent(BackendModelListCard).exists()).toBe(false);
    expect(wrapper.findComponent(RoleReferencesCard).exists()).toBe(true);
    expect(wrapper.findComponent(EmbeddingModelConfigCard).exists()).toBe(true);
    expect(wrapper.findComponent(QuerySettingsCard).exists()).toBe(false);
    expect(wrapper.findComponent(SkillDirConfigCard).exists()).toBe(false);
    // Role references sit beside the model list: the system model card no longer embeds role selection.
    expect(
      wrapper.findComponent(SystemModelConfigCard).findAllComponents({ name: "ElSelect" })
    ).toHaveLength(0);
    // The only save button is in the Role model references card.
    expect(
      button(wrapper.findComponent(SystemModelConfigCard), t("common.save"))
    ).toBeUndefined();
    expect(
      button(wrapper.findComponent(RoleReferencesCard), t("common.save"))
    ).toBeTruthy();
  });

  it("system configuration page stacks settings cards and query examples without model cards", async () => {
    const wrapper = await mountPage();
    expect(wrapper.findComponent(QuerySettingsCard).exists()).toBe(true);
    expect(wrapper.findComponent(SkillDirConfigCard).exists()).toBe(true);
    expect(wrapper.findComponent(ExamplesManager).exists()).toBe(true);
    expect(wrapper.findComponent(SystemModelConfigCard).exists()).toBe(false);
    expect(wrapper.findComponent(BackendModelListCard).exists()).toBe(false);
    expect(wrapper.findComponent(EmbeddingModelConfigCard).exists()).toBe(false);
  });

  it("defaults every unset role to the first configured model", async () => {
    vi.mocked(adminApi.getBusinessConfig).mockResolvedValueOnce({
      success: true,
      data: {
        models: [],
        agents: {
          normalChat: { model: "" },
          questionSpliter: { model: "" },
          cleverNormalChat: { model: "" },
          pythonChat: { model: "" },
          toolChat: { model: "" },
        },
        embeddingModelProperties: fixtures.embedding,
      },
    });
    const wrapper = await mountModelPage();
    const roles = wrapper.findComponent(RoleReferencesCard);
    const queryAgents = roles.props("queryAgents") as Record<string, { model: string }>;
    expect(queryAgents.normalChat.model).toBe("default");
    expect(queryAgents.questionSpliter.model).toBe("default");
    expect(queryAgents.toolChat.model).toBe("default");
    const systemAgents = roles.props("systemAgents") as Record<string, { model: string }>;
    expect(systemAgents.default.model).toBe("default");
    expect(systemAgents.diagnosis.model).toBe("default");
  });

  it("single save in role references persists models, roles and forwards to the query engine", async () => {
    const wrapper = await mountModelPage();
    await button(wrapper.findComponent(RoleReferencesCard), t("common.save"))!.trigger("click");
    await flushPromises();
    expect(Object.keys(savedPayload.system as object).sort()).toEqual(["agents", "models"]);
    expect((savedPayload.models as Array<{ name: string }>).map((m) => m.name)).toEqual([
      "default",
    ]);
    expect(Object.keys(savedPayload.roleModels as object)).toEqual([
      "normalChat",
      "questionSpliter",
      "cleverNormalChat",
      "pythonChat",
      "toolChat",
    ]);
  });

  it("saves query settings as an isolated partial update", async () => {
    const wrapper = await mountPage();
    const query = wrapper.findComponent(QuerySettingsCard);
    const timeout = query.find(".el-input-number input");
    await timeout.setValue("900");
    await button(query, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.system).toEqual({ abcQuestionMode: "harness", queryTimeoutSeconds: 900 });
    expect(query.find(".dirty-tag").exists()).toBe(false);
  });

  it("saves the skill directory alone from the system configuration page", async () => {
    const wrapper = await mountPage();
    const skill = wrapper.findComponent(SkillDirConfigCard);
    expect((skill.find("input").element as HTMLInputElement).value).toBe("skills/legacy");
    await button(skill, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.skilldir).toBe("skills/legacy");
    expect(savedPayload.roleModels).toBeNull();
  });

  it("saves the embedding draft as a full snapshot", async () => {
    const wrapper = await mountModelPage();
    const embedding = wrapper.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await button(embedding, t("admin.doneEdit"))!.trigger("click");
    await button(embedding, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(savedPayload.embedding).toMatchObject({
      baseUrl: fixtures.embedding.baseUrl,
      apiKey: "sk-embed-2",
      modelName: "text-embedding-v3",
      timeout: "PT300S",
      customHeaders: { "X-Embed-Key": "keep" },
    });
  });

  it("tests the embedding row through its own list entry", async () => {
    const wrapper = await mountModelPage();
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

  it("keeps a persistent embedding error with retry on the model config page", async () => {
    vi.mocked(adminApi.getBusinessConfig).mockResolvedValueOnce({
      success: false,
      message: "legacy role params",
    });
    const wrapper = await mountModelPage();
    const roles = wrapper.findComponent(RoleReferencesCard);
    expect(button(roles, t("common.save"))!.attributes("disabled")).toBeDefined();
    const embedding = wrapper.findComponent(EmbeddingModelConfigCard);
    expect(button(embedding, t("common.save"))!.attributes("disabled")).toBeDefined();
    expect(embedding.find(".load-error").text()).toContain("legacy role params");
    expect(embedding.findAll(".model-item")).toHaveLength(0);

    await button(embedding, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(embedding.find(".load-error").exists()).toBe(false);
    expect(embedding.findAll(".model-item")).toHaveLength(1);
  });

  it("keeps a persistent config error banner on the system configuration page", async () => {
    vi.mocked(adminApi.getBusinessConfig).mockResolvedValueOnce({
      success: false,
      message: "legacy role params",
    });
    const wrapper = await mountPage();
    expect(
      button(wrapper.findComponent(SkillDirConfigCard), t("common.save"))!.attributes(
        "disabled"
      )
    ).toBeDefined();
    const banner = wrapper.find(".config-load-error");
    expect(banner.text()).toContain("legacy role params");
    expect(button(banner, t("common.retry"))).toBeTruthy();
  });

  it("titles every test dialog as a model test named after the selected entry", async () => {
    const wrapper = await mountModelPage();
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
    await button(wrapper.findComponent(EmbeddingModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: t("admin.embeddingModelConfig") }));
  });

  it("edits context windows and saves models and distinct role references in one save", async () => {
    const wrapper = await mountModelPage();
    const application = wrapper.findComponent(SystemModelConfigCard);
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

    const roles = wrapper.findComponent(RoleReferencesCard);
    const diagnosisRole = roles.findAllComponents({ name: "ElSelect" })[1]!;
    diagnosisRole.vm.$emit("update:modelValue", "diag");
    await flushPromises();

    await button(roles, t("common.save"))!.trigger("click");
    await flushPromises();
    const saved = savedPayload.system as {
      models: Array<Record<string, unknown>>;
      agents: Record<string, { model: string }>;
    };
    expect(saved.models.map((entry) => [entry.name, entry.contextWindow])).toEqual([
      ["default", 200000],
      ["diag", 64000],
    ]);
    expect(saved.agents).toEqual({ default: { model: "default" }, diagnosis: { model: "diag" } });
  });

  it("frontend save and test keep the config ID, the renamed display name and opaque customs", async () => {
    const wrapper = await mountModelPage();
    const frontend = wrapper.findComponent(SystemModelConfigCard);
    await button(frontend, t("common.edit"))!.trigger("click");
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
    await button(wrapper.findComponent(RoleReferencesCard), t("common.save"))!.trigger("click");
    await flushPromises();
    expect(frontend.find(".dirty-tag").exists()).toBe(false);
    const saved = savedPayload.system as {
      models: Array<Record<string, unknown>>;
    };
    expect(saved.models[0]).toMatchObject({
      name: "default",
      displayName: "GPT-4o Main",
      baseUrl: "https://new.example/v1",
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
