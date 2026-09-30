import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import BusinessConfig from "../BusinessConfig.vue";
import DataAdapterConfigCard from "../business-config/DataAdapterConfigCard.vue";
import type { DataAdapterConnection, DataAdapterInfo } from "../../types";
import { adminApi } from "../../../admin";
import { workbenchI18n } from "../../../../i18n";
import { businessConfig } from "../../../../../../../apps/workbench/web/src/business-config";

/** Two backend GET /businessConfig/dataAdapters responses: the open-source edition installs only postgresql; a larger edition installs 9 (sorted by label). */
const openSourceAdapters: DataAdapterInfo[] = [
  {
    type: "postgresql",
    label: "PostgreSQL",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "postgres" },
  },
];
const enterpriseAdapters: DataAdapterInfo[] = [
  {
    type: "db2",
    label: "DB2",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:db2://host:port/db", user: "db2inst1" },
  },
  {
    type: "dm",
    label: "DM",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:dm://host:port/db", user: "SYSDBA" },
  },
  {
    type: "duckdb",
    label: "DuckDB",
    sql: true,
    fields: ["url"],
    examples: { url: "jdbc:duckdb:/data/example.duckdb" },
  },
  {
    type: "gaussdb",
    label: "GaussDB",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "gaussdb" },
  },
  { type: "m3", label: "M3", sql: false, fields: [], examples: {} },
  {
    type: "mysql",
    label: "MySQL",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:mysql://host:port/db?useSSL=false", user: "root" },
  },
  {
    type: "oracle",
    label: "Oracle",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:oracle:thin:@//host:port/service", user: "system" },
  },
  {
    type: "postgresql",
    label: "PostgreSQL",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:postgresql://host:port/db", user: "postgres" },
  },
  {
    type: "sqlserver",
    label: "SQL Server",
    sql: true,
    fields: ["url", "user", "password"],
    examples: { url: "jdbc:sqlserver://host:port;database=db", user: "sa" },
  },
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
          agents: { coding: { model: null } },
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

const placeholders = (card: Card) =>
  card.findAll("input.el-input__inner").map((input) => input.attributes("placeholder"));

describe("the data adapter card renders from the backend list", () => {
  it("the open-source list has only postgresql: shows just that item, selects the current type and fills in the saved connection", async () => {
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

  it("a 9-adapter list: shows all 9 items with display names from the backend label", async () => {
    const card = await mountCard(enterpriseAdapters, "m3");

    expect(radioLabels(card)).toEqual(enterpriseAdapters.map(({ label }) => label));
  });

  it("a type without fields such as M3 shows no connection form and saves only type", async () => {
    const card = await mountCard(enterpriseAdapters, "m3");

    expect(formLabels(card)).toEqual([t("admin.adapterMode")]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([{ type: "m3" }]);
    expect(vi.mocked(adminApi.useDataAdapter)).toHaveBeenCalledTimes(1);
  });

  it("DuckDB has only url: the form shows only the URL with the module example as placeholder and saves only that type's fields", async () => {
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
    expect(placeholders(card)).toEqual(["jdbc:duckdb:/data/example.duckdb"]);
    await card.find("input.el-input__inner").setValue("jdbc:duckdb:/data/a.duckdb");
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([{ type: "duckdb", url: "jdbc:duckdb:/data/a.duckdb" }]);
  });

  it("switching to a type with three fields: url and user use the module examples as placeholders and that type's url, user and password are saved", async () => {
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
    expect(placeholders(card)).toEqual([
      "jdbc:mysql://host:port/db?useSSL=false",
      "root",
      "******",
    ]);
    await card.find("button.el-button--primary").trigger("click");
    await flushPromises();

    expect(backend.used).toEqual([
      { type: "mysql", url: "jdbc:mysql://db/app", user: "root", password: "pw" },
    ]);
  });
});
