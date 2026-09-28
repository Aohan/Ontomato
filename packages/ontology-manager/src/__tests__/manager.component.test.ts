import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import OntologyManager from "../OntologyManager.vue";
import type { ManagerHostContext, ManagerPresentation } from "../context";
import { graphHandlers, graphRecord } from "./graph-double";

// 只替身图谱库内部；根组件、页面、请求客户端与 fetch 调用都是真实代码。
vi.mock("@antv/g6", async () => ({ Graph: (await import("./graph-double")).GraphDouble }));
vi.mock("@antv/x6", async () => ({
  Graph: (await import("./graph-double")).GraphDouble,
  Node: class {},
  Edge: class {},
}));

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

let requests: Recorded[];
let mountedApps: App[];
/** 按路径后缀挂起的响应：测试决定何时、以什么内容返回。 */
let held: Map<string, { resolve: (response: Response) => void }[]>;
let holdPaths: Set<string>;
let statusFor: (path: string) => number;
let metasFor: (url: string) => unknown;
let functions: Record<string, unknown>[];
let dataAdapter: string;
let dataAdapters: { type: string; label: string; sql: boolean; fields: string[] }[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const metas = (classes: string[]) => ({
  success: true,
  data: {
    classDef: classes.map((className) => ({
      className,
      showName: `${className}-label`,
      classDesc: `${className} desc`,
      attrs: [{ name: "id", showName: "ID", type: "string" }],
    })),
    relationship_rule: { has: { fromclass: "Order", toclass: "Item", desc: "has" } },
  },
});

function respond(url: string): Response {
  const path = url.replace(/^.*\/data-query/, "");
  const status = statusFor(path);
  if (status !== 200) return json({ success: false }, status);
  if (path === "/admin/getMetas") return json(metasFor(url));
  if (path === "/data/getWholeClassDataByPage")
    return json({ success: true, data: [{ id: "row-1" }], total_count: 1 });
  if (path === "/businessConfig/getConfig") return json({ success: true, data: { dataAdapter } });
  if (path === "/businessConfig/dataAdapters") return json({ success: true, data: dataAdapters });
  if (path === "/function/queryList") return json({ success: true, data: functions });
  if (path.endsWith("/queryList")) return json({ success: true, data: [] });
  return json({ success: true, data: {} });
}

beforeEach(() => {
  graphRecord.options = [];
  graphRecord.addedNodes = [];
  graphRecord.zoom = 1;
  graphRecord.zoomTo = [];
  requests = [];
  mountedApps = [];
  held = new Map();
  holdPaths = new Set();
  statusFor = () => 200;
  metasFor = () => metas(["Order", "Item"]);
  functions = [];
  dataAdapter = "mysql";
  dataAdapters = [
    { type: "m3", label: "M3", sql: false, fields: [] },
    { type: "mysql", label: "MySQL", sql: true, fields: ["url", "user", "password"] },
  ];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const path = url.replace(/^.*\/data-query/, "");
    requests.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (holdPaths.has(path)) {
      return new Promise<Response>((resolve) => {
        const waiting = held.get(path) ?? [];
        waiting.push({ resolve: () => resolve(respond(url)) });
        held.set(path, waiting);
      });
    }
    return Promise.resolve(respond(url));
  });
});

afterEach(() => {
  mountedApps.forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  document.body.innerHTML = "";
});

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

