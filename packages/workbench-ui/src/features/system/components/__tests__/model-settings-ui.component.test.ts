import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus, { ElMessage } from "element-plus";
import { reactive } from "vue";
import { MODEL_ROLES } from "@ontomato/contracts/model-settings";
import ModelListCard from "../business-config/ModelListCard.vue";
import RoleModelsCard from "../business-config/RoleModelsCard.vue";
import EmbeddingModelConfigCard from "../business-config/EmbeddingModelConfigCard.vue";
import SkillDirConfigCard from "../business-config/SkillDirConfigCard.vue";
import QuerySettingsCard from "../business-config/QuerySettingsCard.vue";
import BusinessConfig from "../BusinessConfig.vue";
import ModelConfig from "../ModelConfig.vue";
import type { EmbeddingModelConfig, ModelEntry, RoleModels } from "../../types";
import { adminApi } from "../../../admin";
import { workbenchI18n } from "../../../../i18n";
import { businessConfig } from "../../../../../../../apps/workbench/web/src/business-config";

const OPAQUE_CUSTOMS =
  '{"__v_isRef":true,"__v_isReactive":1,"__v_isReadonly":0,"__v_raw":{"nested":"user-value"},"value":"keep-me","temperature":null,"constructor":{"x":1},"__proto__":{"polluted":false},"arr":[1,null,{"k":"v"}]}';

const sent = vi.hoisted(() => ({
  settings: null as unknown,
  test: null as unknown,
  skilldir: null as unknown,
  embedding: null as unknown,
  embeddingTest: null as unknown,
  system: null as unknown,
}));

// 模拟 Java 模型库：读取返回副本；保存原子落库并按读取归一化补 maxTokens / contextWindow 默认值。
const server = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  agents: {} as Record<string, string | null>,
  reads: 0,
}));

const fixtures = vi.hoisted(() => ({
  models: [
    {
      name: "qwen-main",
      displayName: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeys: ["", "sk-fake-ab12", "sk-fake-cd34"],
      modelName: "qwen3",
      maxTokens: 50000,
      contextWindow: 256000,
      timeout: "PT5M",
      maxRetries: 99,
      organizationId: "org-existing",
      projectId: "project-existing",
      stop: ["</end>"],
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
      temperature: 0.7,
      topP: null,
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
      maxTokens: 8000,
      contextWindow: 32000,
      customRequestParameters: {},
    },
  ],
  agents: {
    query: "qwen-main",
    coding: "qwen-main",
    general: "qwen-lite",
    diagnosis: "qwen-main",
    knowledgeGovernance: null,
  },
  embedding: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-embed",
    modelName: "text-embedding-v3",
    timeout: "PT300S",
    customHeaders: { "X-Embed-Key": "keep" },
  },
}));

function settingsData() {
  return JSON.parse(
    JSON.stringify({
      models: server.models,
      agents: Object.fromEntries(
        Object.entries(server.agents).map(([role, model]) => [
          role,
          role === "coding" ? { model, skilldir: "skills/legacy" } : { model },
        ])
      ),
    })
  );
}

