import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import SkillManager from "../components/SkillManager.vue";

/*
 * The merged skill page: one list filtered by All / Analysis / Chart (kept in the category query); creating a skill
 * picks its category first, a chart skill is locked to executable; editing keeps the category fixed.
 */
const i18n = workbenchI18n();
const t = i18n.global.t;

const skills = [
  { id: "trend-analysis", type: "knowledge", category: "analysis", tags: [], enabled: true, version: "1" },
  { id: "bar-chart", type: "executable", category: "visualization", tags: [], enabled: true, version: "1" },
];

beforeEach(() => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ success: true, skills, scriptCode: "", skillContent: "" }), {
      headers: { "Content-Type": "application/json" },
    })
  );
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mountPage(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/admin/skills", component: SkillManager }],
  });
  await router.push(path);
  const wrapper = mount(SkillManager, {
    attachTo: document.body,
    global: { plugins: [i18n, ElementPlus, router] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const titles = () => wrapper.findAll(".skill-title").map((item) => item.text());
  return { wrapper, router, titles };
}

/** Form item (inside the teleported dialog) whose label is the given text. */
function formItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>(".el-dialog .el-form-item")].find(
    (item) => item.querySelector(".el-form-item__label")?.textContent?.trim() === label
  )!;
}

function selectedText(label: string) {
  return formItem(label).querySelector(".el-select__selected-item:not(.is-hidden)")?.textContent?.trim();
}

function selectDisabled(label: string) {
  return formItem(label).querySelector(".el-select__wrapper")!.classList.contains("is-disabled");
}

describe("merged skill page", () => {
  it("filters one list by All / Analysis / Chart and keeps the filter in the category query", async () => {
    const { wrapper, router, titles } = await mountPage("/admin/skills");
    expect(titles()).toEqual(["trend-analysis", "bar-chart"]);

    const filter = (label: string) =>
      wrapper.findAll(".el-radio-button").find((item) => item.text() === label)!.find("input");
    await filter(t("admin.visualization")).setValue(true);
    await flushPromises();
    expect(router.currentRoute.value.query.category).toBe("visualization");
    expect(titles()).toEqual(["bar-chart"]);

    await filter(t("admin.analysis")).setValue(true);
    await flushPromises();
    expect(titles()).toEqual(["trend-analysis"]);

    await filter(t("common.all")).setValue(true);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({});
    expect(titles()).toEqual(["trend-analysis", "bar-chart"]);
  });

  it("creating a chart skill locks the type to executable; the current filter is the initial category", async () => {
    const { wrapper } = await mountPage("/admin/skills");
    await wrapper.findAll(".toolbar-actions button").at(-1)!.trigger("click");
    await flushPromises();
    expect(selectedText(t("common.category"))).toBe(t("admin.analysis"));
    expect(selectDisabled(t("common.category"))).toBe(false);
    expect(selectDisabled(t("common.type"))).toBe(false);

    formItem(t("common.category")).querySelector<HTMLElement>(".el-select__wrapper")!.click();
    await flushPromises();
    [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((item) => item.textContent?.trim() === t("admin.visualization"))!
      .click();
    await flushPromises();
    expect(selectedText(t("common.type"))).toBe(t("admin.executable"));
    expect(selectDisabled(t("common.type"))).toBe(true);

    const chartFiltered = await mountPage("/admin/skills?category=visualization");
    await chartFiltered.wrapper.findAll(".toolbar-actions button").at(-1)!.trigger("click");
    await flushPromises();
    expect(selectedText(t("common.category"))).toBe(t("admin.visualization"));
  });

  it("editing a skill keeps its category fixed", async () => {
    const { wrapper } = await mountPage("/admin/skills?category=visualization");
    await wrapper.get(".more-btn").trigger("click");
    await flushPromises();
    [...document.querySelectorAll<HTMLElement>(".el-dropdown-menu__item")]
      .find((item) => item.textContent?.trim() === t("common.edit"))!
      .click();
    await flushPromises();
    expect(selectedText(t("common.category"))).toBe(t("admin.visualization"));
    expect(selectDisabled(t("common.category"))).toBe(true);
  });
});