/** 最小宿主：持有上下文，按 v-model 语义写回 view，记录认证失败通知。 */
function mountHost(initial: ManagerHostContext) {
  const host = reactive({ ...initial });
  const views: string[] = [];
  const failures: number[] = [];
  const app = createApp({
    render: () =>
      h(OntologyManager, {
        ...host,
        "onUpdate:view": (view: string) => {
          views.push(view);
          host.view = view;
        },
        onAuthFailure: (status: number) => failures.push(status),
      }),
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  app.mount(element);
  mountedApps.push(app);
  return { host, views, failures, root: () => element.querySelector(".ontology-manager")! };
}

/** 企业固定源 c0287200 ontology-manager/src/api.ts:118、:322 的原值。 */
const enterpriseFallbacks = { noBusinessDescription: "未填写业务说明", unnamedAsset: "未命名资产" };

/** 测试用展示值：只用于辨认组件取值来自宿主，不是任一产品的原值（两版原值由应用 presentation 与证据审计核对）。 */
const presentation: ManagerPresentation = {
  themeProperties: {
    light: { "--el-color-primary": "#101010", "--manager-relation-icon-color": "#202020" },
    dark: { "--el-color-primary": "#e0e0e0", "--manager-relation-icon-color": "#d0d0d0" },
  },
  nodePalette: ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"],
  edgeLabel: {},
  maxFitZoom: null,
  dataBrowserDescription: (objectLabel) => `description of ${objectLabel}`,
  compactDialogs: false,
};

const base: ManagerHostContext = {
  apiBase: "/tenant-a/api",
  credential: { type: "apiKey", apiKey: "key-a" },
  locale: "en",
  theme: "light",
  view: "/playground",
  dataFallbacks: enterpriseFallbacks,
  presentation,
};

const paths = (list = requests) =>
  list.map((request) => request.url.replace(/^.*\/data-query/, ""));

function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text || item.querySelector("span")?.textContent === text
  );
  if (!button) throw new Error(`找不到按钮：${text}`);
  button.click();
}

