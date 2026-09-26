import { DIMENSION_REPORT_TITLE_POLICY } from "../../../config/report-title-policy";
import { tApp } from "../../../i18n";


/** 在写入分节时决定标题；各交付出口只读取结果。 */
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
