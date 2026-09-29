import { createModel } from "../../config/model-factory";
import { renderPrompt } from "../../core/prompts/loader";
import { t } from "../../i18n";
import { buildModelDataView } from "../../utils/model-data-view";
export async function analyzeChartWithLlm(payload: any) {
  const { rows: payloadRows, ...promptPayload } = payload ?? {};
  const rows = Array.isArray(payloadRows)
    ? payloadRows.filter((row: unknown) => row && typeof row === "object" && !Array.isArray(row))
    : [];

  const model = await createModel({ agentName: "Dashboard-ChartAnalyzer" });
  const prompt = renderPrompt("dashboard.chart-analyzer.user", {
    payload: JSON.stringify(promptPayload, null, 2),
    dataEvidence: JSON.stringify(buildModelDataView(rows)),
  });
  const result = await model.invoke(prompt);
  const content = String((result as any)?.content || "").trim();
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    return {
      summary: [t("api.cannotGenerateChartInterpretation")],
      insights: [],
      anomalies: [],
      suggestions: [],
    };
  }
  return JSON.parse(jsonText);
}
