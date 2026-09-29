import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import DashboardSidebarPopover from "../DashboardSidebarPopover.vue";
import ChartZoomModal from "../ChartZoomModal.vue";
import MetricCard from "../MetricCard.vue";
import { workbenchI18n } from "../../../../i18n";
import { installWorkbenchContent, workbenchContent, type DashboardVisuals } from "../../../../content";

const echartsMock = vi.hoisted(() => ({
  registerTheme: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })),
}));
vi.mock("echarts", () => echartsMock);
vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const ossContent = workbenchContent();
/** Overrides the two dashboard display inputs another layout may supply (the non-default values). */
function useDashboardVisuals(patch: Partial<DashboardVisuals>) {
  installWorkbenchContent({ ...ossContent, dashboard: { ...ossContent.dashboard, ...patch } });
}
afterEach(() => {
  installWorkbenchContent(ossContent);
  echartsMock.registerTheme.mockClear();
  echartsMock.init.mockClear();
  document.body.innerHTML = "";
});

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus] });

describe("dashboard display inputs under both layouts", () => {
  it("my dashboards close button: plain text x by default; an icon button with an accessible label in the open-source layout", () => {
    const text = mount(DashboardSidebarPopover, { global: global() }).find(".dashboard-close-btn");
    expect(text.text()).toBe("x");
    expect(text.attributes("aria-label")).toBeUndefined();
    expect(text.find("svg").exists()).toBe(false);

    const icon = mount(DashboardSidebarPopover, { props: { closeIcon: true }, global: global() }).find(
      ".dashboard-close-btn"
    );
    expect(icon.attributes()).toMatchObject({ type: "button", "aria-label": "Close", title: "Close" });
    expect(icon.find("svg").exists()).toBe(true);
  });

  async function openZoom() {
    const wrapper = mount(ChartZoomModal, { props: { option: { series: [] } }, global: global() });
    // The component is a JS <script setup>, so test-utils cannot infer its props type.
    await wrapper.setProps({ open: true } as never);
    await flushPromises();
    return wrapper;
  }

  it("zoom dialog: echarts default theme when configured; open source registers the dashboard theme and initializes by theme name", async () => {
    useDashboardVisuals({ zoomChartTheme: "default" });
    await openZoom();
    expect(echartsMock.registerTheme).not.toHaveBeenCalled();
    expect(echartsMock.init).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(echartsMock.init.mock.calls[0]).toHaveLength(1);

    installWorkbenchContent(ossContent);
    echartsMock.init.mockClear();
    await openZoom();
    expect(echartsMock.registerTheme).toHaveBeenCalledWith(ossContent.dashboard.themeName, expect.any(Object));
    expect(echartsMock.init).toHaveBeenCalledWith(expect.any(HTMLElement), ossContent.dashboard.themeName);
  });

  it("metric card loading mask: default background when configured; open source adds the transparent mask class", () => {
    const metric = { name: "Orders", value: 1, unit: "", layout: { colSpan: 1, rowSpan: 1 } };
    useDashboardVisuals({ loadingMask: "default" });
    const enterprise = mount(MetricCard, { props: { metric }, global: global() });
    expect(enterprise.find(".value-container").classes()).not.toContain("value-container--transparent-loading");

    installWorkbenchContent(ossContent);
    const oss = mount(MetricCard, { props: { metric }, global: global() });
    expect(oss.find(".value-container").classes()).toContain("value-container--transparent-loading");
  });
});
