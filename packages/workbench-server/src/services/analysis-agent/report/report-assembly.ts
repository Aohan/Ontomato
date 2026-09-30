import { DIMENSION_REPORT_TITLE_POLICY } from "../../../config/report-title-policy";
import { tApp } from "../../../i18n";


/** Decides titles while sections are written; each delivery end only reads the result. */
export function dimensionSectionTitle(report: {
  report?: string;
  dimensionName?: string;
  dimensionValue?: string;
}): string | undefined {
  if (
    DIMENSION_REPORT_TITLE_POLICY === "preserve" ||
    String(report.report || "")
      .trimStart()
      .startsWith("## ")
  )
    return undefined;
  return (
    `${report.dimensionName || ""}${report.dimensionValue ? tApp("analysis.dimension.summary.190", { dimensionValue: report.dimensionValue }) : ""}`.trim() ||
    undefined
  );
}
