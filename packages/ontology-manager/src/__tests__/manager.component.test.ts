import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import OntologyManager from "../OntologyManager.vue";
import type { ManagerHostContext, ManagerPresentation } from "../context";
import { englishMessages, type ManagerMessages } from "../i18n";
import de from "element-plus/es/locale/lang/de";
import { graphHandlers, graphRecord } from "./graph-double";

// Only the graph library internals are doubled; the root component, pages, request client and fetch calls are real code.
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
/** Responses held by path suffix: the test decides when and with what they return. */
let held: Map<string, { resolve: (response: Response) => void }[]>;
let holdPaths: Set<string>;
let statusFor: (path: string) => number;
let metasFor: (url: string) => unknown;
let functions: Record<string, unknown>[];
let dataAdapter: string;
let dataAdapters: { type: string; label: string; sql: boolean; fields: string[] }[];
let knowledge: Record<string, Record<string, unknown>>;
/** Knowledge IDs whose delete returns a business failure. */
let knowledgeDeleteFails: Set<string>;

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

function respond(url: string, body?: Record<string, unknown>): Response {
  const path = url.replace(/^.*\/data-query/, "");
  const status = statusFor(path);
  if (status !== 200) return json({ success: false }, status);
  if (path === "/admin/getBussinessKnowledge") return json({ success: true, data: knowledge });
  if (path === "/admin/delBussinessKnowledge" && knowledgeDeleteFails.has(String(body?.knowledgeID)))
    return json({ success: false, message: "locked" });
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
  knowledge = {
    k1: { knowledgeID: "k1", knowledgeTitle: "Refund rule", knowledgeText: "t1", knowledgeTags: ["Business"], status: 1, knowledgeVector: [0.1] },
    k2: { knowledgeID: "k2", knowledgeTitle: "Legacy note", knowledgeText: "t2", status: 0 },
  };
  knowledgeDeleteFails = new Set();
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const path = url.replace(/^.*\/data-query/, "");
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body,
    });
    if (holdPaths.has(path)) {
      return new Promise<Response>((resolve) => {
        const waiting = held.get(path) ?? [];
        waiting.push({ resolve: () => resolve(respond(url, body)) });
        held.set(path, waiting);
      });
    }
    return Promise.resolve(respond(url, body));
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

/** Minimal host: holds the context, writes view back with v-model semantics and records auth-failure notifications. */
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

/** Host-supplied data defaults that differ from the open-source values, so the tests can tell which one was used. */
const hostFallbacks = { noBusinessDescription: "Host: no description", unnamedAsset: "Host: unnamed asset" };

/** A pseudo-locale for switching tests: the English messages with a marker plus a real widget locale, standing in for any host translation. */
function markedMessages(marker: string, element: ManagerMessages["element"]): ManagerMessages {
  const mark = (table: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(table).map(([key, value]) => [key, `${marker}${value}`]));
  return {
    ontology: mark(englishMessages.ontology),
    shared: Object.fromEntries(
      Object.entries(englishMessages.shared).map(([group, table]) => [group, mark(table)])
    ),
    element,
  } as ManagerMessages;
}

/** The host switches locale and messages together. */
const english = { locale: "en", messages: englishMessages };
const german = { locale: "de", messages: markedMessages("[de] ", de) };

/** Test presentation values: only used to recognise that the component reads them from the host; they are not either product's values (those are checked by the app presentation and evidence audit). */
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
  ...english,
  theme: "light",
  view: "/playground",
  dataFallbacks: hostFallbacks,
  presentation,
  knowledgeTagValues: { general: "tag-g", business: "tag-b", tech: "tag-t" },
  embedded: false,
  knowledgeGovernanceUrl: null,
};

const paths = (list = requests) =>
  list.map((request) => request.url.replace(/^.*\/data-query/, ""));

function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text || item.querySelector("span")?.textContent === text
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.click();
}

