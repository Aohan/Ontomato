import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import McpManager from "../components/McpManager.vue";
import en from "../../../locales/en";
import { workbenchContent } from "../../../content";
const api = vi.hoisted(() => ({
  listMcpServices: vi.fn(),
  saveMcpService: vi.fn(),
  deleteMcpService: vi.fn(),
  listExternalMcpTools: vi.fn(),
  listPublishedMcpServices: vi.fn(),
}));
vi.mock("../api", () => api);
const mountPage = () =>
  mount(McpManager, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus],
      stubs: {
        ElDialog: {
          props: ["modelValue"],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  });
const button = (wrapper: ReturnType<typeof mountPage>, text: string) =>
  wrapper.findAll("button").find((item) => item.text() === text)!;

beforeEach(() => {
  vi.clearAllMocks();
  api.listMcpServices.mockResolvedValue([]);
  api.saveMcpService.mockResolvedValue(undefined);
  api.listExternalMcpTools.mockResolvedValue([{ name: "submit", description: "Submit an order" }]);
  api.listPublishedMcpServices.mockResolvedValue([
    {
      name: workbenchContent().analysisMcpServerName,
      mcpUrl: "http://localhost/mcp/analysis-agents",
      tools: [],
    },
    {
      name: workbenchContent().opsMcpServerName,
      title: "Ontomato Ops Agent MCP",
      mcpUrl: "http://localhost/mcp/ops-agent",
      tools: [{ name: "send", description: "Send a message" }],
    },
  ]);
});

describe("MCP manager interactions", () => {
  it("keeps the two directions separate and does not save while loading or switching tabs", async () => {
    const page = mountPage();
    await flushPromises();
    expect(page.text()).toContain("No external tool services yet");
    expect(api.listPublishedMcpServices).not.toHaveBeenCalled();
    await page
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "Published services")!
      .trigger("click");
    await flushPromises();
    expect(page.text()).toContain("http://localhost/mcp/analysis-agents");
    expect(api.saveMcpService).not.toHaveBeenCalled();
    page.unmount();
  });

  it("shows localized titles, connection hints and the tool count label on recognized published services", async () => {
    const page = mountPage();
    await flushPromises();
    await page
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "Published services")!
      .trigger("click");
    await flushPromises();
    const [analysisCard, opsCard] = page.findAll(".service-card");
    expect(analysisCard.find("h4").text()).toBe(en.mcp.agentService);
    expect(analysisCard.find("p.muted").text()).toBe(en.mcp.publishedAuthHint);
    expect(analysisCard.find("summary").text()).toBe("Available tools · 0");
    expect(opsCard.find("h4").text()).toBe("Operations agent service");
    expect(opsCard.find("p.muted").text()).toBe(en.mcp.opsPublishedAuthHint);
    expect(opsCard.find("summary").text()).toBe("Available tools · 1");
    expect(page.text()).not.toContain("Ontomato Ops Agent MCP");
    expect(page.text()).not.toContain("availableTools");
    page.unmount();
  });

  it("saves explicit headers and renders tools returned by discovery", async () => {
    const page = mountPage();
    await flushPromises();
    await button(page, "Add Service").trigger("click");
    await page.find('input[aria-label="Service Name"]').setValue("Orders");
    await page.find('input[aria-label="Service Address"]').setValue("http://localhost/mcp");
    await button(page, "Add header").trigger("click");
    await page.find('input[aria-label="Header name"]').setValue("Authorization");
    await page.find('input[aria-label="Header value"]').setValue("Bearer test-secret");
    api.listMcpServices.mockResolvedValue([
      {
        name: "Orders",
        url: "http://localhost/mcp",
        headers: { Authorization: "Bearer test-secret" },
      },
    ]);
    await button(page, "Save").trigger("click");
    await flushPromises();
    expect(api.saveMcpService).toHaveBeenCalledWith(
      {
        name: "Orders",
        url: "http://localhost/mcp",
        headers: { Authorization: "Bearer test-secret" },
      },
      undefined
    );
    expect(page.text()).not.toContain("test-secret");
    await button(page, "View tools").trigger("click");
    await flushPromises();
    expect(page.text()).toContain("Submit an order");
    page.unmount();
  });

  it("distinguishes unavailable configuration from an empty list and supports retry", async () => {
    api.listMcpServices.mockRejectedValueOnce(new Error("unavailable"));
    const page = mountPage();
    await flushPromises();
    expect(page.text()).toContain("Could not load services");
    expect(page.text()).not.toContain("No external tool services yet");
    expect(api.saveMcpService).not.toHaveBeenCalled();
    await button(page, "Retry").trigger("click");
    await flushPromises();
    expect(page.text()).toContain("No external tool services yet");
    page.unmount();
  });
});
