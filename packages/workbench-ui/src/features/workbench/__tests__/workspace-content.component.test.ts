import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WorkbenchWorkspaceContent from "../components/WorkbenchWorkspaceContent.vue";
import en from "../../../locales/en";

const mocks = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock("../../analysis", () => ({
  AnalysisChatView: { name: "AnalysisChatView", template: '<div data-test="analysis-chat" />' },
  AnalysisReportView: {
    name: "AnalysisReportView",
    template: '<div data-test="analysis-report" />',
  },
  useAnalysisStore: () => mocks.store,
}));

function render(currentView: "chat" | "report", hasReportArtifact = true) {
  mocks.store = {
    currentTask: ref(null),
    hasReportArtifact: ref(hasReportArtifact),
    showPendingTaskNotice: ref(false),
    isSelectedLatestRun: ref(true),
  };

  return mount(WorkbenchWorkspaceContent, {
    props: { selectionMode: "analysis", currentView },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })],
      stubs: { WorkbenchInputBar: true },
    },
  });
}

describe("workbench report view mounting", () => {
  beforeEach(() => {
    mocks.store = {};
  });

  it("shows the report tab without mounting the hidden report view", () => {
    const wrapper = render("chat");

    expect(wrapper.findAll(".view-tab")).toHaveLength(2);
    expect(wrapper.find('[data-test="analysis-chat"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="analysis-report"]').exists()).toBe(false);
  });

  it("mounts the report view only while it is selected", async () => {
    const wrapper = render("chat");

    await wrapper.setProps({ currentView: "report" });
    expect(wrapper.find('[data-test="analysis-report"]').exists()).toBe(true);

    await wrapper.setProps({ currentView: "chat" });
    expect(wrapper.find('[data-test="analysis-report"]').exists()).toBe(false);
  });

  it("does not show or mount the report view without a report artifact", () => {
    const wrapper = render("report", false);

    expect(wrapper.findAll(".view-tab")).toHaveLength(1);
    expect(wrapper.find('[data-test="analysis-report"]').exists()).toBe(false);
  });
});
