import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import BusinessConfig from "../BusinessConfig.vue";
import { workbenchI18n } from "../../../../i18n";
import { businessConfig } from "../../../../../../../apps/workbench/web/src/business-config";

/** Language resources the open-source data engine ships (conf-defaults/lang/*.json); tests run from this package. */
const shippedLanguages = readdirSync(resolve(process.cwd(), "../data-engine-core/conf-defaults/lang"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""));

interface Sent {
  url: string;
  body: unknown;
}
let sent: Sent[];
let storedLang: string;

beforeEach(() => {
  sent = [];
  storedLang = "fr";
  vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
    sent.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const data = url.endsWith("/businessConfig/getConfig")
      ? { agents: { coding: { model: null } }, lang: storedLang, dataAdapter: "", dataAdapterConnections: {} }
      : [];
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "Content-Type": "application/json" },
    });
  });
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mountPage() {
  const page = mount(BusinessConfig, {
    props: businessConfig,
    global: { plugins: [workbenchI18n(), ElementPlus] },
    attachTo: document.body,
  });
  wrappers.push(page);
  await flushPromises();
  return page;
}

const t = workbenchI18n().global.t as (key: string) => string;

describe("open-source system config page", () => {
  it("offers only the backend languages the data engine ships; a stored unsupported value shows en and is saved only on request", async () => {
    expect(businessConfig.languageOptions.map(({ value }) => value)).toEqual(shippedLanguages);
    const page = await mountPage();
    const languageRow = page
      .findAll(".el-form-item")
      .find((item) => item.text().includes(t("admin.backendLanguage")))!;
    await languageRow.find(".el-select__wrapper").trigger("click");
    await flushPromises();
    // The dropdown list is teleported; the select's input names it through aria-controls.
    const list = document.getElementById(languageRow.find("input").attributes("aria-controls")!)!;
    const options = [...list.querySelectorAll(".el-select-dropdown__item")].map((item) => item.textContent?.trim());
    expect(options).toEqual(["English"]);
    expect(list.querySelector(".el-select-dropdown__item.is-selected")?.textContent?.trim()).toBe("English");
    expect(sent.some((request) => request.url.endsWith("/businessConfig/saveLang"))).toBe(false);

    await languageRow.find("button.el-button--primary").trigger("click");
    await flushPromises();
    expect(sent.find((request) => request.url.endsWith("/businessConfig/saveLang"))?.body).toEqual({
      lang: "en",
    });
  });

  it("no longer carries query examples (they moved to their own menu page)", async () => {
    await mountPage();
    expect(sent.some((request) => request.url.endsWith("/bussinessexample/getall"))).toBe(false);
  });
});
