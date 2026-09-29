import type { PptSummarySlide, PptSummaryOutline } from "@ontomato/contracts/ppt";
import { renderMarkdown } from "../../../utils/markdown";
import pptxgen from "pptxgenjs";
import type { ReportSection } from "../../../utils/analysis-report";
import { withSkillResourceCredentials } from "../../skills/utils/skill-resource";
import { analysisReportApi } from "../api";
import { workbenchContent } from "../../../content";
import { workbenchI18n } from "../../../i18n";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFileName(value: string): string {
  return (
    (value || "analysis-report")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/./g, (character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .trim()
      .slice(0, 80) || "analysis-report"
  );
}

function splitSlideContent(content: string): string[] {
  const slides = content
    .split(/(?=^#{1,2}\s+)/m)
    .map((part) => part.trim())
    .filter(Boolean);
  return slides.length ? slides : [content.trim()];
}

function stripChartBlocks(text: string): string {
  return text
    .replace(/```html\s*[\s\S]*?\s*```/g, "")
    .replace(/^\s*\[chart:[^\]\r\n]+\]\s*$/gm, "")
    .trim();
}

function sectionHeading(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#{1,3}\s+/.test(line))
      ?.replace(/^#{1,3}\s+/, "")
      .replace(/[*_`]/g, "")
      .trim() || workbenchContent().text.pptSectionFallback
  );
}

async function buildPptOutline(title: string, sections: readonly ReportSection[]) {
  const response = await analysisReportApi.summarizePpt({
    title,
    report: sections.map((section) => stripChartBlocks(section.content)).join("\n\n"),
    sections: sections.map((section) => ({
      id: section.id,
      heading: sectionHeading(section.content),
      text: stripChartBlocks(section.content).slice(0, 30_000),
      hasChart: /```html\s*\n[\s\S]*?\n```/.test(section.content),
    })),
  });
  const outline = response?.data || response;
  if (!outline?.slides?.length)
    throw new Error(workbenchContent().text.pptOutlineFailed);
  return outline as PptSummaryOutline;
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function buildIllustration(visual: PptSummarySlide["visual"], accent: string): string {
  const shapes = {
    insight: `<path d="M28 122h44V78h44v44h44V48h44v74h44" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="94" cy="78" r="10" fill="${accent}"/><circle cx="182" cy="48" r="10" fill="${accent}"/>`,
    risk: `<path d="M128 25 232 210H24L128 25Z" fill="#FFF3E8" stroke="${accent}" stroke-width="10"/><path d="M128 82v58M128 169v3" stroke="${accent}" stroke-width="13" stroke-linecap="round"/>`,
    action: `<path d="M36 184 98 122l34 34 86-102" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="m181 54 37 0-1 37" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
    metric: `<rect x="30" y="42" width="196" height="150" rx="18" fill="#EEF4FF" stroke="${accent}" stroke-width="9"/><path d="M64 151h31v-47h31v47h31V80h31v71" fill="none" stroke="${accent}" stroke-width="11" stroke-linejoin="round"/>`,
  } as const;
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="240" viewBox="0 0 256 240"><rect width="256" height="240" rx="28" fill="#F4F7FC"/>${shapes[visual === "chart" ? "insight" : visual]}</svg>`
  );
}

interface ChartImage {
  data: string;
  width: number;
  height: number;
}

async function chartHtmlToDataUrl(html: string): Promise<ChartImage | null> {
  if (!html || typeof document === "undefined") return null;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1100px;height:620px;border:0;opacity:0;pointer-events:none;";
  iframe.srcdoc = withSkillResourceCredentials(html);
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error("chart iframe failed to load"));
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const document = iframe.contentDocument;
    if (!document) return null;

    // ECharts already renders to canvas. Reading it directly avoids CSS parser
    // incompatibilities in screenshot libraries (for example color()).
    const canvases = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.width * b.height - a.width * a.height
    );
    const chartCanvas = canvases[0];
    if (chartCanvas?.width && chartCanvas.height) {
      return {
        data: chartCanvas.toDataURL("image/png"),
        width: chartCanvas.width,
        height: chartCanvas.height,
      };
    }

    const svg = document.querySelector("svg");
    if (svg) {
      const svgText = new XMLSerializer().serializeToString(svg);
      const box = svg.getBoundingClientRect();
      return {
        data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
      };
    }

    return null;
  } finally {
    iframe.remove();
  }
}

function addSlideChrome(
  slide: pptxgen.Slide,
  shapeType: typeof pptxgen.ShapeType,
  title: string,
  index: number,
  total: number
) {
  slide.background = { color: "F7F9FC" };
  slide.addShape(shapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    line: { color: "2457D6", transparency: 100 },
    fill: { color: "2457D6" },
  });
  slide.addText(title, {
    x: 0.55,
    y: 7.08,
    w: 9.6,
    h: 0.2,
    fontFace: "Microsoft YaHei",
    fontSize: 8,
    color: "667085",
    margin: 0,
  });
  slide.addText(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: 11.7,
    y: 7.08,
    w: 1.05,
    h: 0.2,
    align: "right",
    fontFace: "Arial",
    fontSize: 8,
    color: "667085",
    margin: 0,
  });
}

export async function downloadPptx(
  title: string,
  sections: readonly ReportSection[]
): Promise<void> {
  const outline = await buildPptOutline(title, sections);
  const sectionCharts = new Map<string, string>();
  for (const section of sections) {
    const chart = section.content.match(/```html\s*\n([\s\S]*?)\n```/)?.[1]?.trim();
    if (chart) sectionCharts.set(section.id, chart);
  }
  const deck = new pptxgen();
  deck.layout = "LAYOUT_WIDE";
  deck.author = workbenchContent().serviceDisplayName;
  deck.subject = title;
  deck.title = title;
  deck.company = workbenchContent().serviceDisplayName;
  deck.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };
  deck.defineSlideMaster({
    title: "REPORT",
    background: { color: "F7F9FC" },
    objects: [],
    slideNumber: { x: 12.1, y: 7.08, color: "667085", fontFace: "Arial", fontSize: 8 },
  });

  const totalSlides = outline.slides.length + 1;
  for (let index = 0; index < totalSlides; index += 1) {
    const draft = outline.slides[index - 1];
    const slide = deck.addSlide("REPORT");
    addSlideChrome(slide, deck.ShapeType, outline.title, index, totalSlides);
    if (index === 0) {
      slide.background = { color: "172033" };
      slide.addShape(deck.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        line: { color: "172033", transparency: 100 },
        fill: { color: "172033" },
      });
      slide.addShape(deck.ShapeType.rect, {
        x: 0.65,
        y: 0.82,
        w: 0.16,
        h: 5.65,
        line: { color: "5B8DEF", transparency: 100 },
        fill: { color: "5B8DEF" },
      });
      slide.addText(outline.title, {
        x: 1.2,
        y: 2.15,
        w: 10.6,
        h: 1.0,
        fontFace: "Microsoft YaHei",
        fontSize: outline.title.length > 24 ? 30 : 38,
        bold: true,
        color: "FFFFFF",
        fit: "shrink",
        margin: 0,
      });
      slide.addText(outline.subtitle, {
        x: 1.22,
        y: 3.42,
        w: 8.5,
        h: 0.4,
        fontFace: "Microsoft YaHei",
        fontSize: 17,
        color: "B8C5E0",
        margin: 0,
      });
      continue;
    }

    slide.addText(draft.title, {
      x: 0.6,
      y: 0.55,
      w: 11.4,
      h: 0.62,
      fontFace: "Microsoft YaHei",
      fontSize: draft.title.length > 28 ? 24 : 29,
      bold: true,
      color: "172033",
      breakLine: false,
      fit: "shrink",
      margin: 0,
    });
    slide.addShape(deck.ShapeType.line, {
      x: 0.6,
      y: 1.35,
      w: 1.2,
      h: 0,
      line: { color: "2457D6", width: 2.5 },
    });

    const chartHtml = draft.sourceSectionIds.map((id) => sectionCharts.get(id)).find(Boolean);
    const chartImage = chartHtml ? await chartHtmlToDataUrl(chartHtml) : null;
    const hasChart = Boolean(chartImage);
    const textWidth = hasChart ? 5.7 : 7.9;
    slide.addText(draft.takeaway, {
      x: 0.72,
      y: 1.72,
      w: textWidth,
      h: 1.0,
      fontFace: "Microsoft YaHei",
      fontSize: 22,
      bold: true,
      color: "2457D6",
      breakLine: false,
      fit: "shrink",
      valign: "top",
      margin: 0.02,
    });
    if (draft.bullets.length) {
      slide.addText(
        draft.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: { indent: 16 }, hanging: 4 },
        })),
        {
          x: 0.82,
          y: 3.0,
          w: textWidth,
          h: hasChart ? 3.0 : 3.35,
          fontFace: "Microsoft YaHei",
          fontSize: 16,
          color: "172033",
          breakLine: true,
          fit: "shrink",
          paraSpaceAfter: 12,
          margin: 0.03,
          valign: "top",
        }
      );
    }
    if (chartImage) {
      const maxWidth = 5.65;
      const maxHeight = 4.55;
      const ratio = chartImage.width / chartImage.height;
      const imageWidth = Math.min(maxWidth, maxHeight * ratio);
      const imageHeight = imageWidth / ratio;
      const imageX = 6.92 + (maxWidth - imageWidth) / 2;
      const imageY = 1.85 + (maxHeight - imageHeight) / 2;
      slide.addShape(deck.ShapeType.roundRect, {
        x: 6.75,
        y: 1.7,
        w: 5.95,
        h: 4.85,
        rectRadius: 0.05,
        line: { color: "D9DEE8", width: 0.7 },
        fill: { color: "FFFFFF" },
      });
      slide.addImage({
        data: chartImage.data,
        x: imageX,
        y: imageY,
        w: imageWidth,
        h: imageHeight,
        transparency: 0,
      });
    } else {
      slide.addImage({
        data: buildIllustration(draft.visual, index % 2 ? "2457D6" : "E8793D"),
        x: 9.35,
        y: 4.85,
        w: 2.2,
        h: 2.05,
        transparency: 6,
      });
    }
  }

  const blob = (await deck.write({ outputType: "blob" })) as Blob;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(title)}.pptx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildPptHtml(title: string, sections: readonly ReportSection[]): string {
  const slideContents = sections.flatMap((section) => splitSlideContent(section.content));
  const slides = slideContents
    .map(
      (content, index) => `
      <article class="slide ${index === 0 ? "is-active" : ""}" data-slide="${index}">
        <div class="slide-number">${String(index + 1).padStart(2, "0")}</div>
        <div class="slide-content">${renderMarkdown(content)}</div>
        <div class="slide-footer"><span>${escapeHtml(title)}</span><span>${index + 1} / ${slideContents.length}</span></div>
      </article>`
    )
    .join("\n");

  const serializedTitle = JSON.stringify(title).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${escapeHtml(workbenchI18n().global.locale.value)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#667085; --line:#d9dee8; --blue:#2457d6; --paper:#fff; --canvas:#edf1f7; }
    * { box-sizing:border-box; }
    html,body { margin:0; min-height:100%; background:var(--canvas); color:var(--ink); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
    body { padding:32px; }
    .deck { display:grid; gap:24px; justify-items:center; }
    .slide { display:none; position:relative; width:min(1280px, calc(100vw - 64px)); aspect-ratio:16/9; padding:7.5% 8%; overflow:hidden; background:var(--paper); box-shadow:0 18px 50px rgba(25,39,70,.13); }
    .slide.is-active { display:block; }
    .slide::before { content:""; position:absolute; top:0; left:0; width:28%; height:6px; background:var(--blue); }
    .slide-number { position:absolute; top:7%; right:8%; color:var(--blue); font-size:12px; letter-spacing:.12em; font-weight:700; }
    .slide-content { height:calc(100% - 28px); overflow:hidden; font-size:clamp(14px, 1.35vw, 22px); line-height:1.5; }
    .slide-content h1 { max-width:82%; margin:0 0 24px; font-size:clamp(28px, 4vw, 58px); line-height:1.08; letter-spacing:0; color:var(--ink); }
    .slide-content h2 { margin:0 0 18px; font-size:clamp(24px, 3vw, 42px); line-height:1.12; letter-spacing:0; color:var(--ink); }
    .slide-content h3 { margin:20px 0 10px; font-size:clamp(18px, 2vw, 28px); }
    .slide-content p { margin:10px 0; }
    .slide-content ul,.slide-content ol { margin:12px 0; padding-left:1.3em; }
    .slide-content li { margin:8px 0; }
    .slide-content strong { color:var(--blue); }
    .slide-content blockquote { margin:18px 0; padding:12px 18px; border-left:4px solid var(--blue); color:var(--muted); background:#f5f7fb; }
    .slide-content table { width:100%; border-collapse:collapse; font-size:.72em; }
    .slide-content th,.slide-content td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; }
    .slide-content th { color:var(--blue); background:#f5f7fb; }
    .slide-content pre { padding:12px; overflow:auto; background:#f5f7fb; font-size:.7em; }
    .chart-section,.chart-wrapper { width:100%; }
    .visualization-iframe { display:block; width:100%; height:min(42vh, 400px); border:1px solid var(--line); border-radius:8px; }
    .slide-footer { position:absolute; right:8%; bottom:4.5%; left:8%; display:flex; justify-content:space-between; color:var(--muted); font-size:11px; }
    .controls { position:fixed; right:24px; bottom:20px; z-index:10; display:flex; gap:8px; }
    .controls button { border:1px solid var(--line); border-radius:6px; padding:8px 12px; background:#fff; color:var(--ink); cursor:pointer; }
    .controls button:hover { border-color:var(--blue); color:var(--blue); }
    @media print { body { padding:0; background:#fff; } .slide { display:block; width:100vw; height:56.25vw; box-shadow:none; page-break-after:always; } .controls { display:none; } }
    @media (max-width:700px) { body { padding:12px; } .slide { width:calc(100vw - 24px); padding:9% 8%; } .slide-content { font-size:12px; } .slide-content h1 { font-size:28px; } .slide-content h2 { font-size:23px; } }
  </style>
</head>
<body>
  <main class="deck">${slides}</main>
  <nav class="controls" aria-label="slide controls">
    <button type="button" data-action="previous">Previous</button>
    <button type="button" data-action="next">Next</button>
    <button type="button" data-action="fullscreen">Fullscreen</button>
  </nav>
  <script>
    (() => {
      const slides = [...document.querySelectorAll('.slide')];
      let index = 0;
      const show = (next) => {
        index = (next + slides.length) % slides.length;
        slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
      };
      document.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'previous') show(index - 1);
        if (action === 'next') show(index + 1);
        if (action === 'fullscreen') document.documentElement.requestFullscreen?.();
      });
      document.addEventListener('keydown', (event) => {
        if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) { event.preventDefault(); show(index + 1); }
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); show(index - 1); }
        if (event.key === 'f') document.documentElement.requestFullscreen?.();
      });
      document.title = ${serializedTitle};
    })();
  </script>
</body>
</html>`;
}

export function downloadPptHtml(title: string, sections: readonly ReportSection[]): void {
  const html = buildPptHtml(title, sections);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(title)}.ppt.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
