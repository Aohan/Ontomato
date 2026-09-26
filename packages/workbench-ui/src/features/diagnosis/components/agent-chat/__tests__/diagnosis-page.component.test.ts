import type { DiagnosisStreamEvent } from "@ontomato/contracts/diagnosis";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { workbenchI18n } from "../../../../../i18n";
import DiagnosisPage from "../DiagnosisPage.vue";

// 原全局 i18n 实例改为共享用例 setup 已装配的实例。
const i18n = workbenchI18n();

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../../../../utils/api", () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  nodeApiGet: api.get,
  nodeApiPost: api.post,
  nodeApiDelete: api.remove,
  nodeApiFetch: api.fetch,
}));

const history = vi.hoisted(() => new Map<string, unknown[]>());

function streamResponse(events: DiagnosisStreamEvent[]): Response {
  const body = events.map((event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`);
  return new Response(body.join(""), { headers: { "content-type": "text/event-stream" } });
}

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/observe/diagnosis", component: DiagnosisPage }],
  });
  await router.push(path);
  const wrapper = mount(DiagnosisPage, { global: { plugins: [i18n, ElementPlus, router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  history.clear();
  api.get.mockImplementation(async (path: string) => {
    const sessionId = path.match(/\/sessions\/([^/]+)\/history$/)?.[1];
    return {
      success: true,
      data: { messages: history.get(sessionId!) ?? [], responseStatus: "idle" },
    };
  });
  api.post.mockImplementation(async (_path: string, body: { title: string }) => ({
    success: true,
    data: {
      id: "s-new",
      title: body.title,
      createdAt: "2026-09-22T00:00:00.000Z",
      responseStatus: "idle",
    },
  }));
  api.fetch.mockImplementation(
    async (_path: string, _method: string, body: { message: string }) => {
      history.set("s-new", [
        { role: "user", content: body.message },
        { role: "assistant", content: "诊断结论：缓存失效" },
      ]);
      return streamResponse([
        { type: "response_started", message: body.message },
        { type: "token", content: "诊断结论：缓存失效" },
        { type: "response_end", status: "completed" },
      ]);
    }
  );
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("sends a diagnosis message without any model picker or per-session model binding", async () => {
  const wrapper = await mountAt("/observe/diagnosis");
  wrappers.push(wrapper);
  expect(wrapper.findComponent({ name: "ElSelect" }).exists()).toBe(false);
  expect(wrapper.findComponent({ name: "ElDropdown" }).exists()).toBe(false);

  await wrapper.find("textarea").setValue("接口变慢");
  await wrapper.find(".chat-input-action").trigger("click");
  await flushPromises();

  expect(api.post).toHaveBeenCalledWith("/observe/agent/sessions", {
    title: "接口变慢",
    context: { page: "general" },
  });
  expect(api.fetch).toHaveBeenCalledWith(
    "/observe/agent/chat",
    "POST",
    { sessionId: "s-new", message: "接口变慢" },
    expect.anything()
  );
  expect(api.get.mock.calls.map(([path]) => path)).toEqual([
    "/observe/agent/sessions/s-new/history",
  ]);
  expect(wrapper.text()).toContain("诊断结论：缓存失效");
});

it("restores a session's history from the route without model state", async () => {
  history.set("s-old", [
    { role: "user", content: "昨天的告警" },
    { role: "assistant", content: "已定位到慢查询" },
  ]);
  const wrapper = await mountAt("/observe/diagnosis?sessionId=s-old");
  wrappers.push(wrapper);

  expect(api.get.mock.calls.map(([path]) => path)).toEqual([
    "/observe/agent/sessions/s-old/history",
  ]);
  expect(wrapper.text()).toContain("昨天的告警");
  expect(wrapper.text()).toContain("已定位到慢查询");
  expect(wrapper.findComponent({ name: "ElSelect" }).exists()).toBe(false);
});
