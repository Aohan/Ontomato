import { describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../../i18n";
import { appTextEn } from "../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../i18n/locales/en";
import { installNoDataVisualization } from "../visualization-no-data";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});
installNoDataVisualization(null);

vi.mock("../../../../charts/chart-generator", () => ({
  generateChartsFromCandidates: vi.fn(),
}));

vi.mock("../../utils/data-resolver", () => ({
  resolveVisualizationData: vi.fn().mockResolvedValue({
    success: true,
    data: [{ count: 1 }],
    source: "mock",
  }),
}));

vi.mock("../../utils/query-artifact-cache", () => ({
  createRuntimeArtifactRef: vi.fn(),
  getQueryArtifactCache: vi.fn().mockReturnValue(null),
  resolveAnalysisData: vi.fn().mockResolvedValue(null),
}));

describe("visualizationNode", () => {
  it("uses diagnostic message as error when chart generation produces no charts", async () => {
    const { visualizationNode } = await import("../visualization-node");
    const { generateChartsFromCandidates } = await import("../../../../charts/chart-generator");
    vi.mocked(generateChartsFromCandidates).mockResolvedValueOnce({
      charts: [],
      diagnostics: [
        {
          scopeId: "scope-1",
          reason: "invalid_plan",
          message: "Field 'service_count' bound to yField does not exist in data (existing fields: service_type, count)",
          severity: "info",
        },
      ],
    });

    const state: any = {
      userQuestion: "Count by type",
      plan: {
        steps: [{ type: "visualization", instruction: "Count by type" }],
      },
    };

    const result = await visualizationNode(state, {
      configurable: { domainId: "domain-1", requestSeq: 1 },
    });

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe(
      "Field 'service_count' bound to yField does not exist in data (existing fields: service_type, count)"
    );
  });
});
