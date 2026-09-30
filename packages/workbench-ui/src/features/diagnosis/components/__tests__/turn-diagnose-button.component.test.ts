import { expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import TurnDiagnoseButton from "../TurnDiagnoseButton.vue";
import en from "../../../../locales/en";
import type { ResponseSnapshot } from "../../../../types/chat";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../../access";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    {
      path: "/observe/turns/:turnKey",
      name: "ObserveTurnDetail",
      component: { template: "<div />" },
    },
  ],
});

function snapshot(patch: Partial<ResponseSnapshot>): ResponseSnapshot {
  return { mode: "standard", status: "completed", primaryText: "", ...patch } as ResponseSnapshot;
}

/** Open-source access: /observe has no permission gate, so the entry is always visible. */
const ossAccess: TurnDiagnosisAccess = { prepare: () => {}, visible: () => true };

function render(value: ResponseSnapshot, access: TurnDiagnosisAccess = ossAccess) {
  return mount(TurnDiagnoseButton, {
    props: { turn: value },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), router],
      provide: { [turnDiagnosisAccessKey as symbol]: access },
    },
  });
}

it("opens the finished Turn's diagnosis page in a new tab", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const wrapper = render(snapshot({ threadId: "thread-1", requestSeq: 3 }));

  await wrapper.find("button").trigger("click");

  const [href, target] = open.mock.calls[0];
  expect(href).toContain("/observe/turns/turn.thread-1.3");
  expect(href).toContain("diagnose=1");
  expect(target).toBe("_blank");
  open.mockRestore();
});

it("stays hidden while streaming or without a Turn", () => {
  expect(
    render(snapshot({ turnKey: "turn.t.1", status: "streaming" }))
      .find("button")
      .exists()
  ).toBe(false);
  expect(render(snapshot({})).find("button").exists()).toBe(false);
});

it("calls prepare once on mount and follows the assembled visibility reactively", async () => {
  // Permission-gated access: permissions load on mount and the button appears once they arrive (reactivity comes from the app's permission state).
  const allowed = ref(false);
  const prepare = vi.fn();
  const wrapper = render(snapshot({ threadId: "thread-1", requestSeq: 3 }), {
    prepare,
    visible: () => allowed.value,
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(wrapper.find("button").exists()).toBe(false);

  allowed.value = true;
  await wrapper.vm.$nextTick();
  expect(wrapper.find("button").exists()).toBe(true);
});

it("refuses to render without an assembled access instead of defaulting either way", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() =>
    mount(TurnDiagnoseButton, {
      props: { turn: snapshot({ threadId: "thread-1", requestSeq: 3 }) },
      global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), router] },
    })
  ).toThrow("Turn diagnosis access is not provided");
});
