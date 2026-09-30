import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import type { RunEvent } from "@ontomato/contracts/autotest";
import TestPage from "../TestPage.vue";

const stream = vi.hoisted(() => ({
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null,
  close: vi.fn(),
}));
// Originally mocked getToken of the old auth module; the page now gets the same token through the auth host.
vi.mock("../../../../../utils/auth", () => ({ authHost: () => ({ getToken: () => "test-token" }) }));
vi.mock("../../../api", () => ({
  diagnosisApi: {
    getRunData: async () => ({ runId: "run-1", status: "running" }),
    getRunResultsData: async () => ({ results: [] }),
    openRunEvents: () => stream,
  },
}));
vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({
    t: (key: string, params?: unknown) => `${key} ${JSON.stringify(params) || ""}`,
  }),
}));
vi.mock("../TestRunConfigPanel.vue", () => ({
  default: { props: ["runSummary"], template: "<div>correct={{ runSummary.correct }}</div>" },
}));

it("parses shared run events into visible question logs and verdict totals", async () => {
  const wrapper = mount(TestPage, {
    props: { initialRunId: "run-1" },
    global: { stubs: { "el-button": true } },
  });
  try {
    await flushPromises();
    const events: RunEvent[] = [
      {
        type: "case_start",
        runId: "run-1",
        timestamp: 1,
        data: { caseId: "case-1", question: "shared event question", index: 0 },
      },
      {
        type: "progress",
        runId: "run-1",
        timestamp: 2,
        data: {
          completed: 1,
          total: 1,
          percent: 100,
          summary: { total: 1, correct: 1, wrong: 0, abnormal: 0 },
        },
      },
    ];
    for (const event of events) stream.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
    await flushPromises();
    expect(wrapper.text()).toContain("shared event question");
    expect(wrapper.text()).toContain("correct=1");
  } finally {
    wrapper.unmount();
  }
});
