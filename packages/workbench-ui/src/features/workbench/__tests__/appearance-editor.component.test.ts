import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import WorkbenchAppearanceDialog from "../components/WorkbenchAppearanceDialog.vue";
import en from "../../../locales/en";
import type {
  AppearanceSection,
  WorkbenchAppearance,
} from "@ontomato/contracts/workbench-appearance";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("../api", () => ({
  getWorkbenchAppearance: mocks.get,
  saveWorkbenchAppearance: mocks.save,
}));
const original: WorkbenchAppearance = {
  brand: { name: "Company", subtitle: "Insights", logo: "" },
  qa: { name: "Sales", description: "Sales data", avatarKey: "Wallet", avatarColor: "#EEF7FF" },
  addAgentLabel: "Add expert",
};
async function editor(section: AppearanceSection) {
  const wrapper = mount(WorkbenchAppearanceDialog, {
    props: { section, defaultLogo: "/logo.png" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus],
      stubs: { ElDialog: { template: "<div><slot/><slot name='footer'/></div>" } },
    },
  });
  await flushPromises();
  return wrapper;
}
function button(wrapper: Awaited<ReturnType<typeof editor>>, label: string) {
  return wrapper.findAll("button").find((entry) => entry.text() === label)!;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation(async () => structuredClone(original));
  mocks.save.mockImplementation(async (value) => JSON.parse(JSON.stringify(value)));
});

describe("appearance editor and shared agent fields", () => {
  it("saves shared basic fields without changing the other appearance sections", async () => {
    const wrapper = await editor("qa");
    await wrapper.find("input").setValue("New name");
    await wrapper.find("textarea").setValue("New description");
    await wrapper.find('button[aria-label="Brain"]').trigger("click");
    await button(wrapper, "Save").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("saved")?.[0][0]).toEqual({
      ...original,
      qa: { ...original.qa, name: "New name", description: "New description", avatarKey: "Brain" },
    });
    wrapper.unmount();
  });

  it("keeps defaults as an unsaved draft and never emits a saved result on API failure", async () => {
    const wrapper = await editor("qa");
    await button(wrapper, "Restore defaults").trigger("click");
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValue(new Error("appearance.saveFailed"));
    await button(wrapper, "Save").trigger("click");
    await flushPromises();
    expect(mocks.save).toHaveBeenCalledWith({
      ...original,
      qa: { name: "", description: "", avatarKey: "", avatarColor: "" },
    });
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(wrapper.emitted("close")).toBeUndefined();
    await button(wrapper, "Cancel").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("disables saving on load failure, then retries from the authoritative configuration", async () => {
    mocks.get.mockRejectedValueOnce(new Error("appearance.loadFailed"));
    const wrapper = await editor("brand");
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
    await button(wrapper, "Retry").trigger("click");
    await flushPromises();
    expect(wrapper.find<HTMLInputElement>("input.el-input__inner").element.value).toBe("Company");
    expect(mocks.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