describe("OntologyManager root component with real pages", () => {
  it("non-default API entry and API key: real graph and catalog-count requests go to the host entry with x-api-key", async () => {
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

  it("view locates data browsing; internal navigation goes back to the host through update:view, unknown paths return to the graph by the original rule", async () => {
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

  it("theme only drives the component root and neither reads nor changes the host html.dark", async () => {
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

  it("host resources drive the component text and Element Plus widgets; locale drives lang and Accept-Language", async () => {
    const { host, root } = mountHost({ ...base, ...german, view: "/data/Order" });
    await settle();
    expect(root().getAttribute("lang")).toBe("de");
    expect(root().textContent).toContain("[de] Data Browser");
    expect(root().querySelector(".el-pagination__total")?.textContent).toContain("Gesamt");
    expect(requests.every((request) => request.headers["Accept-Language"] === "de")).toBe(true);

    requests = [];
    Object.assign(host, english);
    await settle();
    expect(root().textContent).toContain("Data Browser");
    expect(root().textContent).not.toContain("[de] ");
    expect(root().querySelector(".el-pagination__total")?.textContent).toContain("Total");
    expect(requests).toEqual([]);

    host.view = "/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);
  });

  it("without a credential the workspace is not rendered and no request is sent; once the host supplies a token it loads with it", async () => {
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

  it("after the host switches API entry and credential, in-flight responses from the old entry do not reach the new host's pages", async () => {
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

  it("401/402 only notify the host; after 402 the credential is kept and later requests still carry it", async () => {
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

  it("visual modeling: focuses the object from view, field-by-field edits keep the original order, and back returns to the host", async () => {
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
  ])("visual modeling: with current adapter %s, the backend list's sql flag decides whether relations take join fields", async (current, sql) => {
    dataAdapter = current;
    mountHost({ ...base, view: "/visual-modeling?focus=object&id=Order&back=playground" });
    await settle();
    expect(paths()).toContain("/businessConfig/dataAdapters");

    graphHandlers["edge:dblclick"]!({ edge: { id: "has" } });
    await settle();
    expect(openDialog("Rel Desc").textContent?.includes("Src Field")).toBe(sql);
  });

  it("when only locale/theme change, the open edit dialog and its input are kept without reloading", async () => {
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
    Object.assign(host, german);
    host.theme = "dark";
    await settle();
    const after = openDialog("[de] Update");
    expect(after).toBe(dialog);
    expect([...after.querySelectorAll("input")][1].value).toBe("Unsaved name");
    expect(paths()).not.toContain("/admin/getMetas");
  });

  // Embedded case: the iframe loads with the startup locale and the host then sends its current locale; the first data for the same identity must still render (the original main system checked results by credential only).
  it.each([
    ["data browsing", "/data/Order"],
    ["visual modeling", "/visual-modeling?focus=object&id=Order&back=playground"],
  ])("%s: the host switches locale while the first getMetas is in flight; data still renders and later requests carry the new locale", async (_name, view) => {
    holdPaths.add("/admin/getMetas");
    const { host, root } = mountHost({ ...base, view });
    await settle();
    Object.assign(host, german);
    await settle();
    holdPaths.clear();
    held.get("/admin/getMetas")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    expect(document.querySelector(".el-message")).toBeNull();
    if (view.startsWith("/data/")) {
      const page = requests.find((request) => request.url.endsWith("/data/getWholeClassDataByPage"));
      expect(page?.body).toMatchObject({ classname: "Order" });
      expect(page?.headers["Accept-Language"]).toBe("de");
      expect(root().textContent).toContain("row-1");
    } else {
      expect(root().querySelector(".visual-modeling .el-tag")?.textContent).toContain("Order-label");
    }
    // Switching locale does not reload: the only metadata batch is the one sent in en before the switch.
    const metaRequests = requests.filter((request) => request.url.endsWith("/admin/getMetas"));
    expect(metaRequests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);

    requests = [];
    host.view = "/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "de")).toBe(true);
  });

  it("switching only the locale during a multi-step save: later steps are sent once and sent requests are not repeated", async () => {
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
    Object.assign(host, german);
    await settle();
    holdPaths.clear();
    held.get("/admin/editClassShowName")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    expect(paths().slice(0, 2)).toEqual(["/admin/editClassShowName", "/admin/editClassDesc"]);
    expect(paths().filter((path) => path === "/admin/editClassShowName")).toHaveLength(1);
    expect(paths().filter((path) => path === "/admin/editClassDesc")).toHaveLength(1);
    expect(requests[0].headers["Accept-Language"]).toBe("en");
    expect(requests[1].headers["Accept-Language"]).toBe("de");
  });

  it("the host switches API entry and credential during delete confirmation: the old confirmation ends with the old workspace and no delete is sent anywhere", async () => {
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

  it("switching the credential during a multi-step delete: the old workspace sends no further steps", async () => {
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
    // The stale follow-up's failure message is not shown and does not land under body.
    expect(document.querySelector(".el-message")).toBeNull();
  });

  it("multi-step delete across credential A→B→A: the unmounted old workspace neither delivers responses nor sends follow-ups", async () => {
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

  it("two instances on one page: theme, popper container, messages and confirmations stay independent", async () => {
    statusFor = (path) => (path === "/data/getWholeClassDataByPage" ? 500 : 200);
    const a = mountHost({ ...base, theme: "dark", view: "/data/Order" });
    const b = mountHost({ ...base, apiBase: "/tenant-b/api", view: "/objects/Order" });
    await settle();

    expect(a.root().classList.contains("is-dark")).toBe(true);
    expect(b.root().classList.contains("is-dark")).toBe(false);
    // A's dropdown popper and error message live inside A's own root; no extra container is created under body.
    expect(a.root().querySelector(".el-select__popper")).not.toBeNull();
    expect(a.root().querySelector(".el-message--error")).not.toBeNull();
    expect(b.root().querySelector(".el-message")).toBeNull();
    expect(document.body.querySelector(":scope > [id*='popper-container']")).toBeNull();

    // After B opens a confirmation, changing A's credential rebuilds only A and B's confirmation stays.
    [...b.root().querySelectorAll("button")]
      .find((item) => item.textContent?.trim() === "Delete")!
      .click();
    await settle();
    expect(b.root().querySelector(".manager-confirm")).not.toBeNull();
    a.host.credential = { type: "token", token: "tok-a2" };
    await settle();
    expect(b.root().querySelector(".manager-confirm")).not.toBeNull();
  });

  it("host presentation values bind to each real root element: switched as a group by theme, with the narrow-dialog switch affecting only its own instance", async () => {
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

  it("graph and modeling take the node palette, edge label fragment and fit limit from the host", async () => {
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

    // No limit and an empty fragment: zoom is untouched and the edge style has neither entry.
    mountedApps.forEach((app) => app.unmount());
    graphRecord.options = [];
    graphRecord.zoomTo = [];
    mountHost(base);
    await settle();
    expect(graphRecord.zoomTo).toEqual([]);
    expect(graphRecord.options[0].edge.style).not.toHaveProperty("labelPlacement");
    expect(graphRecord.options[0].edge.style).not.toHaveProperty("labelAutoRotate");

    // Visual modeling picks the same colour from the same palette for the same class name.
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

  it("the data browser header description comes from the host function with the current object's display name", async () => {
    const { root } = mountHost({ ...base, view: "/data/Order" });
    await settle();
    expect(root().textContent).toContain("description of Order-label");
  });

  it("the description fallback pre-fills the form with the host value, is unchanged by locale/theme switches, and is submitted in the original field after editing", async () => {
    metasFor = () => ({
      success: true,
      data: { classDef: [{ className: "Order", showName: "Order", classDesc: "", attrs: [] }] },
    });
    const { host, root } = mountHost({ ...base, view: "/objects/Order" });
    await settle();
    const textarea = () => root().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea().value).toBe("Host: no description");

    Object.assign(host, german);
    host.theme = "dark";
    await settle();
    Object.assign(host, english);
    await settle();
    expect(textarea().value).toBe("Host: no description");

    textarea().value = "Host: no description (amended)";
    textarea().dispatchEvent(new Event("input"));
    await settle();
    requests = [];
    clickButton("Save Changes");
    await settle();
    expect(requests.find((r) => r.url.endsWith("/admin/editClassDesc"))?.body).toEqual({
      className: "Order",
      desc: "Host: no description (amended)",
    });
  });

  it("an unnamed function takes the host-supplied name, which is still submitted with the scheduled task payload after locale/theme switches", async () => {
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
      (item) => item.textContent?.trim() === "Host: unnamed asset"
    )!;
    option.click();
    await settle();

    Object.assign(host, german);
    host.theme = "dark";
    await settle();
    requests = [];
    clickButton("[de] Save");
    await settle();
    const saved = requests.find((r) => r.url.endsWith("/writeTask/save"))?.body;
    // Wire JSON: undefined fields are absent and name is the host-supplied value.
    expect(saved?.function).toStrictEqual({
      id: "fn-1",
      operation: "OPERATION_WRITE",
      name: "Host: unnamed asset",
      description: null,
    });
  });

  it.each([
    ["object model catalog", "/objects", "New Object Type", ".object-create-dialog", "Create"],
    ["visual modeling", "/visual-modeling", "Add Class", ".el-dialog", "Add"],
  ])("%s creating a class: without a primary key nothing is submitted; after submitting with one, the primary key saved by the backend is shown", async (_name, view, open, selector, submit) => {
    // Only the metadata re-read after creation contains the new class and its primary key: the page must show the backend's saved result, not locally assembled empty attributes.
    metasFor = () => {
      const saved = metas(["Order", "Item"]);
      if (requests.some((request) => request.url.endsWith("/admin/addClass"))) {
        saved.data.classDef.push({
          className: "Pump",
          showName: "Pump-label",
          classDesc: "Pump desc",
          attrs: [
            { name: "pump_no", showName: "pump_no", type: "varchar", enable: true, primaryKey: true },
          ] as never,
        });
      }
      return saved;
    };
    const { root } = mountHost({ ...base, view });
    await settle();
    clickButton(open);
    await settle();
    const dialog = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (item) => item.style.display !== "none" && item.querySelector("input")
    )!;
    const [className, primaryKey, showName] = [...dialog.querySelectorAll("input")];
    const fill = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    fill(className, "Pump");
    fill(showName, "Pump-label");
    fill(dialog.querySelector("textarea")!, "Pump desc");
    await settle();
    const create = () =>
      [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === submit)!.click();

    create();
    await settle();
    expect(paths()).not.toContain("/admin/addClass");

    fill(primaryKey, "pump_no");
    await settle();
    create();
    await settle();
    expect(requests.find((request) => request.url.endsWith("/admin/addClass"))?.body).toMatchObject({
      className: "Pump",
      primaryKeyName: "pump_no",
      showName: "Pump-label",
      classDesc: "Pump desc",
    });
    if (view === "/objects") {
      expect(root().textContent).toContain("Primary key attribute: pump_no");
    } else {
      const panel = root().querySelector(".attr-item")!;
      expect(panel.textContent).toContain("pump_no");
      expect(panel.textContent).toContain("Primary Key");
    }
  });

  it("edit dialogs mount in the popper container inside this instance's root; opening and closing leave body unchanged", async () => {
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

describe("Manager business knowledge page", () => {
  const refundRule = {
    knowledgeID: "k-1",
    knowledgeTitle: "Refund rule",
    knowledgeText: "Refunds within 7 days",
    knowledgeTags: ["policy"],
    status: 1,
  };
  beforeEach(() => {
    knowledge = { [refundRule.knowledgeID]: refundRule };
  });

  const buttonIn = (root: Element, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === text
    )!;

  it("lists knowledge and adds an entry through the dialog inside the instance", async () => {
    const { root } = mountHost({ ...base, view: "/knowledge" });
    await settle();
    expect(paths()).toContain("/admin/getBussinessKnowledge");
    expect(root().textContent).toContain("Refund rule");

    buttonIn(root(), "Add Knowledge").click();
    await settle();
    const dialog = openDialog("Add Knowledge");
    expect(root().contains(dialog)).toBe(true);
    const title = dialog.querySelector("input")!;
    title.value = "Shipping rule";
    title.dispatchEvent(new Event("input"));
    await settle();

    requests = [];
    buttonIn(dialog, "Save").click();
    await settle();
    expect(requests.find((r) => r.url.endsWith("/admin/addBussinessKnowledge"))?.body).toEqual({
      knowledgeID: "",
      knowledgeTitle: "Shipping rule",
      knowledgeText: "",
      knowledgeTags: [],
      status: 1,
    });
    expect(root().querySelector(".el-message--success")).not.toBeNull();
    expect(document.body.querySelector(":scope > .el-message")).toBeNull();
  });

  it("deletes after a confirmation shown in its own instance; messages do not reach another instance or body", async () => {
    const a = mountHost({ ...base, view: "/knowledge" });
    const b = mountHost({ ...base, apiBase: "/tenant-b/api", view: "/objects/Order" });
    await settle();

    buttonIn(a.root(), "Delete").click();
    await settle();
    expect(a.root().querySelector(".manager-confirm")).not.toBeNull();
    expect(b.root().querySelector(".manager-confirm")).toBeNull();

    buttonIn(a.root(), "OK").click();
    await settle();
    const deleted = requests.find((r) => r.url.endsWith("/admin/delBussinessKnowledge"));
    expect(deleted?.url.startsWith("/tenant-a/api/")).toBe(true);
    expect(deleted?.body).toEqual({ knowledgeID: "k-1" });
    expect(a.root().querySelector(".el-message--success")).not.toBeNull();
    expect(b.root().querySelector(".el-message")).toBeNull();
    expect(document.body.querySelector(":scope > .el-message, :scope > .el-overlay")).toBeNull();
  });

  it("switching the credential while a delete confirmation is open cancels it and sends no delete", async () => {
    const { host } = mountHost({ ...base, view: "/knowledge" });
    await settle();
    clickButton("Delete");
    await settle();
    expect(confirmDialog()).not.toBeNull();

    host.credential = { type: "token", token: "tok-b" };
    await settle();
    expect(confirmDialog()).toBeNull();
    expect(paths()).not.toContain("/admin/delBussinessKnowledge");
  });
});

function openDialog(buttonText: string) {
  const dialog = [...document.querySelectorAll(".el-dialog")].find((item) =>
    item.textContent?.includes(buttonText)
  );
  if (!dialog) throw new Error(`Dialog not found: ${buttonText}`);
  return dialog;
}

/** The confirmation currently shown; after closing, EP keeps a hidden overlay, which is removed entirely once the workspace unmounts. */
function confirmDialog() {
  const overlay = document.querySelector(".manager-confirm")?.closest<HTMLElement>(".el-overlay");
  return overlay && overlay.style.display !== "none" ? overlay : null;
}

describe("business knowledge page", () => {
  const knowledgeView = { ...base, view: "/knowledge" };
  const rowTitles = () =>
    [...document.querySelectorAll(".knowledge-table .el-table__body tr")].map(
      (row) => row.querySelectorAll("td")[1]?.textContent?.trim()
    );
  const messageText = () => document.querySelector(".el-message")?.textContent?.trim();

  it("standalone shows the brand header and no governance entry; embedded hides the header and shows the entry only with a governance URL, opening it in the top window", async () => {
    mountHost(knowledgeView);
    await settle();
    expect(document.querySelector(".workspace-header")).not.toBeNull();
    expect(rowTitles()).toEqual(["Refund rule", "Legacy note"]);
    expect(document.querySelector(".knowledge-actions a")).toBeNull();
    mountedApps.splice(0).forEach((app) => app.unmount());

    mountHost({ ...knowledgeView, embedded: true });
    await settle();
    expect(document.querySelector(".workspace-header")).toBeNull();
    expect(document.querySelector(".knowledge-actions a")).toBeNull();
    mountedApps.splice(0).forEach((app) => app.unmount());

    mountHost({
      ...knowledgeView,
      embedded: true,
      knowledgeGovernanceUrl: "http://host.test/admin/knowledge-governance",
    });
    await settle();
    const link = document.querySelector<HTMLAnchorElement>(".knowledge-actions a")!;
    expect(link.textContent?.trim()).toBe("Knowledge Governance");
    expect(link.getAttribute("href")).toBe("http://host.test/admin/knowledge-governance");
    expect(link.getAttribute("target")).toBe("_top");
  });

  it("create and edit dialogs have different titles; editing submits the entry's own tags and creating offers only the three host tag values", async () => {
    mountHost(knowledgeView);
    await settle();
    clickButton("Add Knowledge");
    await settle();
    const addDialog = document.querySelector(".el-dialog")!;
    expect(addDialog.querySelector(".el-dialog__title")?.textContent).toBe("Add Knowledge");
    (addDialog.querySelector(".el-select__wrapper") as HTMLElement).click();
    await settle();
    const options = [...document.querySelectorAll(".el-select-dropdown__item")].map((item) =>
      item.textContent?.trim()
    );
    expect(options).toEqual(["General", "Business", "Tech"]);
    clickButton("Cancel");
    await settle();

    const editButtons = [...document.querySelectorAll(".knowledge-table button")].filter(
      (button) => button.textContent?.trim() === "Edit"
    ) as HTMLElement[];
    editButtons[0]!.click();
    await settle();
    const editDialog = [...document.querySelectorAll(".el-dialog")].find(
      (dialog) => (dialog as HTMLElement).closest<HTMLElement>(".el-overlay")?.style.display !== "none"
    )!;
    expect(editDialog.querySelector(".el-dialog__title")?.textContent).toBe("Edit Knowledge");
    clickButton("Save");
    await settle();
    const saved = requests.find((request) => request.url.endsWith("/admin/editBussinessKnowledge"));
    expect(saved?.body).toEqual({
      knowledgeID: "k1",
      knowledgeTitle: "Refund rule",
      knowledgeText: "t1",
      knowledgeTags: ["Business"],
      status: 1,
    });
  });

  it("closing the delete confirmation sends no delete and reports no error; a partially failed batch delete reports the count and reloads", async () => {
    mountHost(knowledgeView);
    await settle();
    const deleteButtons = () =>
      [...document.querySelectorAll(".knowledge-table button")].filter(
        (button) => button.textContent?.trim() === "Delete"
      ) as HTMLElement[];
    deleteButtons()[0]!.click();
    await settle();
    expect(confirmDialog()).not.toBeNull();
    clickButton("Cancel");
    await settle();
    expect(confirmDialog()).toBeNull();
    expect(paths()).not.toContain("/admin/delBussinessKnowledge");
    expect(document.querySelector(".el-message")).toBeNull();

    knowledgeDeleteFails = new Set(["k2"]);
    document
      .querySelectorAll<HTMLInputElement>(".knowledge-table tbody input")
      .forEach((input) => input.click());
    await settle();
    const loads = paths().filter((path) => path === "/admin/getBussinessKnowledge").length;
    clickButton("Batch Delete");
    await settle();

    clickButton("OK");
    await settle();
    expect(
      requests
        .filter((request) => request.url.endsWith("/admin/delBussinessKnowledge"))
        .map((request) => request.body?.knowledgeID)
    ).toEqual(["k1", "k2"]);
    expect(messageText()).toBe("1 of 2 knowledge entries could not be deleted");
    expect(paths().filter((path) => path === "/admin/getBussinessKnowledge")).toHaveLength(loads + 1);
  });
});
