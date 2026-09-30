import { FieldMappingRequest } from "../types/index";
import { renderPrompt, getPromptTemplate } from "../../../../core/prompts/loader";

function buildTransformSpecGuide() {
  return getPromptTemplate("dashboard.shared.transform-spec-guide.system");
}

function buildChartLibraryGuide() {
  return getPromptTemplate("dashboard.shared.chart-library-guide.system");
}

export function buildAppendPlannerSystemPrompt() {
  return renderPrompt("dashboard.append-planner.system", {
    chartLibraryGuide: buildChartLibraryGuide(),
    transformSpecGuide: buildTransformSpecGuide(),
  });
}

export function buildDashboardPlannerSystemPrompt() {
  return renderPrompt("dashboard.planner.system", {
    chartLibraryGuide: buildChartLibraryGuide(),
    transformSpecGuide: buildTransformSpecGuide(),
  });
}

export function buildChartFieldPlannerSystemPrompt() {
  return getPromptTemplate("dashboard.chart-field-planner.system");
}

export function buildChartFieldPlannerUserPrompt(req: FieldMappingRequest) {
  const fields = Array.isArray(req.allFields) ? req.allFields : [];

  return renderPrompt("dashboard.chart-field-planner.user", {
    chartType: req.chartType,
    contract: JSON.stringify(req.contract),
    subQuestion: String(req.subQuestion || "").trim(),
    dataEvidence: JSON.stringify(req.dataView),
    fields: fields.join(", "),
  });
}
