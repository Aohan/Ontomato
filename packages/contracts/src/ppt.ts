export interface PptSummarySlide {
  title: string;
  takeaway: string;
  bullets: string[];
  sourceSectionIds: string[];
  visual: "chart" | "insight" | "risk" | "action" | "metric";
}

export interface PptSummaryOutline {
  title: string;
  subtitle: string;
  slides: PptSummarySlide[];
}
