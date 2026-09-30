import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import GovernancePage from "../GovernancePage.vue";
import en from "../../../locales/en";
import type { GovernanceSession } from "@ontomato/contracts/knowledge-governance";
import { governanceApi } from "../api";

vi.mock("../api", () => ({
  governanceApi: {
    list: vi.fn(),
    read: vi.fn(),
    start: vi.fn(),
    respond: vi.fn(),
    stop: vi.fn(),
    source: vi.fn(),
  },
}));
const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
function session(id = firstId): GovernanceSession {
  return {
    id,
    domainId: "a",
    initiatorId: "initiator",
    createdAt: "2026-09-10T01:00:00Z",
    updatedAt: "2026-09-10T01:00:00Z",
    revision: 1,
    status: "idle",
    messages: [
      { id: "m1", role: "assistant", text: "Which date applies to new postdocs?", timestamp: 1 },
    ],
    draft: "",
    activity: "",
    error: null,
    work: {
      summary: "One date scope needs clarification",
      notes: "",
      reviewedKnowledgeIds: ["k1"],
      knowledgeTotal: 1,
      sources: [
        {
          id: "s1",
          kind: "knowledge",
          target: "k1",
          title: "Date definition",
          excerpt: "Reporting date",
        },
      ],
      issues: [
        {
          id: "i1",
          category: "knowledge",
          status: "pending",
          title: "Postdoc dates",
          problem: "Two dates overlap",
          before: "Campus or reporting date",
          after: "Clarify reporting-date scope",
          basis: "Two original rules",
          sourceIds: ["s1"],
        },
      ],
    },
  };
}
const wrappers: ReturnType<typeof mount>[] = [];
async function open(id = firstId, query = "") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        name: "KnowledgeGovernance",
        path: "/admin/knowledge-governance/:sessionId?",
        component: GovernancePage,
      },
      { path: "/admin/:page(.*)", component: { template: "<p>Admin page</p>" } },
    ],
  });
  await router.push(`/admin/knowledge-governance/${id}${query}`);
  await router.isReady();
  const wrapper = mount(GovernancePage, {
    global: { plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en } })] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((item) => item.text().includes(text))!;
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("governance page contract", () => {
  it("shows a saved question, report and original source and accepts free-text clarification", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(session());
    const next = session();
    next.revision = 2;
    next.work.issues[0]!.status = "confirmed";
    next.messages.push({
      id: "m2",
      role: "assistant",
      text: "The proposal now uses reporting date.",
      timestamp: 2,
    });
    vi.mocked(governanceApi.respond).mockResolvedValue(next);
    vi.mocked(governanceApi.source).mockResolvedValue({
      source: session().work.sources[0]!,
      page: {
        items: [
          {
            id: "k1",
            title: "Date definition",
            text: "Original reporting date rule",
            start: 0,
            end: 28,
            totalChars: 28,
          },
        ],
        totalItems: 1,
        matchedItems: 1,
        next: null,
      },
    });
    const { wrapper } = await open();
    expect(wrapper.text()).toContain("Which date applies to new postdocs?");
    await button(wrapper, "Report").trigger("click");
    expect(wrapper.text()).toContain("Clarify reporting-date scope");
    await button(wrapper, "Date definition").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Original reporting date rule");
    await wrapper.get("textarea").setValue("Reporting date, but only for new postdocs.");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(governanceApi.respond).toHaveBeenCalledWith(
      firstId,
      "Reporting date, but only for new postdocs.",
      expect.any(AbortSignal)
    );
    expect(wrapper.text()).toContain("The proposal now uses reporting date.");
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe("");
  });

  it("ignores a late response from a previous round and navigation never sends Stop", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    let resolveOld!: (value: GovernanceSession) => void;
    const pending = new Promise<GovernanceSession>((resolve) => {
      resolveOld = resolve;
    });
    const next = session(secondId);
    next.messages[0]!.text = "Current round question";
    vi.mocked(governanceApi.read).mockImplementation((id) =>
      id === firstId ? pending : Promise.resolve(next)
    );
    const { wrapper, router } = await open();
    await router.push(`/admin/knowledge-governance/${secondId}`);
    await flushPromises();
    expect(wrapper.text()).toContain("Current round question");
    resolveOld(session());
    await flushPromises();
    expect(wrapper.text()).toContain("Current round question");
    expect(wrapper.text()).not.toContain("Which date applies");
    wrapper.unmount();
    expect(governanceApi.stop).not.toHaveBeenCalled();
  });

  it("Back returns to the from page and switching rounds keeps from; without a valid from it returns to system agents", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([
      { id: secondId, createdAt: "2026-09-10T02:00:00Z", updatedAt: "2026-09-10T02:00:00Z", status: "idle" },
    ]);
    vi.mocked(governanceApi.read).mockImplementation((id) => Promise.resolve(session(id)));
    const from = "/admin/ontology-manager?view=knowledge";
    const { wrapper, router } = await open(firstId, `?from=${encodeURIComponent(from)}`);
    await wrapper.get("summary").trigger("click");
    await wrapper.get(".kg-history a").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.sessionId).toBe(secondId);
    expect(router.currentRoute.value.query.from).toBe(from);
    await wrapper.get(`[aria-label="${en.governance.back}"]`).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(from);

    for (const query of ["", "?from=https://example.com/admin/"]) {
      const direct = await open(firstId, query);
      await direct.wrapper.get(`[aria-label="${en.governance.back}"]`).trigger("click");
      await flushPromises();
      expect(direct.router.currentRoute.value.path).toBe("/admin/system-agents");
    }
  });

  it("explicit Stop is distinct from detaching a running page", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    const working = session();
    working.status = "running";
    vi.mocked(governanceApi.read).mockResolvedValue(working);
    vi.mocked(governanceApi.stop).mockResolvedValue(undefined);
    const { wrapper } = await open();
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.disabled).toBe(true);
    await button(wrapper, "Stop").trigger("click");
    await flushPromises();
    expect(governanceApi.stop).toHaveBeenCalledWith(firstId, expect.any(AbortSignal));
    expect(wrapper.text()).toContain("Stopping…");
  });
});