describe("OntologyManager 根组件与真实页面", () => {
  it("非默认 API 入口与 APIKey：图谱、目录计数的真实请求都发往宿主入口并带 x-api-key", async () => {
    mountHost(base);
    await settle();

    expect(paths()).toEqual(
      expect.arrayContaining([
        "/admin/getMetas",
        "/metricView/queryList",
        "/action/queryList",
        "/function/queryList",
        "/writeTask/queryList",
      ])
    );
    for (const request of requests) {
      expect(request.url.startsWith("/tenant-a/api/data-query/")).toBe(true);
      expect(request.headers["x-api-key"]).toBe("key-a");
      expect(request.headers.tk).toBeUndefined();
      expect(request.headers["Accept-Language"]).toBe("en");
    }
  });

  it("view 定位数据浏览；内部导航经 update:view 交还宿主，未知路径按原规则回到图谱", async () => {
    const { host, views } = mountHost({ ...base, view: "/data/Item" });
    await settle();

    const page = requests.find((request) => request.url.endsWith("/data/getWholeClassDataByPage"));
    expect(page?.body).toEqual({ classname: "Item", pagenum: 1, pagecount: 20 });
    expect(page?.headers["x-api-key"]).toBe("key-a");

    clickButton("Object Types");
    await settle();
    expect(views.at(-1)).toBe("/objects");
    expect(host.view).toBe("/objects");

    host.view = "/unknown";
    await settle();
    expect(views.at(-1)).toBe("/playground");
  });

  it("theme 只驱动组件根，不读取也不修改宿主 html.dark", async () => {
    const { host, root } = mountHost({ ...base, theme: "dark" });
    await settle();
    expect(root().classList.contains("is-dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    host.theme = "light";
    document.documentElement.classList.add("dark");
    await settle();
    expect(root().classList.contains("is-dark")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("locale 驱动组件词条、Element Plus 语种与 Accept-Language", async () => {
    const { host, root } = mountHost({ ...base, locale: "zh-CN", view: "/data/Order" });
    await settle();
    expect(root().getAttribute("lang")).toBe("zh-CN");
    expect(root().textContent).toContain("数据浏览");
    expect(root().querySelector(".el-pagination__total")?.textContent).toContain("共");
    expect(requests.every((request) => request.headers["Accept-Language"] === "zh-CN")).toBe(true);

    requests = [];
    host.locale = "en";
    await settle();
    expect(root().textContent).toContain("Data Browser");
    expect(root().querySelector(".el-pagination__total")?.textContent).toContain("Total");
    expect(requests).toEqual([]);

    host.view = "/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);
  });

  it("缺少凭据时不渲染工作区也不发请求；宿主给出 token 后按新凭据加载", async () => {
    const { host, root } = mountHost({ ...base, credential: null });
    await settle();
    expect(requests).toEqual([]);
    expect(root().querySelector(".ontology-manager-shell")).toBeNull();

    host.credential = { type: "token", token: "tok-1" };
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.headers.tk).toBe("tok-1");
      expect(request.headers["x-api-key"]).toBeUndefined();
    }
  });

  it("宿主切换 API 入口与凭据后，旧入口的在途响应不进入新宿主的页面", async () => {
    holdPaths.add("/admin/getMetas");
    metasFor = (url) => metas(url.startsWith("/tenant-a/") ? ["Stale"] : ["Fresh"]);
    const { host, root } = mountHost({ ...base, view: "/data" });
    await settle();
    const staleWaiting = held.get("/admin/getMetas")!.splice(0);

    host.apiBase = "/tenant-b/api";
    host.credential = { type: "token", token: "tok-b" };
    await settle();
    holdPaths.clear();
    held
      .get("/admin/getMetas")!
      .splice(0)
      .forEach((waiting) => waiting.resolve(new Response()));
    staleWaiting.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    const afterSwitch = requests.filter((request) => request.url.startsWith("/tenant-b/"));
    expect(afterSwitch.every((request) => request.headers.tk === "tok-b")).toBe(true);
    const pageRequests = requests.filter((request) =>
      request.url.endsWith("/data/getWholeClassDataByPage")
    );
    expect(
      pageRequests.map((request) => [request.url.split("/data-query")[0], request.body?.classname])
    ).toEqual([["/tenant-b/api", "Fresh"]]);
    expect(root().textContent).not.toContain("Stale");
  });

  it("401/402 只通知宿主；402 后凭据保留，后续请求仍带原凭据", async () => {
    statusFor = (path) =>
      path === "/action/queryList" ? 402 : path === "/function/queryList" ? 401 : 200;
    const { host, failures } = mountHost(base);
    await settle();
    expect(failures.sort()).toEqual([401, 402]);
    expect(host.credential).toEqual({ type: "apiKey", apiKey: "key-a" });

    requests = [];
    statusFor = () => 200;
    host.view = "/data/Order";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["x-api-key"] === "key-a")).toBe(true);
  });

  it("可视化建模：按 view 聚焦对象，逐字段编辑保持原先后顺序，返回交还宿主", async () => {
    const { views } = mountHost({
      ...base,
      view: "/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    const config = requests.find((request) => request.url.endsWith("/businessConfig/getConfig"));
    expect(config?.method).toBe("GET");
    expect(config?.headers["x-api-key"]).toBe("key-a");

    clickButton("Edit");
    await settle();
    const dialog = [...document.querySelectorAll(".el-dialog")].find((item) =>
      item.textContent?.includes("Update")
    )!;
    const [, showName] = [...dialog.querySelectorAll("input")];
    const description = dialog.querySelector("textarea")!;
    showName.value = "Order renamed";
    showName.dispatchEvent(new Event("input"));
    description.value = "Order desc renamed";
    description.dispatchEvent(new Event("input"));
    await settle();

    holdPaths.add("/admin/editClassShowName");
    requests = [];
    clickButton("Update");
    await settle();
    expect(paths()).toEqual(["/admin/editClassShowName"]);
    expect(requests[0].body).toEqual({ className: "Order", showName: "Order renamed" });

    holdPaths.clear();
    held.get("/admin/editClassShowName")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();
    expect(paths()).toEqual(["/admin/editClassShowName", "/admin/editClassDesc"]);
    expect(requests[1].body).toEqual({ className: "Order", desc: "Order desc renamed" });

    clickButton("Back to graph");
    await settle();
    expect(views.at(-1)).toBe("/playground");
  });

  it.each([
    ["mysql", true],
    ["m3", false],
  ])("可视化建模：当前适配器 %s 按后端列表的 sql 标记决定关系是否填关联字段", async (current, sql) => {
    dataAdapter = current;
    mountHost({ ...base, view: "/visual-modeling?focus=object&id=Order&back=playground" });
    await settle();
    expect(paths()).toContain("/businessConfig/dataAdapters");

    graphHandlers["edge:dblclick"]!({ edge: { id: "has" } });
    await settle();
    expect(openDialog("Rel Desc").textContent?.includes("Src Field")).toBe(sql);
  });

  it("仅 locale/theme 变化时打开的编辑对话框与输入保留，不重新加载", async () => {
    const { host } = mountHost({
      ...base,
      view: "/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Edit");
    await settle();
    const dialog = openDialog("Update");
    const [, showName] = [...dialog.querySelectorAll("input")];
    showName.value = "Unsaved name";
    showName.dispatchEvent(new Event("input"));
    await settle();

    requests = [];
    host.locale = "zh-CN";
    host.theme = "dark";
    await settle();
    const after = openDialog("更新");
    expect(after).toBe(dialog);
    expect([...after.querySelectorAll("input")][1].value).toBe("Unsaved name");
    expect(paths()).not.toContain("/admin/getMetas");
  });

  // 嵌入场景：iframe 以启动语言加载，宿主随后发来当前语言；同一身份的首批数据须照常呈现（原主系统只按凭据核对结果）。
  it.each([
    ["数据浏览", "/data/Order"],
    ["可视化建模", "/visual-modeling?focus=object&id=Order&back=playground"],
  ])("%s：首批 getMetas 在途时宿主切换语言，数据照常呈现，之后的请求带新语言", async (_name, view) => {
    holdPaths.add("/admin/getMetas");
    const { host, root } = mountHost({ ...base, view });
    await settle();
    host.locale = "zh-CN";
    await settle();
    holdPaths.clear();
    held.get("/admin/getMetas")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    expect(document.querySelector(".el-message")).toBeNull();
    if (view.startsWith("/data/")) {
      const page = requests.find((request) => request.url.endsWith("/data/getWholeClassDataByPage"));
      expect(page?.body).toMatchObject({ classname: "Order" });
      expect(page?.headers["Accept-Language"]).toBe("zh-CN");
      expect(root().textContent).toContain("row-1");
    } else {
      expect(root().querySelector(".visual-modeling .el-tag")?.textContent).toContain("Order-label");
    }
    // 切换语言不触发重新加载：元数据只有切换前以 en 发出的那一批。
    const metaRequests = requests.filter((request) => request.url.endsWith("/admin/getMetas"));
    expect(metaRequests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);

    requests = [];
    host.view = "/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "zh-CN")).toBe(true);
  });

  it("多步保存进行中只切换语言：后续步骤照常发送一次，不重发已发出的请求", async () => {
    const { host } = mountHost({
      ...base,
      view: "/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Edit");
    await settle();
    const dialog = openDialog("Update");
    const [, showName] = [...dialog.querySelectorAll("input")];
    const description = dialog.querySelector("textarea")!;
    showName.value = "Order renamed";
    showName.dispatchEvent(new Event("input"));
    description.value = "Order desc renamed";
    description.dispatchEvent(new Event("input"));
    await settle();

    holdPaths.add("/admin/editClassShowName");
    requests = [];
    clickButton("Update");
    await settle();
    host.locale = "zh-CN";
    await settle();
    holdPaths.clear();
    held.get("/admin/editClassShowName")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    expect(paths().slice(0, 2)).toEqual(["/admin/editClassShowName", "/admin/editClassDesc"]);
    expect(paths().filter((path) => path === "/admin/editClassShowName")).toHaveLength(1);
    expect(paths().filter((path) => path === "/admin/editClassDesc")).toHaveLength(1);
    expect(requests[0].headers["Accept-Language"]).toBe("en");
    expect(requests[1].headers["Accept-Language"]).toBe("zh-CN");
  });

  it("确认删除期间宿主切换 API 入口与凭据：旧确认随旧工作区结束，不向任何来源发删除", async () => {
    const { host } = mountHost({ ...base, view: "/objects/Order" });
    await settle();
    clickButton("Delete");
    await settle();
    expect(confirmDialog()).not.toBeNull();

    host.apiBase = "/tenant-b/api";
    host.credential = { type: "token", token: "tok-b" };
    await settle();
    expect(confirmDialog()).toBeNull();
    expect(paths()).not.toContain("/admin/delClass");
  });

  it("多步删除进行中切换凭据：旧工作区后续步骤不再发送", async () => {
    const { host } = mountHost({
      ...base,
      view: "/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Delete");
    await settle();
    holdPaths.add("/admin/delRelationship");
    clickButton("OK");
    await settle();
    expect(paths().filter((path) => path === "/admin/delRelationship")).toHaveLength(1);

    host.credential = { type: "token", token: "tok-b" };
    await settle();
    holdPaths.clear();
    held.get("/admin/delRelationship")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();
    expect(paths().filter((path) => path === "/admin/delRelationship")).toHaveLength(1);
    expect(paths()).not.toContain("/admin/delClass");
    // 旧后续的失败提示不显示，也不会落到 body 下。
    expect(document.querySelector(".el-message")).toBeNull();
  });

  it("凭据 A→B→A 期间多步删除：已卸载的旧工作区不再交付响应或发送后续", async () => {
    const { host } = mountHost({
      ...base,
      view: "/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Delete");
    await settle();
    holdPaths.add("/admin/delRelationship");
    clickButton("OK");
    await settle();

    host.credential = { type: "token", token: "tok-b" };
    await settle();
    host.credential = { type: "apiKey", apiKey: "key-a" };
    await settle();
    holdPaths.clear();
    held.get("/admin/delRelationship")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();
    expect(paths()).not.toContain("/admin/delClass");
  });

  it("同页两个实例：主题、弹层容器、消息与确认互不影响", async () => {
    statusFor = (path) => (path === "/data/getWholeClassDataByPage" ? 500 : 200);
    const a = mountHost({ ...base, theme: "dark", view: "/data/Order" });
    const b = mountHost({ ...base, apiBase: "/tenant-b/api", view: "/objects/Order" });
    await settle();

    expect(a.root().classList.contains("is-dark")).toBe(true);
    expect(b.root().classList.contains("is-dark")).toBe(false);
    // 下拉弹层与错误消息都在 A 自己的根内，不在 body 下另建容器。
    expect(a.root().querySelector(".el-select__popper")).not.toBeNull();
    expect(a.root().querySelector(".el-message--error")).not.toBeNull();
    expect(b.root().querySelector(".el-message")).toBeNull();
    expect(document.body.querySelector(":scope > [id*='popper-container']")).toBeNull();

    // B 打开确认后，A 换凭据只重建 A，B 的确认仍在。
    [...b.root().querySelectorAll("button")]
      .find((item) => item.textContent?.trim() === "Delete")!
      .click();
    await settle();
    expect(b.root().querySelector(".manager-confirm")).not.toBeNull();
    a.host.credential = { type: "token", token: "tok-a2" };
    await settle();
    expect(b.root().querySelector(".manager-confirm")).not.toBeNull();
  });

  it("宿主展示值绑在各自真实根元素上：按 theme 整组切换，窄屏对话框开关只作用于本实例", async () => {
    const compact: ManagerPresentation = {
      ...presentation,
      themeProperties: {
        light: { "--el-color-primary": "#303030" },
        dark: { "--el-color-primary": "#c0c0c0" },
      },
      compactDialogs: true,
    };
    const a = mountHost(base);
    const b = mountHost({ ...base, apiBase: "/tenant-b/api", presentation: compact });
    await settle();
    const value = (root: Element, name: string) => (root as HTMLElement).style.getPropertyValue(name);

    expect(value(a.root(), "--el-color-primary")).toBe("#101010");
    expect(value(a.root(), "--manager-relation-icon-color")).toBe("#202020");
    expect(value(b.root(), "--el-color-primary")).toBe("#303030");
    expect(a.root().classList.contains("is-compact-dialogs")).toBe(false);
    expect(b.root().classList.contains("is-compact-dialogs")).toBe(true);

    requests = [];
    a.host.theme = "dark";
    await settle();
    expect(value(a.root(), "--el-color-primary")).toBe("#e0e0e0");
    expect(value(a.root(), "--manager-relation-icon-color")).toBe("#d0d0d0");
    expect(value(b.root(), "--el-color-primary")).toBe("#303030");
    expect(requests).toEqual([]);
  });

  it("图谱与建模的节点色板、边标签片段和适配上限取宿主值", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
    } as DOMRect);
    const oss: ManagerPresentation = {
      ...presentation,
      edgeLabel: { labelPlacement: "center", labelAutoRotate: false },
      maxFitZoom: 1,
    };
    graphRecord.zoom = 2.5;
    mountHost({ ...base, presentation: oss });
    await settle();
    const graph = graphRecord.options[0];
    const colors = graph.data.nodes.map((node: any) => node.data.color);
    expect(colors.length).toBe(2);
    expect(colors.every((color: string) => presentation.nodePalette.includes(color))).toBe(true);
    expect(graph.edge.style).toMatchObject({ labelPlacement: "center", labelAutoRotate: false });
    expect(graphRecord.zoomTo).toEqual([[1, false]]);

    // 不设上限、空片段：不改缩放，边样式没有这两项。
    mountedApps.forEach((app) => app.unmount());
    graphRecord.options = [];
    graphRecord.zoomTo = [];
    mountHost(base);
    await settle();
    expect(graphRecord.zoomTo).toEqual([]);
    expect(graphRecord.options[0].edge.style).not.toHaveProperty("labelPlacement");
    expect(graphRecord.options[0].edge.style).not.toHaveProperty("labelAutoRotate");

    // 可视化建模按同一色板、同一类名取同一颜色。
    const byClass = Object.fromEntries(
      graphRecord.options[0].data.nodes.map((node: any) => [node.id, node.data.color])
    );
    mountedApps.forEach((app) => app.unmount());
    mountHost({ ...base, view: "/visual-modeling" });
    await settle();
    const fills = Object.fromEntries(
      graphRecord.addedNodes.map((node: any) => [node.id, node.attrs.body.fill])
    );
    expect(fills).toEqual(byClass);
  });

  it("数据浏览页头说明由宿主函数按当前对象显示名给出", async () => {
    const { root } = mountHost({ ...base, view: "/data/Order" });
    await settle();
    expect(root().textContent).toContain("description of Order-label");
  });

  it("说明兜底取宿主装配值预填表单，切换 locale/theme 不变，修改后随原字段提交", async () => {
    metasFor = () => ({
      success: true,
      data: { classDef: [{ className: "Order", showName: "Order", classDesc: "", attrs: [] }] },
    });
    const { host, root } = mountHost({ ...base, view: "/objects/Order" });
    await settle();
    const textarea = () => root().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea().value).toBe("未填写业务说明");

    host.locale = "zh-CN";
    host.theme = "dark";
    await settle();
    host.locale = "en";
    await settle();
    expect(textarea().value).toBe("未填写业务说明");

    textarea().value = "未填写业务说明（补充）";
    textarea().dispatchEvent(new Event("input"));
    await settle();
    requests = [];
    clickButton("Save Changes");
    await settle();
    expect(requests.find((r) => r.url.endsWith("/admin/editClassDesc"))?.body).toEqual({
      className: "Order",
      desc: "未填写业务说明（补充）",
    });
  });

  it("无名称函数取宿主装配名，切换 locale/theme 后仍随定时任务保存载荷提交", async () => {
    functions = [{ id: "fn-1", operation: "OPERATION_WRITE" }];
    const { host, root } = mountHost({ ...base, view: "/assets/tasks/new" });
    await settle();
    const inputs = () => [...root().querySelectorAll<HTMLInputElement>(".asset-form input")];
    const name = inputs()[0];
    name.value = "nightly";
    name.dispatchEvent(new Event("input"));
    const cron = inputs().find((input) => input.placeholder === "e.g. 0 */5 * * * ?")!;
    cron.value = "0 0 * * * ?";
    cron.dispatchEvent(new Event("input"));
    const option = [...root().querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find(
      (item) => item.textContent?.trim() === "未命名资产"
    )!;
    option.click();
    await settle();

    host.locale = "zh-CN";
    host.theme = "dark";
    await settle();
    requests = [];
    clickButton("保存");
    await settle();
    const saved = requests.find((r) => r.url.endsWith("/writeTask/save"))?.body;
    // 线上 JSON：未定义字段不出现，name 为宿主装配的企业原值。
    expect(saved?.function).toStrictEqual({
      id: "fn-1",
      operation: "OPERATION_WRITE",
      name: "未命名资产",
      description: null,
    });
  });

  it("编辑对话框挂在本实例根内的弹层容器，打开关闭都不改 body", async () => {
    const { root } = mountHost({ ...base, view: "/objects/Order" });
    await settle();
    const bodyBefore = [
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ];
    clickButton("New Attribute");
    await settle();
    const dialog = openDialog("Create");
    expect(dialog.closest(".ontology-manager > [id*='popper-container']")).not.toBeNull();
    expect(root().contains(dialog)).toBe(true);
    expect([
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ]).toEqual(bodyBefore);
    clickButton("Cancel");
    await settle();
    expect([
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ]).toEqual(bodyBefore);
  });
});

function openDialog(buttonText: string) {
  const dialog = [...document.querySelectorAll(".el-dialog")].find((item) =>
    item.textContent?.includes(buttonText)
  );
  if (!dialog) throw new Error(`找不到对话框：${buttonText}`);
  return dialog;
}

/** 当前显示中的确认框；关闭后 EP 保留隐藏的遮罩，工作区卸载后则整个移除。 */
function confirmDialog() {
  const overlay = document.querySelector(".manager-confirm")?.closest<HTMLElement>(".el-overlay");
  return overlay && overlay.style.display !== "none" ? overlay : null;
}
