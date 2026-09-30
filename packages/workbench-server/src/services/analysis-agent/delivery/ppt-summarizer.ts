import type { PptSummarySlide, PptSummaryOutline } from "@ontomato/contracts/ppt";
import { createModel } from "../../../config/model-factory";
import { tApp } from "../../../i18n";


interface SummaryInput {
  title: string;
  report: string;
  sections: Array<{ id: string; heading: string; text: string; hasChart: boolean }>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeOutline(value: unknown, input: SummaryInput): PptSummaryOutline | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const validIds = new Set(input.sections.map((section) => section.id));
  const slides = Array.isArray(raw.slides)
    ? raw.slides
        .map((slide): PptSummarySlide | null => {
          if (!slide || typeof slide !== "object") return null;
          const item = slide as Record<string, unknown>;
          const sourceSectionIds = Array.isArray(item.sourceSectionIds)
            ? item.sourceSectionIds.filter(
                (id): id is string => typeof id === "string" && validIds.has(id)
              )
            : [];
          const bullets = Array.isArray(item.bullets)
            ? item.bullets.filter(
                (bullet): bullet is string => typeof bullet === "string" && Boolean(bullet.trim())
              )
            : [];
          const title = String(item.title || "").trim();
          const takeaway = String(item.takeaway || "").trim();
          if (!title || (!takeaway && bullets.length === 0)) return null;
          const visual = ["chart", "insight", "risk", "action", "metric"].includes(
            String(item.visual)
          )
            ? (String(item.visual) as PptSummarySlide["visual"])
            : "insight";
          return {
            title,
            takeaway: takeaway || bullets[0],
            bullets: bullets.slice(0, 4),
            sourceSectionIds: sourceSectionIds.slice(0, 2),
            visual,
          };
        })
        .filter((slide): slide is PptSummarySlide => !!slide)
        .slice(0, 10)
    : [];
  if (!slides.length) return null;
  return {
    title: String(raw.title || input.title).trim() || input.title,
    subtitle: String(raw.subtitle || tApp("analysis.delivery.ppt-summarizer.28")).trim(),
    slides,
  };
}

export async function summarizeReportForPpt(input: SummaryInput): Promise<PptSummaryOutline> {
  const model = await createModel({ temperature: 0.25, agentName: "PPT-ReportSummarizer" });
  const response = await model.invoke([
    {
      role: "system",
      content: tApp("analysis.delivery.ppt-summarizer.29"),
    },
    {
      role: "user",
      content: JSON.stringify(input),
    },
  ]);
  const outline = normalizeOutline(extractJson(String(response.content || "")), input);
  if (!outline) throw new Error(tApp("analysis.delivery.ppt-summarizer.30"));
  return outline;
}