vi.mock("../../../admin", () => ({
  adminApi: {
    getModelSettings: vi.fn(async () => {
      server.reads += 1;
      return { success: true, data: settingsData() };
    }),
    saveModelSettings: vi.fn(
      async (payload: { models: Array<Record<string, unknown>>; agents: Record<string, string | null> }) => {
        sent.settings = JSON.parse(JSON.stringify(payload));
        server.models = (sent.settings as typeof payload).models.map((model) => ({
          ...model,
          maxTokens: model.maxTokens ?? 50000,
          contextWindow: model.contextWindow ?? 256000,
        }));
        server.agents = (sent.settings as typeof payload).agents;
        return { success: true, data: settingsData() };
      }
    ),
    testModel: vi.fn(async (model: unknown, prompt: string) => {
      sent.test = JSON.parse(JSON.stringify({ model, prompt }));
      return { success: true, data: "ok" };
    }),
    getBusinessConfig: vi.fn(async () => ({
      success: true,
      data: JSON.parse(
        JSON.stringify({
          agents: settingsData().agents,
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
    })),
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
      data: { abcQuestionMode: "harness", queryTimeoutSeconds: 600, hasCustomConfig: false },
    })),
    saveSystemModelConfig: vi.fn(async (payload: Record<string, unknown>) => {
      sent.system = JSON.parse(JSON.stringify(payload));
      return { success: true, data: { ...payload, hasCustomConfig: true } };
    }),
    saveToolSkillDir: vi.fn(async (skilldir: string) => {
      sent.skilldir = skilldir;
      return { success: true };
    }),
    saveEmbeddingModel: vi.fn(async (payload: unknown) => {
      sent.embedding = JSON.parse(JSON.stringify(payload));
      return { success: true };
    }),
    testEmbeddingModel: vi.fn(async (payload: unknown) => {
      sent.embeddingTest = JSON.parse(JSON.stringify(payload));
      return { success: true };
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
  vi.clearAllMocks();
  Object.assign(sent, {
    settings: null,
    test: null,
    skilldir: null,
    embedding: null,
    embeddingTest: null,
    system: null,
  });
  server.models = JSON.parse(JSON.stringify(fixtures.models));
  server.agents = { ...fixtures.agents };
  server.reads = 0;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

function track<T extends ReturnType<typeof mount>>(wrapper: T): T {
  wrappers.push(wrapper);
  return wrapper;
}

function button(wrapper: Pick<ReturnType<typeof mount>, "findAll">, text: string) {
  return wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
}

function entry(name: string, extra: Partial<ModelEntry> = {}): ModelEntry {
  return {
    name,
    displayName: name,
    baseUrl: "https://example/v1",
    apiKeys: ["sk-1"],
    modelName: "qwen3",
    maxTokens: 50000,
    contextWindow: 256000,
    customRequestParameters: {},
    ...extra,
  };
}

/** 新增弹窗：输入依次是配置 ID、显示名、连接地址，之后是 Key 行与 API 模型标识。 */
async function fillNewModel(dialog: Pick<ReturnType<typeof mount>, "findAll">, id: string) {
  await dialog.findAll("input")[0]!.setValue(id);
  await dialog.findAll("input")[1]!.setValue(`Model ${id}`);
  await dialog.findAll("input")[2]!.setValue("https://new.example/v1");
  await button(dialog, t("admin.addApiKey"))!.trigger("click");
  const inputs = dialog.findAll("input");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

/** 列表卡以 v-model 整表替换：挂载时把更新写回 props，模拟父页的浅引用。 */
function mountList(models: ModelEntry[], extra: Record<string, unknown> = {}) {
  const wrapper: ReturnType<typeof mount> = track(
    mount(ModelListCard, {
      props: {
        models,
        disabled: false,
        "onUpdate:models": (next: ModelEntry[]) => wrapper.setProps({ models: next }),
        ...extra,
      },
      global,
    })
  );
  return wrapper;
}

const listModels = (wrapper: ReturnType<typeof mount>) =>
  (wrapper.props() as { models: ModelEntry[] }).models;

async function mountModelPage() {
  const wrapper = track(mount(ModelConfig, { global }));
  await flushPromises();
  return wrapper;
}

/** 系统配置页：问数设置、技能目录等其他配置；问数示例另有自己的接口，这里替身。 */
async function mountSystemPage() {
  const wrapper = track(
    mount(BusinessConfig, {
      props: businessConfig,
      global: { ...global, stubs: { ...global.stubs, ExamplesManager: true } },
    })
  );
  await flushPromises();
  return wrapper;
}

function roleSelect(page: ReturnType<typeof mount>, role: string) {
  return page
    .findComponent(RoleModelsCard)
    .findAllComponents({ name: "ElSelect" })
    .find((select) => select.props("ariaLabel") === t(`admin.modelRoleNames.${role}`))!;
}

async function saveButton(page: ReturnType<typeof mount>) {
  return page.find(".model-settings-actions").findAll("button").at(-1)!;
}

describe("model list card", () => {
  it("shows an add entry when the library is legitimately empty", async () => {
    const wrapper = mountList([]);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    const adds = wrapper.findAll("button").filter((b) => b.text().includes(t("admin.addModel")));
    expect(adds).toHaveLength(2);
    expect(adds.every((b) => b.attributes("disabled") === undefined)).toBe(true);
    await adds[1]!.trigger("click");
    expect(wrapper.find("section").exists()).toBe(true);
  });

  it("cancelling an edit leaves the original entry untouched", async () => {
    const wrapper = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("changed");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    expect(wrapper.emitted("update:models")).toBeUndefined();
    expect(listModels(wrapper)[0]!.displayName).toBe("Qwen");
  });

  it("starts a new draft empty instead of reusing the previous entry", async () => {
    const wrapper = mountList([entry("qwen-main")]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const inputs = wrapper.findAll("section input");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("");
    // maxTokens 与上下文窗口留空，由 Java 补默认值，前端不持有默认值。
    const numbers = wrapper.findAll("section .el-input-number input");
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual(
      Array(7).fill("")
    );
  });

  it("fixes the config ID once created while the display name stays editable", async () => {
    const wrapper = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    expect(wrapper.find(".model-name").text()).toBe("Qwen");
    expect(wrapper.find(".model-main .model-id").text()).toBe("qwen-main");

    await button(wrapper, t("common.edit"))!.trigger("click");
    const [idInput, displayInput] = wrapper.findAll("section input");
    expect(idInput!.attributes("disabled")).toBeDefined();
    await displayInput!.setValue("Qwen Max");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    expect(listModels(wrapper)[0]).toMatchObject({ name: "qwen-main", displayName: "Qwen Max" });

    // 新建时 ID 可填；ID、显示名与连接三项都填写后才能加入列表。
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const dialog = wrapper.find("section");
    const confirm = () => button(dialog, t("admin.addModel"))!;
    expect(dialog.findAll("input")[0]!.attributes("disabled")).toBeUndefined();
    await dialog.findAll("input")[0]!.setValue("deepseek-main");
    expect(confirm().attributes("disabled")).toBeDefined();
    await fillNewModel(dialog, "deepseek-main");
    await confirm().trigger("click");
    expect(listModels(wrapper).map((model) => model.name)).toEqual(["qwen-main", "deepseek-main"]);
    expect(listModels(wrapper)[1]).toMatchObject({
      maxTokens: null,
      contextWindow: null,
      timeout: null,
    });
  });

  it("reveals the full fake key and deletes several keys without shifting the rest", async () => {
    const wrapper = mountList([entry("qwen-main", { apiKeys: ["sk-fake-1", "sk-fake-2", "sk-fake-3"] })]);
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
    expect(listModels(wrapper)[0]!.apiKeys).toEqual(["sk-fake-2"]);
  });

  it("disables every row and add entry while the page is saving", () => {
    const wrapper = mountList([entry("qwen-main")], { disabled: true });
    expect(wrapper.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(
      true
    );
  });
});

describe("role models card", () => {
  function mountRoles(models = [entry("qwen-main", { displayName: "Qwen" }), entry("qwen-lite", { displayName: "Qwen" })]) {
    const roles = reactive<RoleModels>({
      query: "qwen-main",
      coding: null,
      general: "qwen-lite",
      diagnosis: null,
      knowledgeGovernance: null,
    });
    // 选项渲染在下拉浮层的 content 插槽里，这里让 tooltip 桩一并渲染它。
    const wrapper = track(
      mount(RoleModelsCard, {
        props: { roles, models, disabled: false },
        global: {
          ...global,
          stubs: {
            ...global.stubs,
            "el-tooltip": { template: '<span><slot /><slot name="content" /></span>' },
          },
        },
      })
    );
    return { roles, wrapper };
  }

  it("lists the five roles in the query engine and agent groups", () => {
    const { wrapper } = mountRoles();
    const groups = wrapper.findAll(".role-group");
    expect(groups.map((group) => group.find("h4").text())).toEqual([
      t("admin.modelRoleGroups.queryEngine"),
      t("admin.modelRoleGroups.agents"),
    ]);
    expect(groups.map((group) => group.findAll(".role-name").map((name) => name.text()))).toEqual([
      [t("admin.modelRoleNames.query"), t("admin.modelRoleNames.coding")],
      [
        t("admin.modelRoleNames.general"),
        t("admin.modelRoleNames.diagnosis"),
        t("admin.modelRoleNames.knowledgeGovernance"),
      ],
    ]);
  });

  it("offers the given models by config ID and clears a role to not configured", async () => {
    const { roles, wrapper } = mountRoles();
    const selects = wrapper.findAllComponents({ name: "ElSelect" });
    expect(selects).toHaveLength(5);
    const options = selects[0]!.findAllComponents({ name: "ElOption" });
    expect(options.map((option) => [option.props("value"), option.props("label")])).toEqual([
      ["qwen-main", "Qwen (qwen-main)"],
      ["qwen-lite", "Qwen (qwen-lite)"],
    ]);
    expect(selects[1]!.props("placeholder")).toBe(t("admin.roleNotConfigured"));
    await selects[0]!.trigger("mouseenter");
    await selects[0]!.find(".el-select__clear").trigger("click");
    expect(roles.query).toBeNull();
  });
});

describe("query settings card", () => {
  it("tracks its two fields and clears the marker when reverted", async () => {
    const model = reactive({ abcQuestionMode: "harness" as const, queryTimeoutSeconds: 600 });
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
  });

  it("shows the load error with retry and blocks save", async () => {
    const wrapper = track(
      mount(QuerySettingsCard, {
        props: {
          model: { abcQuestionMode: "harness" as const, queryTimeoutSeconds: 600 },
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

describe("embedding model card", () => {
  function mountEmbedding(extra: Record<string, unknown> = {}) {
    return track(
      mount(EmbeddingModelConfigCard, {
        props: { model: { ...fixtures.embedding }, loading: false, saving: false, loadError: "", ...extra },
        global,
      })
    );
  }

  it("shows one compact row with the key masked and keeps unshown fields when editing", async () => {
    const wrapper = mountEmbedding({ model: { ...fixtures.embedding, timeout: "PT5M" } });
    expect(wrapper.findAll(".model-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("text-embedding-v3");
    expect(wrapper.text()).not.toContain("sk-embed");
    expect(wrapper.text()).toContain("300");
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

  it("does not fake a model row while loading or after a load failure", async () => {
    expect(mountEmbedding({ loading: true }).findAll(".model-item")).toHaveLength(0);
    const failed = mountEmbedding({ loadError: "down" });
    expect(failed.findAll(".model-item")).toHaveLength(0);
    expect(failed.text()).toContain("down");
    expect(button(failed, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(failed, t("common.retry"))!.trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("shows an add entry when no embedding model is configured", async () => {
    const wrapper = mountEmbedding({ model: null });
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    expect(button(wrapper, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    await wrapper.find("section").findAll("input")[0]!.setValue("https://new.example/v1");
    await button(wrapper, t("admin.doneEdit"))!.trigger("click");
    const updated = wrapper.emitted("update:model")![0]![0] as EmbeddingModelConfig;
    expect(updated.baseUrl).toBe("https://new.example/v1");
    expect(updated.timeout).toBe("PT300S");
  });
});

describe("password visibility with the real dialog", () => {
  // 不替换 ElDialog/teleport：验证真实关闭销毁与密钥行重建后，密码输入回到默认隐藏。
  const realDialog = { plugins: [i18n, ElementPlus], stubs: { transition: false } };
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  };
  const keyTypes = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => input.attributes("type"));
  const keyValues = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => (input.element as HTMLInputElement).value);

  it("keeps remaining keys hidden after deleting a revealed row and when reopening another entry", async () => {
    const wrapper = track(
      mount(ModelListCard, {
        props: {
          models: [
            entry("a", { apiKeys: ["sk-fake-1", "sk-fake-2", "sk-fake-3"] }),
            entry("b", { apiKeys: ["sk-fake-9"] }),
          ],
          disabled: false,
        },
        global: realDialog,
        attachTo: document.body,
      })
    );
    const edits = () => wrapper.findAll("button").filter((b) => b.text() === t("common.edit"));
    await edits()[0]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password", "password", "password"]);

    await wrapper.findAll(".api-key-row .el-input__password")[0]!.trigger("click");
    await wrapper.findAll(".api-key-row .el-input__password")[1]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["text", "text", "password"]);
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await wrapper.findAll(trash)[0]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["password", "password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-2", "sk-fake-3"]);

    await button(wrapper, t("common.cancel"))!.trigger("click");
    await settle();
    await edits()[1]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-9"]);
  });

  it("re-hides the embedding key when its editor is reopened", async () => {
    const wrapper = track(
      mount(EmbeddingModelConfigCard, {
        props: { model: { ...fixtures.embedding }, loading: false, saving: false, loadError: "" },
        global: realDialog,
        attachTo: document.body,
      })
    );
    const keyInput = () =>
      wrapper.find(
        ".el-dialog input[type='password'], .el-dialog input[type='text'][placeholder='sk-...']"
      );
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    await wrapper.find(".el-dialog .el-input__password").trigger("click");
    expect(keyInput().attributes("type")).toBe("text");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await settle();
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    expect(keyInput().attributes("type")).toBe("password");
    expect((keyInput().element as HTMLInputElement).value).toBe("sk-embed");
  });
});

describe("model config page", () => {
  it("is one page without tabs: model list, role table, one save and the embedding card", async () => {
    const page = await mountModelPage();
    expect(page.find(".el-tabs").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).exists()).toBe(true);
    expect(page.findComponent(RoleModelsCard).exists()).toBe(true);
    expect(page.findComponent(EmbeddingModelConfigCard).exists()).toBe(true);
    expect(page.findComponent(QuerySettingsCard).exists()).toBe(false);
    expect(page.findComponent(SkillDirConfigCard).exists()).toBe(false);
    expect(page.find(".model-settings-actions").findAll("button")).toHaveLength(1);

    const system = await mountSystemPage();
    expect(system.findComponent(QuerySettingsCard).exists()).toBe(true);
    expect(system.findComponent(SkillDirConfigCard).exists()).toBe(true);
    expect(system.findComponent(ModelListCard).exists()).toBe(false);
    expect(system.findComponent(EmbeddingModelConfigCard).exists()).toBe(false);
  });

  it("adds a model to an empty library and assigns it to a role in the same save", async () => {
    server.models = [];
    server.agents = Object.fromEntries(MODEL_ROLES.map((role) => [role, null]));
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    expect(list.text()).toContain(t("admin.modelListEmpty"));
    expect(page.find(".model-settings-actions .el-tag").exists()).toBe(false);

    await button(list, t("admin.addModel"))!.trigger("click");
    await fillNewModel(list.find("section"), "fresh");
    await button(list.find("section"), t("admin.addModel"))!.trigger("click");
    // 选项取当前草稿：新加的模型未保存也能立刻选。
    expect(page.findComponent(RoleModelsCard).props("models")).toMatchObject([{ name: "fresh" }]);
    roleSelect(page, "query").vm.$emit("update:modelValue", "fresh");
    roleSelect(page, "general").vm.$emit("update:modelValue", "fresh");
    await flushPromises();
    expect(page.find(".model-settings-actions .el-tag").text()).toBe(t("admin.unsaved"));

    await (await saveButton(page)).trigger("click");
    await flushPromises();
    expect(adminApi.saveModelSettings).toHaveBeenCalledTimes(1);
    expect(sent.settings).toEqual({
      models: [
        {
          name: "fresh",
          displayName: "Model fresh",
          baseUrl: "https://new.example/v1",
          apiKeys: ["sk-new"],
          modelName: "new-model",
          maxTokens: null,
          contextWindow: null,
          timeout: null,
          maxRetries: null,
          temperature: null,
          topP: null,
          maxCompletionTokens: null,
          customRequestParameters: {},
        },
      ],
      agents: {
        query: "fresh",
        coding: null,
        general: "fresh",
        diagnosis: null,
        knowledgeGovernance: null,
      },
    });
    // 成功后按返回的 data 整体回填（含 Java 补上的默认值），未保存标记清除。
    expect(page.findComponent(ModelListCard).props("models")).toMatchObject([
      { name: "fresh", maxTokens: 50000, contextWindow: 256000 },
    ]);
    expect(page.find(".model-settings-actions .el-tag").exists()).toBe(false);
    expect(server.reads).toBe(1);
  });

  it("submits exactly the model list and the five role keys in one request", async () => {
    const page = await mountModelPage();
    await (await saveButton(page)).trigger("click");
    await flushPromises();
    const payload = sent.settings as { models: unknown[]; agents: Record<string, unknown> };
    expect(Object.keys(payload)).toEqual(["models", "agents"]);
    expect(Object.keys(payload.agents)).toEqual([...MODEL_ROLES]);
    // 角色只带配置 ID，技能目录不随模型保存提交。
    expect(payload.agents).toEqual(fixtures.agents);
    expect(payload.models).toHaveLength(2);
  });

  it("clears the roles that referenced a deleted model and shows them as not configured", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await list.findAll("button").filter((b) => b.text() === t("common.delete"))[0]!.trigger("click");
    await flushPromises();
    for (const role of ["query", "coding", "diagnosis"]) {
      const select = roleSelect(page, role);
      expect(select.props("modelValue")).toBeNull();
      expect(select.find(".el-select__placeholder").text()).toBe(t("admin.roleNotConfigured"));
    }
    expect(roleSelect(page, "general").props("modelValue")).toBe("qwen-lite");
    expect(page.findComponent(RoleModelsCard).props("models")).toMatchObject([{ name: "qwen-lite" }]);

    await (await saveButton(page)).trigger("click");
    await flushPromises();
    expect(sent.settings).toMatchObject({
      models: [{ name: "qwen-lite" }],
      agents: {
        query: null,
        coding: null,
        general: "qwen-lite",
        diagnosis: null,
        knowledgeGovernance: null,
      },
    });
  });

  it("shows a persistent error with retry and offers no write entry when loading fails", async () => {
    vi.mocked(adminApi.getModelSettings).mockRejectedValueOnce(new Error("legacy role params"));
    const page = await mountModelPage();
    const alert = page.find(".load-error[role='alert']");
    expect(alert.text()).toContain("legacy role params");
    expect(page.findComponent(ModelListCard).exists()).toBe(false);
    expect(page.findComponent(RoleModelsCard).exists()).toBe(false);
    expect(page.find(".model-settings-actions").exists()).toBe(false);
    expect(button(page, t("admin.addModel"))).toBeUndefined();

    await button(alert, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(page.find(".load-error[role='alert']").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).props("models")).toHaveLength(2);
  });

  it("keeps the drafts and shows the backend message when saving fails", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.mocked(adminApi.saveModelSettings).mockRejectedValueOnce(
      new Error("Model referenced by role query does not exist: gone")
    );
    const page = await mountModelPage();
    roleSelect(page, "knowledgeGovernance").vm.$emit("update:modelValue", "qwen-lite");
    await flushPromises();
    await (await saveButton(page)).trigger("click");
    await flushPromises();
    expect(error).toHaveBeenCalledWith("Model referenced by role query does not exist: gone");
    expect(roleSelect(page, "knowledgeGovernance").props("modelValue")).toBe("qwen-lite");
    expect(page.find(".model-settings-actions .el-tag").exists()).toBe(true);
  });

  it("shows an ISO timeout in seconds and writes it back as PT{n}S", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    const numbers = list.findAll("section .el-input-number input");
    // 依次是 maxTokens、上下文窗口、超时、重试、temperature、topP、maxCompletionTokens。
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual([
      "50000",
      "256000",
      "300",
      "99",
      "0.7",
      "",
      "",
    ]);
    await button(list, t("admin.doneEdit"))!.trigger("click");
    await (await saveButton(page)).trigger("click");
    await flushPromises();
    expect((sent.settings as { models: ModelEntry[] }).models[0]!.timeout).toBe("PT300S");
  });

  it("round-trips fields without controls through edit, test and save", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.find("section").findAll("input")[2]!.setValue("https://new.example.com/v1");
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await list.find("section").findAll(trash)[1]!.trigger("click");
    await button(list, t("admin.doneEdit"))!.trigger("click");

    // 测试用当前草稿，不保存。
    await button(list, t("common.testModel"))!.trigger("click");
    const testDialog = page.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    const tested = (sent.test as { model: Record<string, unknown>; prompt: string });
    expect(tested.prompt).toBe("hello");
    expect(tested.model.baseUrl).toBe("https://new.example.com/v1");
    expect(tested.model.apiKeys).toEqual(["", "sk-fake-cd34"]);
    expect(JSON.stringify(tested.model.customRequestParameters)).toBe(OPAQUE_CUSTOMS);
    expect(adminApi.saveModelSettings).not.toHaveBeenCalled();
    await button(testDialog, t("common.close"))!.trigger("click");

    await (await saveButton(page)).trigger("click");
    await flushPromises();
    const saved = (sent.settings as { models: Array<Record<string, unknown>> }).models[0]!;
    expect(saved).toMatchObject({
      baseUrl: "https://new.example.com/v1",
      apiKeys: ["", "sk-fake-cd34"],
      temperature: 0.7,
      maxRetries: 99,
      organizationId: "org-existing",
      projectId: "project-existing",
      stop: ["</end>"],
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
    });
    expect(JSON.stringify(saved.customRequestParameters)).toBe(OPAQUE_CUSTOMS);
    // 未编辑的条目原样提交。
    expect((sent.settings as { models: unknown[] }).models[1]).toEqual(fixtures.models[1]);
  });

  it("titles the model and embedding test dialogs after the selected entry", async () => {
    const page = await mountModelPage();
    const title = () =>
      page
        .findAllComponents({ name: "ElDialog" })
        .find((dialog) => dialog.props("modelValue"))!
        .props("title") as string;
    await button(page.findComponent(ModelListCard), t("common.testModel"))!.trigger("click");
    expect(title()).toBe(t("admin.testModelNamed", { name: "Qwen (qwen-main)" }));
    await button(page.findAll("section").at(-1)!, t("common.close"))!.trigger("click");
    await button(page.findComponent(EmbeddingModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: t("admin.embeddingModelConfig") }));
  });

  it("saves and tests the embedding draft as a full snapshot on its own", async () => {
    const page = await mountModelPage();
    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await button(embedding, t("admin.doneEdit"))!.trigger("click");
    await button(embedding, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(sent.embedding).toEqual({ ...fixtures.embedding, apiKey: "sk-embed-2" });
    expect(sent.settings).toBeNull();

    await button(embedding, t("common.testModel"))!.trigger("click");
    const testDialog = page.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    expect(sent.embeddingTest).toEqual({
      modelConfig: { ...fixtures.embedding, apiKey: "sk-embed-2" },
      userContent: "hello",
    });
  });
});

describe("system config page", () => {
  it("reads and writes only the two query settings", async () => {
    const page = await mountSystemPage();
    const query = page.findComponent(QuerySettingsCard);
    await query.find(".el-input-number input").setValue("900");
    await button(query, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(sent.system).toEqual({ abcQuestionMode: "harness", queryTimeoutSeconds: 900 });
    expect(query.find(".dirty-tag").exists()).toBe(false);
  });

  it("reads the skill directory from the coding role and saves it alone", async () => {
    const page = await mountSystemPage();
    const skill = page.findComponent(SkillDirConfigCard);
    expect((skill.find("input").element as HTMLInputElement).value).toBe("skills/legacy");
    await skill.find("input").setValue("skills/aftercalculate");
    await button(skill, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(sent.skilldir).toBe("skills/aftercalculate");
    expect(sent.settings).toBeNull();
  });

  it("keeps a persistent error and disables writes when the business config fails to load", async () => {
    vi.mocked(adminApi.getBusinessConfig).mockRejectedValueOnce(new Error("java down"));
    const page = await mountSystemPage();
    expect(
      button(page.findComponent(SkillDirConfigCard), t("common.saveConfig"))!.attributes("disabled")
    ).toBeDefined();
    const banner = page.find(".config-load-error");
    expect(banner.text()).toContain("java down");
    expect(button(banner, t("common.retry"))).toBeTruthy();
  });
});
