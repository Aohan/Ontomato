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
/** 企业布局给出的两项展示输入（企业 workbench-content 原值）。 */
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

describe("看板在两版布局下的展示输入", () => {
  it("我的看板关闭按钮：企业原文字 x；开源为带无障碍标签的图标按钮", () => {
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
    // 组件为 JS <script setup>，test-utils 推不出其 props 类型。
    await wrapper.setProps({ open: true } as never);
    await flushPromises();
    return wrapper;
  }

  it("放大弹窗：企业用 echarts 默认主题；开源先注册仪表盘主题再按主题名初始化", async () => {
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

  it("指标卡加载遮罩：企业保持默认底色；开源加透明遮罩类", () => {
    const metric = { name: "Orders", value: 1, unit: "", layout: { colSpan: 1, rowSpan: 1 } };
    useDashboardVisuals({ loadingMask: "default" });
    const enterprise = mount(MetricCard, { props: { metric }, global: global() });
    expect(enterprise.find(".value-container").classes()).not.toContain("value-container--transparent-loading");

    installWorkbenchContent(ossContent);
    const oss = mount(MetricCard, { props: { metric }, global: global() });
    expect(oss.find(".value-container").classes()).toContain("value-container--transparent-loading");
  });
});
