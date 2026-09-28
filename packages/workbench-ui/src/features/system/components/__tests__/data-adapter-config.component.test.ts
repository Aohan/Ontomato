import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import BusinessConfig from "../BusinessConfig.vue";
import DataAdapterConfigCard from "../business-config/DataAdapterConfigCard.vue";
import type { DataAdapterConnection, DataAdapterInfo } from "../../types";
import { adminApi } from "../../../admin";
import { workbenchI18n } from "../../../../i18n";
import { businessConfig } from "../../../../../../../apps/workbench/web/src/business-config";

/** 两版后端 GET /businessConfig/dataAdapters 的返回：开源只装 postgresql，企业装 9 个（按 label 排序）。 */
const openSourceAdapters: DataAdapterInfo[] = [
  { type: "postgresql", label: "PostgreSQL", sql: true, fields: ["url", "user", "password"] },
];
const enterpriseAdapters: DataAdapterInfo[] = [
  { type: "db2", label: "DB2", sql: true, fields: ["url", "user", "password"] },
  { type: "dm", label: "DM", sql: true, fields: ["url", "user", "password"] },
  { type: "duckdb", label: "DuckDB", sql: true, fields: ["url"] },
  { type: "gaussdb", label: "GaussDB", sql: true, fields: ["url", "user", "password"] },
  { type: "m3", label: "M3", sql: false, fields: [] },
  { type: "mysql", label: "MySQL", sql: true, fields: ["url", "user", "password"] },
  { type: "oracle", label: "Oracle", sql: true, fields: ["url", "user", "password"] },
  { type: "postgresql", label: "PostgreSQL", sql: true, fields: ["url", "user", "password"] },
  { type: "sqlserver", label: "SQL Server", sql: true, fields: ["url", "user", "password"] },
];

const backend = vi.hoisted(() => ({
  adapters: [] as unknown[],
  dataAdapter: "",
  connections: {} as Record<string, unknown>,
  used: [] as unknown[],
}));

vi.mock("../../../admin", () => ({
  adminApi: {
    getBusinessConfig: vi.fn(async () => ({
      success: true,
      data: JSON.parse(
        JSON.stringify({
          models: [],
          agents: {},
          lang: "en",
          dataAdapter: backend.dataAdapter,
          dataAdapterConnections: backend.connections,
        })
      ),
    })),
    listDataAdapters: vi.fn(async () => ({ success: true, data: backend.adapters })),
    useDataAdapter: vi.fn(async (payload: unknown) => {
      backend.used.push(JSON.parse(JSON.stringify(payload)));
      return { success: true };
    }),
    getSystemModelConfig: vi.fn(async () => ({ success: false, message: "not under test" })),
  },
}));

const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;
const global = { plugins: [i18n, ElementPlus], stubs: { teleport: true } };

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
beforeEach(() => {
  backend.used = [];
  backend.connections = {};
});

async function mountCard(
  adapters: DataAdapterInfo[],
  dataAdapter: string,
  connections: Record<string, DataAdapterConnection> = {}
) {
  backend.adapters = adapters;
  backend.dataAdapter = dataAdapter;
  backend.connections = connections;
  const page = mount(BusinessConfig, { props: businessConfig, global });
  wrappers.push(page);
  await flushPromises();
  return page.findComponent(DataAdapterConfigCard);
}

type Card = Awaited<ReturnType<typeof mountCard>>;

const radioLabels = (card: Card) => card.findAll(".el-radio").map((radio) => radio.text());
const formLabels = (card: Card) =>
  card.findAll(".el-form-item__label").map((label) => label.text());

describe("数据适配器卡片按后端列表渲染", () => {
  it("开源版列表只有 postgresql：只显示这一项，选中当前类型并回填已保存连接", async () => {
    const card = await mountCard(openSourceAdapters, "postgresql", {
      postgresql: { url: "jdbc:postgresql://db/app", user: "pg", password: "secret" },
    });

    expect(radioLabels(card)).toEqual(["PostgreSQL"]);
    expect(card.find(".el-radio.is-checked").text()).toBe("PostgreSQL");
    expect(
      card
        .findAll("input.el-input__inner")
        .map((input) => (input.element as HTMLInputElement).value)
    ).toEqual(["jdbc:postgresql://db/app", "pg", "secret"]);
  });

  it("企业版列表：显示全部 9 项，显示名取后端 label", async () => {
    const card = await mountCard(enterpriseAdapters, "m3");

    expect(radioLabels(card)).toEqual(enterpriseAdapters.map(({ label }) => label));
  });

  it("M3 这类无字段类型不显示连接表单，保存只提交 type", async () => {
    const card = await mountCard(enterpriseAdapters, "m3");

    expect(formLabels(card)).toEqual([t("admin.adapterMode")]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([{ type: "m3" }]);
    expect(vi.mocked(adminApi.useDataAdapter)).toHaveBeenCalledTimes(1);
  });

  it("DuckDB 只有 url：表单只显示连接地址，保存只提交该类型的字段", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      mysql: { url: "jdbc:mysql://other", user: "root", password: "x" },
    });
    await card
      .findAll(".el-radio")
      .find((radio) => radio.text() === "DuckDB")!
      .find("input")
      .setValue();
    await flushPromises();

    expect(formLabels(card)).toEqual([t("admin.adapterMode"), t("admin.connectionUrl")]);
    await card.find("input.el-input__inner").setValue("jdbc:duckdb:/data/a.duckdb");
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([{ type: "duckdb", url: "jdbc:duckdb:/data/a.duckdb" }]);
  });

  it("切换到带三项字段的类型：保存该类型的 url、user、password", async () => {
    const card = await mountCard(enterpriseAdapters, "m3", {
      mysql: { url: "jdbc:mysql://db/app", user: "root", password: "pw" },
    });
    await card
      .findAll(".el-radio")
      .find((radio) => radio.text() === "MySQL")!
      .find("input")
      .setValue();
    await flushPromises();

    expect(formLabels(card)).toEqual([
      t("admin.adapterMode"),
      t("admin.connectionUrl"),
      t("common.username"),
      t("common.password"),
    ]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([
      { type: "mysql", url: "jdbc:mysql://db/app", user: "root", password: "pw" },
    ]);
  });
});
