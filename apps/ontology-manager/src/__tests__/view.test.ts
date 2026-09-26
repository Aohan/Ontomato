import { beforeEach, describe, expect, it } from "vitest";
import { syncView } from "../view";
import { isolateShellPerTest } from "./isolation";

const resetShell = isolateShellPerTest();

function start(url: string, initialRoute = "") {
  resetShell();
  window.history.replaceState({}, "", url);
  return syncView(initialRoute);
}

describe("视图与 hash", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("非根 hash 优先于 view 参数与初始路由，查询串原样透传", () => {
    const { view } = start("/?view=assets#/visual-modeling?focus=object&id=A&back=playground", "/objects");
    expect(view.value).toBe("/visual-modeling?focus=object&id=A&back=playground");
  });

  it("根 hash 不算定位，view 参数映射到数据浏览与智能资产", () => {
    expect(start("/?view=data-browser#/").view.value).toBe("/data");
    expect(start("/?view=assets").view.value).toBe("/assets/metrics");
  });

  it("view=visual-modeling 映射到建模视图，focus/id/back 原样进入视图查询串，其他参数不带入", () => {
    expect(start("/?view=visual-modeling&theme=dark").view.value).toBe("/visual-modeling");
    expect(
      start("/?view=visual-modeling&focus=relation&id=placedBy&back=playground&keep=1").view.value
    ).toBe("/visual-modeling?focus=relation&id=placedBy&back=playground");
    expect(start("/?view=visual-modeling&id=Order#/data").view.value).toBe("/data");
  });

  it("其次取部署配置的初始路由并规范成路径，最后为 /playground", () => {
    expect(start("/?view=other", "#objects/A").view.value).toBe("/objects/A");
    expect(start("/", " /data ").view.value).toBe("/data");
    expect(start("/").view.value).toBe("/playground");
  });

  it("初始视图与组件导航都以替换方式写回 hash，不增加历史", () => {
    const before = window.history.length;
    const { view, replaceView } = start("/?view=assets");
    expect(window.location.hash).toBe("#/assets/metrics");
    replaceView("/assets/actions/a-1");
    expect(view.value).toBe("/assets/actions/a-1");
    expect(window.location.hash).toBe("#/assets/actions/a-1");
    expect(window.location.search).toBe("?view=assets");
    expect(window.history.length).toBe(before);
  });

  it("手动改 hash 时视图跟随", () => {
    const { view } = start("/#/data/Order");
    window.location.hash = "#/relations/placedBy";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(view.value).toBe("/relations/placedBy");
  });

  it("测试隔离：重新启动前撤销旧实例的 hashchange 监听", () => {
    const first = start("/#/data").view;
    const second = start("/#/objects").view;
    window.location.hash = "#/relations/placedBy";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(first.value).toBe("/data");
    expect(second.value).toBe("/relations/placedBy");
  });
});
