import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
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

// Simulates the Java model library: reads return a copy; saves are stored atomically and filled with the maxTokens / contextWindow defaults as read normalization does.
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
      data: { abcQuestionMode: "harness", queryTimeoutSeconds: 600 },
    })),
    saveSystemModelConfig: vi.fn(async (payload: Record<string, unknown>) => {
      sent.system = JSON.parse(JSON.stringify(payload));
      return { success: true, data: { ...payload } };
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

/** Add dialog: inputs are config ID, display name and URL, followed by the key rows and the API model id. */
async function fillNewModel(dialog: Pick<ReturnType<typeof mount>, "findAll">, id: string) {
  await dialog.findAll("input")[0]!.setValue(id);
  await dialog.findAll("input")[1]!.setValue(`Model ${id}`);
  await dialog.findAll("input")[2]!.setValue("https://new.example/v1");
  await button(dialog, t("admin.addApiKey"))!.trigger("click");
  const inputs = dialog.findAll("input");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

/** The list card hands a whole new list to save: the save double writes it back to props, simulating the page's saved list. */
function mountList(models: ModelEntry[], extra: Record<string, unknown> = {}) {
  const save = vi.fn(async (next: ModelEntry[]) => {
    await wrapper.setProps({ models: next });
    return true;
  });
  const wrapper: ReturnType<typeof mount> = track(
    mount(ModelListCard, { props: { models, saving: false, save, ...extra }, global })
  );
  return { wrapper, save };
}

const listModels = (wrapper: ReturnType<typeof mount>) =>
  (wrapper.props() as { models: ModelEntry[] }).models;

/** Clicks the dialog's Save inside the given card or dialog and waits for the save to settle. */
async function saveDialog(scope: Pick<ReturnType<typeof mount>, "findAll">) {
  await button(scope, t("common.save"))!.trigger("click");
  await flushPromises();
}

async function mountModelPage() {
  const wrapper = track(mount(ModelConfig, { global }));
  await flushPromises();
  return wrapper;
}

/** System config page: query settings, skill directory and other config. */
async function mountSystemPage() {
  const wrapper = track(mount(BusinessConfig, { props: businessConfig, global }));
  await flushPromises();
  return wrapper;
}

function roleSelect(page: ReturnType<typeof mount>, role: string) {
  return page
    .findComponent(RoleModelsCard)
    .findAllComponents({ name: "ElSelect" })
    .find((select) => select.props("ariaLabel") === t(`admin.modelRoleNames.${role}`))!;
}

/** The role card's own save and its unsaved marker. */
async function saveRoles(page: ReturnType<typeof mount>) {
  await button(page.findComponent(RoleModelsCard), t("common.save"))!.trigger("click");
  await flushPromises();
}

const unsavedTag = (page: ReturnType<typeof mount>) =>
  page.findComponent(RoleModelsCard).find(".card-header-actions .el-tag");

describe("model list card", () => {
  it("shows an add entry when the library is legitimately empty", async () => {
    const { wrapper } = mountList([]);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    const adds = wrapper.findAll("button").filter((b) => b.text().includes(t("admin.addModel")));
    expect(adds).toHaveLength(2);
    expect(adds.every((b) => b.attributes("disabled") === undefined)).toBe(true);
    await adds[1]!.trigger("click");
    expect(wrapper.find("section").exists()).toBe(true);
  });

  it("cancelling an edit leaves the original entry untouched", async () => {
    const { wrapper, save } = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("changed");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    expect(save).not.toHaveBeenCalled();
    expect(listModels(wrapper)[0]!.displayName).toBe("Qwen");
  });

  it("starts a new draft empty instead of reusing the previous entry", async () => {
    const { wrapper } = mountList([entry("qwen-main")]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const inputs = wrapper.findAll("section input");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("");
    // maxTokens and the context window stay empty; Java fills the defaults and the frontend holds none.
    const numbers = wrapper.findAll("section .el-input-number input");
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual(
      Array(7).fill("")
    );
  });

  it("fixes the config ID once created while the display name stays editable", async () => {
    const { wrapper } = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    expect(wrapper.find(".model-name").text()).toBe("Qwen");
    expect(wrapper.find(".model-id").text()).toBe("qwen-main");

    await button(wrapper, t("common.edit"))!.trigger("click");
    const [idInput, displayInput] = wrapper.findAll("section input");
    expect(idInput!.attributes("disabled")).toBeDefined();
    await displayInput!.setValue("Qwen Max");
    await saveDialog(wrapper);
    expect(listModels(wrapper)[0]).toMatchObject({ name: "qwen-main", displayName: "Qwen Max" });

    // The ID is editable when creating; the entry can be saved only after the ID, display name and the three connection fields are filled in.
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const dialog = wrapper.find("section");
    expect(dialog.findAll("input")[0]!.attributes("disabled")).toBeUndefined();
    await dialog.findAll("input")[0]!.setValue("deepseek-main");
    expect(button(dialog, t("common.save"))!.attributes("disabled")).toBeDefined();
    await fillNewModel(dialog, "deepseek-main");
    await saveDialog(dialog);
    expect(listModels(wrapper).map((model) => model.name)).toEqual(["qwen-main", "deepseek-main"]);
    expect(listModels(wrapper)[1]).toMatchObject({
      maxTokens: null,
      contextWindow: null,
      timeout: null,
    });
  });

  it("reveals the full fake key and deletes several keys without shifting the rest", async () => {
    const { wrapper } = mountList([entry("qwen-main", { apiKeys: ["sk-fake-1", "sk-fake-2", "sk-fake-3"] })]);
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
    await saveDialog(wrapper);
    expect(listModels(wrapper)[0]!.apiKeys).toEqual(["sk-fake-2"]);
  });

  it("disables every row and add entry while the page is saving", () => {
    const { wrapper } = mountList([entry("qwen-main")], { saving: true });
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
    // Options render in the dropdown popper's content slot, so the tooltip stub renders it too.
    const wrapper = track(
      mount(RoleModelsCard, {
        props: { roles, models, saving: false, dirty: false },
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

  it("each role name carries a focusable description", () => {
    const { wrapper } = mountRoles();
    expect(wrapper.findAll("button.role-info").map((info) => info.attributes("aria-label"))).toEqual(
      MODEL_ROLES.map((role) => t(`admin.modelRoleDescriptions.${role}`))
    );
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
    const save = vi.fn(async (_model: EmbeddingModelConfig) => true);
    const wrapper = track(
      mount(EmbeddingModelConfigCard, {
        props: { model: { ...fixtures.embedding }, loading: false, saving: false, loadError: "", save, ...extra },
        global,
      })
    );
    return { wrapper, save };
  }

  it("shows one compact row with the key masked and keeps unshown fields when editing", async () => {
    const { wrapper, save } = mountEmbedding({ model: { ...fixtures.embedding, timeout: "PT5M" } });
    expect(wrapper.findAll(".model-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("text-embedding-v3");
    expect(wrapper.text()).not.toContain("sk-embed");
    expect(wrapper.text()).toContain("300");
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.find("section input").setValue("https://proxy.example/v1");
    await saveDialog(wrapper);
    const updated = save.mock.calls[0]![0];
    expect(updated.baseUrl).toBe("https://proxy.example/v1");
    expect(updated.timeout).toBe("PT300S");
    // The dialog overwrites only the 4 displayed fields; fields not shown, such as customHeaders, must be kept as-is.
    expect(updated.customHeaders).toEqual({ "X-Embed-Key": "keep" });
    expect(wrapper.find("section").exists()).toBe(false);
  });

  it("does not fake a model row while loading or after a load failure", async () => {
    expect(mountEmbedding({ loading: true }).wrapper.findAll(".model-item")).toHaveLength(0);
    const failed = mountEmbedding({ loadError: "down" }).wrapper;
    expect(failed.findAll(".model-item")).toHaveLength(0);
    expect(failed.text()).toContain("down");
    await button(failed, t("common.retry"))!.trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("shows an add entry when no embedding model is configured", async () => {
    const { wrapper, save } = mountEmbedding({ model: null });
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    await wrapper.find("section").findAll("input")[0]!.setValue("https://new.example/v1");
    await saveDialog(wrapper);
    const updated = save.mock.calls[0]![0];
    expect(updated.baseUrl).toBe("https://new.example/v1");
    expect(updated.timeout).toBe("PT300S");
  });
});

describe("password visibility with the real dialog", () => {
  // ElDialog/teleport are not replaced: after a real close/destroy and rebuilt key rows, password inputs return to hidden by default.
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
          saving: false,
          save: async () => true,
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
        props: {
          model: { ...fixtures.embedding },
          loading: false,
          saving: false,
          loadError: "",
          save: async () => true,
        },
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
  it("is one page without tabs: model list, role card and embedding card, with no save button outside the cards", async () => {
    const page = await mountModelPage();
    expect(page.find(".el-tabs").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).exists()).toBe(true);
    expect(page.findComponent(RoleModelsCard).exists()).toBe(true);
    expect(page.findComponent(EmbeddingModelConfigCard).exists()).toBe(true);
    expect(page.findComponent(QuerySettingsCard).exists()).toBe(false);
    expect(page.findComponent(SkillDirConfigCard).exists()).toBe(false);
    expect(page.findAll("button").every((b) => b.element.closest(".config-card") !== null)).toBe(true);

    const system = await mountSystemPage();
    expect(system.findComponent(QuerySettingsCard).exists()).toBe(true);
    expect(system.findComponent(SkillDirConfigCard).exists()).toBe(true);
    expect(system.findComponent(ModelListCard).exists()).toBe(false);
    expect(system.findComponent(EmbeddingModelConfigCard).exists()).toBe(false);
  });

  it("saves a new model from its dialog at once, then saves roles from the role card", async () => {
    server.models = [];
    server.agents = Object.fromEntries(MODEL_ROLES.map((role) => [role, null]));
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    expect(list.text()).toContain(t("admin.modelListEmpty"));

    await button(list, t("admin.addModel"))!.trigger("click");
    await fillNewModel(list.find("section"), "fresh");
    await saveDialog(list.find("section"));
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
      agents: Object.fromEntries(MODEL_ROLES.map((role) => [role, null])),
    });
    // On success the dialog closes and the response (including Java's defaults) becomes the saved list.
    expect(list.find("section").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).props("models")).toMatchObject([
      { name: "fresh", maxTokens: 50000, contextWindow: 256000 },
    ]);

    // The saved model can be selected; role changes stay a draft until the role card saves them.
    expect(unsavedTag(page).exists()).toBe(false);
    roleSelect(page, "query").vm.$emit("update:modelValue", "fresh");
    roleSelect(page, "general").vm.$emit("update:modelValue", "fresh");
    await flushPromises();
    expect(unsavedTag(page).text()).toBe(t("admin.unsaved"));
    expect(adminApi.saveModelSettings).toHaveBeenCalledTimes(1);

    await saveRoles(page);
    expect(sent.settings).toMatchObject({
      models: [{ name: "fresh", maxTokens: 50000, contextWindow: 256000 }],
      agents: {
        query: "fresh",
        coding: null,
        general: "fresh",
        diagnosis: null,
        knowledgeGovernance: null,
      },
    });
    expect(unsavedTag(page).exists()).toBe(false);
    expect(server.reads).toBe(1);
  });

  it("a model save carries the saved roles, not the role draft, and keeps the draft", async () => {
    const page = await mountModelPage();
    roleSelect(page, "knowledgeGovernance").vm.$emit("update:modelValue", "qwen-lite");
    await flushPromises();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.findAll("section input")[1]!.setValue("Qwen Max");
    await saveDialog(list);
    expect(sent.settings).toMatchObject({
      models: [{ name: "qwen-main", displayName: "Qwen Max" }, { name: "qwen-lite" }],
      agents: fixtures.agents,
    });
    expect(roleSelect(page, "knowledgeGovernance").props("modelValue")).toBe("qwen-lite");
    expect(unsavedTag(page).exists()).toBe(true);
  });

  it("the role save submits exactly the saved model list and the five role keys in one request", async () => {
    const page = await mountModelPage();
    await saveRoles(page);
    const payload = sent.settings as { models: unknown[]; agents: Record<string, unknown> };
    expect(Object.keys(payload)).toEqual(["models", "agents"]);
    expect(Object.keys(payload.agents)).toEqual([...MODEL_ROLES]);
    // Roles carry only config IDs; the skill directory is not submitted with the model save.
    expect(payload.agents).toEqual(fixtures.agents);
    expect(payload.models).toEqual(fixtures.models);
  });

  it("deleting a model in use names its roles in the confirmation and saves them as not configured", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm");
    const page = await mountModelPage();
    const remove = () =>
      page
        .findComponent(ModelListCard)
        .findAll("button")
        .filter((b) => b.text() === t("common.delete"))[0]!
        .trigger("click");
    // A role draft pointing at the model is cleared too.
    roleSelect(page, "knowledgeGovernance").vm.$emit("update:modelValue", "qwen-main");

    confirm.mockRejectedValueOnce("cancel");
    await remove();
    await flushPromises();
    expect(adminApi.saveModelSettings).not.toHaveBeenCalled();
    expect(page.findComponent(ModelListCard).props("models")).toHaveLength(2);

    confirm.mockResolvedValueOnce("confirm" as never);
    await remove();
    await flushPromises();
    expect(confirm.mock.calls[1]![0]).toBe(
      t("admin.deleteModelInUseConfirm", {
        name: "Qwen (qwen-main)",
        roles: ["query", "coding", "diagnosis"].map((role) => t(`admin.modelRoleNames.${role}`)).join(", "),
      })
    );
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
    for (const role of ["query", "coding", "diagnosis", "knowledgeGovernance"]) {
      const select = roleSelect(page, role);
      expect(select.props("modelValue")).toBeNull();
      expect(select.find(".el-select__placeholder").text()).toBe(t("admin.roleNotConfigured"));
    }
    expect(roleSelect(page, "general").props("modelValue")).toBe("qwen-lite");
    expect(page.findComponent(RoleModelsCard).props("models")).toMatchObject([{ name: "qwen-lite" }]);
    expect(unsavedTag(page).exists()).toBe(false);
  });

  it("shows a persistent error with retry and offers no write entry when loading fails", async () => {
    vi.mocked(adminApi.getModelSettings).mockRejectedValueOnce(new Error("legacy role params"));
    const page = await mountModelPage();
    const alert = page.find(".load-error[role='alert']");
    expect(alert.text()).toContain("legacy role params");
    expect(page.findComponent(ModelListCard).exists()).toBe(false);
    expect(page.findComponent(RoleModelsCard).exists()).toBe(false);
    expect(button(page, t("admin.addModel"))).toBeUndefined();

    await button(alert, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(page.find(".load-error[role='alert']").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).props("models")).toHaveLength(2);
  });

  it("keeps the role draft and shows the backend message when the role save fails", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.mocked(adminApi.saveModelSettings).mockRejectedValueOnce(
      new Error("Model referenced by role query does not exist: gone")
    );
    const page = await mountModelPage();
    roleSelect(page, "knowledgeGovernance").vm.$emit("update:modelValue", "qwen-lite");
    await flushPromises();
    await saveRoles(page);
    expect(error).toHaveBeenCalledWith("Model referenced by role query does not exist: gone");
    expect(roleSelect(page, "knowledgeGovernance").props("modelValue")).toBe("qwen-lite");
    expect(unsavedTag(page).exists()).toBe(true);
  });

  it("keeps the model and embedding dialogs open when their save fails", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.mocked(adminApi.saveModelSettings).mockRejectedValueOnce(new Error("models rejected"));
    vi.mocked(adminApi.saveEmbeddingModel).mockRejectedValueOnce(new Error("embedding rejected"));
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.findAll("section input")[1]!.setValue("Qwen Max");
    await saveDialog(list);
    expect(error).toHaveBeenCalledWith("models rejected");
    expect(list.find("section").exists()).toBe(true);
    expect(list.props("models")[0].displayName).toBe("Qwen");

    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await saveDialog(embedding);
    expect(error).toHaveBeenCalledWith("embedding rejected");
    expect(embedding.find("section").exists()).toBe(true);
    expect(embedding.props("model")).toEqual(fixtures.embedding);
  });

  it("shows an ISO timeout in seconds and writes it back as PT{n}S", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    const numbers = list.findAll("section .el-input-number input");
    // In order: maxTokens, context window, timeout, retries, temperature, topP, maxCompletionTokens.
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual([
      "50000",
      "256000",
      "300",
      "99",
      "0.7",
      "",
      "",
    ]);
    await saveDialog(list);
    expect((sent.settings as { models: ModelEntry[] }).models[0]!.timeout).toBe("PT300S");
  });

  it("round-trips fields without controls through edit, save and test", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.find("section").findAll("input")[2]!.setValue("https://new.example.com/v1");
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await list.find("section").findAll(trash)[1]!.trigger("click");
    await saveDialog(list);

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
    // Unedited entries are submitted as-is.
    expect((sent.settings as { models: unknown[] }).models[1]).toEqual(fixtures.models[1]);

    // The test uses the saved entry and does not save again.
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
    expect(adminApi.saveModelSettings).toHaveBeenCalledTimes(1);
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

  it("saves the embedding model from its dialog as a full snapshot and tests the saved model", async () => {
    const page = await mountModelPage();
    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await saveDialog(embedding);
    expect(sent.embedding).toEqual({ ...fixtures.embedding, apiKey: "sk-embed-2" });
    expect(sent.settings).toBeNull();
    expect(embedding.find("section").exists()).toBe(false);

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
