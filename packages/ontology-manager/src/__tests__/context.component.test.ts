import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App, type Component } from "vue";
import type { ManagerAuthFailureStatus, ManagerClient } from "../api";
import {
  provideManagerContext,
  useManagerClient,
  useManagerContext,
  type ManagerHostContext,
} from "../context";
import { englishMessages } from "../i18n";

let requests: { url: string; headers: Record<string, string> }[];
let status: number;
let mountedApps: App[];

beforeEach(() => {
  requests = [];
  status = 200;
  mountedApps = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ success: true, data: [] }), { status });
  });
});

afterEach(() => {
  mountedApps.forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

/** Four workspaces each inject the client, standing for the ontology, asset, data browsing and modeling request entry points. */
const workspaces = {
  ontology: (client: ManagerClient) => client.loadOntology(),
  assets: (client: ManagerClient) => client.loadSmartAssets("actions"),
  dataBrowser: (client: ManagerClient) => client.loadObjectData("Order", 1, 25),
  visualModeling: (client: ManagerClient) => client.getBusinessConfig(),
};
type Workspace = keyof typeof workspaces;

function mountManager(initial: ManagerHostContext) {
  const context = reactive({ ...initial });
  const failures: ManagerAuthFailureStatus[] = [];
  const clients = {} as Record<Workspace, ManagerClient>;
  let observed: Readonly<ManagerHostContext> | undefined;

  const children = (Object.keys(workspaces) as Workspace[]).map((name) =>
    defineComponent({
      setup() {
        clients[name] = useManagerClient();
        observed = useManagerContext();
        return () => h("div");
      },
    })
  );
  const Root: Component = defineComponent({
    setup() {
      provideManagerContext(context, (s) => failures.push(s));
      return () => children.map((child) => h(child));
    },
  });
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp(Root);
  app.mount(el);
  mountedApps.push(app);

  const run = (name: Workspace) => workspaces[name](clients[name]);
  const runAll = () =>
    Promise.all((Object.keys(workspaces) as Workspace[]).map((name) => run(name)));
  return { context, failures, clients, observed: () => observed!, run, runAll };
}

const base: ManagerHostContext = {
  apiBase: "/manager-api",
  credential: { type: "token", token: "t-1" },
  locale: "en",
  messages: englishMessages,
  theme: "light",
  view: "/playground",
  dataFallbacks: { noBusinessDescription: "Host: no description", unnamedAsset: "Host: unnamed asset" },
  // This file only checks context injection and requests; presentation values are unused but supplied in full as the contract requires.
  presentation: {
    themeProperties: { light: {}, dark: {} },
    nodePalette: ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"],
    edgeLabel: {},
    maxFitZoom: null,
    dataBrowserDescription: () => "",
    compactDialogs: false,
  },
  knowledgeTagValues: { general: "General", business: "Business", tech: "Tech" },
  embedded: false,
  knowledgeGovernanceUrl: null,
};

describe("host context injection", () => {
  it("ontology, assets, data browsing and modeling share one per-instance context that follows the host", async () => {
    const manager = mountManager(base);
    const { ontology, assets, dataBrowser, visualModeling } = manager.clients;
    expect(new Set([ontology, assets, dataBrowser, visualModeling]).size).toBe(1);

    await manager.runAll();
    manager.context.credential = { type: "apiKey", apiKey: "k-2" };
    await manager.runAll();

    const paths = [
      "/admin/getMetas",
      "/action/queryList",
      "/data/getWholeClassDataByPage",
      "/businessConfig/getConfig",
    ].map((path) => `/manager-api/data-query${path}`);
    expect(requests.map((r) => r.url)).toEqual([...paths, ...paths]);
    expect(requests.slice(0, 4).every((r) => r.headers.tk === "t-1")).toBe(true);
    expect(requests.slice(4).every((r) => r.headers["x-api-key"] === "k-2" && !r.headers.tk)).toBe(
      true
    );
  });

  it("two instances do not share context", async () => {
    const first = mountManager(base);
    const second = mountManager({
      ...base,
      apiBase: "/other-api",
      credential: { type: "anonymous" },
    });

    await first.run("dataBrowser");
    await second.run("dataBrowser");

    expect(requests[0].url.startsWith("/manager-api/")).toBe(true);
    expect(requests[0].headers.tk).toBe("t-1");
    expect(requests[1].url.startsWith("/other-api/")).toBe(true);
    expect(requests[1].headers).not.toHaveProperty("tk");
    expect(requests[1].headers).not.toHaveProperty("x-api-key");
  });

  it("theme, locale and view come from the host and stay reactive", async () => {
    const manager = mountManager(base);
    manager.context.theme = "dark";
    manager.context.view = "/visual-modeling?focus=object&id=Order";
    await nextTick();

    expect(manager.observed()).toMatchObject({
      theme: "dark",
      view: "/visual-modeling?focus=object&id=Order",
    });
  });

  it("does not read old credentials from host storage", async () => {
    localStorage.setItem("data_agent_token", "host-token");
    localStorage.setItem("data_agent_apikey", "host-key");
    sessionStorage.setItem("ontology_manager_token", "shell-token");
    sessionStorage.setItem("ontology_manager_api_key", "shell-key");
    const anonymous = mountManager({ ...base, credential: { type: "anonymous" } });
    const missing = mountManager({ ...base, credential: null });

    await anonymous.run("visualModeling");
    await expect(missing.run("ontology")).rejects.toThrow();

    expect(requests).toHaveLength(1);
    expect(requests[0].headers).not.toHaveProperty("tk");
    expect(requests[0].headers).not.toHaveProperty("x-api-key");
  });

  it("401/402 go to the host without navigating or clearing any storage", async () => {
    localStorage.setItem("data_agent_token", "host-token");
    window.location.hash = "#/objects/Order";
    const manager = mountManager(base);

    status = 401;
    await expect(manager.run("assets")).rejects.toThrow();
    status = 402;
    await expect(manager.run("visualModeling")).rejects.toThrow();

    expect(manager.failures).toEqual([401, 402]);
    expect(window.location.hash).toBe("#/objects/Order");
    expect(localStorage.getItem("data_agent_token")).toBe("host-token");
    expect(manager.context.credential).toEqual({ type: "token", token: "t-1" });
  });

  it("reports a clear error when used outside the host root component", () => {
    const Orphan = defineComponent({
      setup() {
        useManagerClient();
        return () => h("div");
      },
    });
    const app = createApp(Orphan);
    app.config.warnHandler = () => {};
    expect(() => app.mount(document.createElement("div"))).toThrow("provideManagerContext");
  });
});
