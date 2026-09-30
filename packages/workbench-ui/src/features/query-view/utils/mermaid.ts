import mermaid from "mermaid";

let currentTheme: "default" | "dark" = "default";

const mermaidSvgCache = new Map<string, string>();

function initMermaid(theme: "default" | "dark") {
  currentTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
  });
}

function getCacheKey(src: string, theme: "default" | "dark"): string {
  return `${hashMermaidSrc(src)}_${theme}`;
}

export function hashMermaidSrc(src: string): string {
  let h = 0;
  for (let i = 0; i < src.length; i++) {
    h = (h * 31 + src.charCodeAt(i)) >>> 0;
  }
  return `m${h.toString(16)}`;
}

export function getMermaidSvgFromCache(key: string): string | undefined {
  return key ? mermaidSvgCache.get(key) : undefined;
}

export function setMermaidSvgToCache(key: string, svgHtml: string): void {
  if (!key || !svgHtml) return;
  mermaidSvgCache.set(key, svgHtml);
}

export function normalizeMermaidSrc(src: string): string {
  return src.replace(/%%\{init:[\s\S]*?\}%%/g, "").trim();
}

function looksLikeCompleteMermaid(src: string): boolean {
  const s = (src || "").trim();
  if (!s) return false;
  return (
    /^graph\s+/m.test(s) ||
    /^flowchart\s+/m.test(s) ||
    /^sequenceDiagram/m.test(s) ||
    /^classDiagram/m.test(s) ||
    /^stateDiagram/m.test(s) ||
    /^erDiagram/m.test(s) ||
    /^gantt/m.test(s) ||
    /^journey/m.test(s) ||
    /^pie/m.test(s)
  );
}

function applySvgStyles(el: HTMLElement): void {
  const svg = el.querySelector("svg");
  if (!svg) return;

  svg.removeAttribute("width");
  svg.removeAttribute("height");

  svg.querySelectorAll(".cluster rect").forEach((rect) => {
    rect.setAttribute("rx", "8");
    rect.setAttribute("ry", "8");
  });

  svg.querySelectorAll("rect").forEach((rect) => {
    const hasRx = rect.getAttribute("rx");
    if (!hasRx) {
      rect.setAttribute("rx", "6");
      rect.setAttribute("ry", "6");
    }
  });
}

/**
 * Render SVG under document.body using mermaid.render().
 * The temporary container is not affected by any parent transform / overflow / max-width,
 * ensuring the dagre layout has enough width and text is not truncated.
 */
async function renderMermaidViaRender(src: string, _theme: "default" | "dark"): Promise<string> {
  const id = `mermaid-render-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const { svg } = await mermaid.render(id, src);
    return svg;
  } finally {
    const tempEl = document.getElementById(id);
    if (tempEl) tempEl.remove();
  }
}

export async function renderMermaidIn(
  root: globalThis.ParentNode,
  theme?: "default" | "dark"
): Promise<globalThis.HTMLElement[]> {
  const themeToUse = theme || currentTheme;

  initMermaid(themeToUse);

  const holders = Array.from(root.querySelectorAll(".mermaid")) as globalThis.HTMLElement[];
  if (!holders.length) return [];

  const affected: globalThis.HTMLElement[] = [];

  const nodes = holders.filter((el) => {
    if (!el.isConnected) return false;
    if (el.getAttribute("data-mermaid-rendered") === "1") return false;

    const rawSrc = (el.textContent || "").trim();
    const src = normalizeMermaidSrc(rawSrc);
    if (!looksLikeCompleteMermaid(src)) return false;

    el.textContent = src;

    const key = getCacheKey(src, themeToUse);

    const cached = mermaidSvgCache.get(key);
    if (cached) {
      el.setAttribute("data-mermaid-key", key);
      el.setAttribute("data-mermaid-rendered", "1");
      el.innerHTML = cached;
      el.classList.remove("mermaid");
      el.classList.add("mermaid-svg");
      applySvgStyles(el);

      const svg = el.querySelector("svg");
      if (svg) {
        setMermaidSvgToCache(key, svg.outerHTML);
      }

      affected.push(el);
      return false;
    }

    el.setAttribute("data-mermaid-key", key);
    el.setAttribute("data-mermaid-src", src);
    return true;
  });

  if (!nodes.length) return affected;

  // Render one by one with mermaid.render(); the temporary container is attached under body, unconstrained by parents
  for (const el of nodes) {
    const src = el.getAttribute("data-mermaid-src") || "";
    if (!src) continue;

    const key = el.getAttribute("data-mermaid-key") || "";

    try {
      const svgHtml = await renderMermaidViaRender(src, themeToUse);

      el.innerHTML = svgHtml;
      el.classList.remove("mermaid");
      el.classList.add("mermaid-svg");
      el.setAttribute("data-mermaid-rendered", "1");

      const svg = el.querySelector("svg");
      if (svg) {
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        applySvgStyles(el as HTMLElement);
        setMermaidSvgToCache(key, svg.outerHTML);
      }

      affected.push(el);
    } catch {
      // Keep the original text when rendering fails, for easier debugging
      el.textContent = src;
    }
  }

  return affected;
}
