import type { QcStepEvent, QcResultState } from "@ontomato/contracts/query-thinking";
import { t } from "../../../i18n";
import { workbenchContent } from "../../../content";


export type SubgraphPathItem = { source: string; relation: string; target: string };
export type SubgraphNodeItem = {
  id: string;
  label?: string;
  type?: string;
  node?: string;
  filters?: string;
  select?: string;
  [key: string]: unknown;
};
export type Subgraph = {
  path?: SubgraphPathItem[];
  nodes?: SubgraphNodeItem[];
  [key: string]: unknown;
};
export type QcCheckStep = QcStepEvent & {
  name?: string;
  status?: "pass" | "fail" | "partial";
  message?: string;
  score?: number;
  [key: string]: unknown;
};
export type QcCheckResult = QcResultState & {
  steps?: QcCheckStep[];
  overallStatus?: string;
  summary?: string;
  [key: string]: unknown;
};

let _mermaidIdCounter = 0;

function stableNodeIdFactory() {
  const map = new Map<string, string>();
  return (label: string): string => {
    const key = label.trim();
    const existed = map.get(key);
    if (existed) return existed;
    const id = `N${_mermaidIdCounter++}`;
    map.set(key, id);
    return id;
  };
}

function escMermaidLabel(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
}

function norm(s: string) {
  return (s || "").trim();
}

function displayName(className: string, map?: Map<string, string>): string {
  if (!map) return norm(className);
  const show = map.get(className.trim());
  return show || norm(className);
}

function displayNameWithFallback(className: string, map?: Map<string, string>): string {
  const show = displayName(className, map);
  const raw = norm(className);
  if (show !== raw) return `${show} (${raw})`;
  return show;
}

export function extractMdTitle(md: string): string {
  const match = md.match(/^\s*#\s+(.+)\s*$/m);
  if (match) return match[1].trim();
  const firstLine = md.split("\n").find((l) => l.trim());
  if (firstLine)
    return firstLine
      .trim()
      .replace(/^#+\s*/, "")
      .slice(0, 60);
  return t("thinking.cardDetail");
}

export function stripTitleFromMd(md: string): string {
  return md.replace(/^\s*#\s+.+\n?/m, "").trim();
}

export function extractQuestionFromMd(md: string): string {
  const match = md.match(workbenchContent().hotCardQa.question);
  if (match) return match[1].trim();
  const firstLine = md.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  if (firstLine)
    return firstLine
      .trim()
      .replace(/^[-–—*•]\s*/, "")
      .replace(/^#+\s*/, "")
      .slice(0, 80);
  return "";
}

export function extractAnswerBody(md: string, question?: string): string {
  let result = stripTitleFromMd(md);
  const { questionLine, answerLine } = workbenchContent().hotCardQa;
  result = result.replace(questionLine, "");
  result = result.replace(answerLine, "");
  if (question) {
    const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`^\\s*${escaped}\\s*\\n?`, "m"), "");
  }
  return result.trim();
}

export function tryParseSubgraph(obj: unknown): Subgraph | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const sg = (o.showSubGraph || o.subgraph || o) as Record<string, unknown>;
  const path = Array.isArray(sg.path) ? sg.path : undefined;
  const nodes = Array.isArray(sg.nodes) ? sg.nodes : undefined;
  if (path || nodes)
    return { path: path as SubgraphPathItem[], nodes: nodes as SubgraphNodeItem[] };
  return null;
}

export function generateSubgraphMermaid(
  sg: Subgraph,
  classNameToShowName?: Map<string, string>,
  relationToDesc?: Map<string, string>
): string {
  _mermaidIdCounter = 0;
  const getId = stableNodeIdFactory();
  const path = Array.isArray(sg.path) ? sg.path : [];
  const nodes = Array.isArray(sg.nodes) ? sg.nodes : [];
  if (!path.length && !nodes.length) return "";

  const lines: string[] = ["flowchart LR"];

  if (path.length > 0) {
    const defined = new Set<string>();
    for (const p of path) {
      const sLabel = displayName(p.source, classNameToShowName) || t("thinking.unknown");
      const tLabel = displayName(p.target, classNameToShowName) || t("thinking.unknown");
      const rel = displayName(p.relation, relationToDesc) || t("thinking.relation");
      const sId = getId(sLabel);
      const tId = getId(tLabel);
      if (!defined.has(sId)) {
        lines.push(`  ${sId}["${escMermaidLabel(sLabel)}"]`);
        defined.add(sId);
      }
      if (!defined.has(tId)) {
        lines.push(`  ${tId}["${escMermaidLabel(tLabel)}"]`);
        defined.add(tId);
      }
      lines.push(`  ${sId} -->|"${escMermaidLabel(rel)}"| ${tId}`);
    }
  } else {
    for (const n of nodes) {
      const label = displayName(n.node || "", classNameToShowName) || t("thinking.unknown");
      const id = getId(label);
      lines.push(`  ${id}["${escMermaidLabel(label)}"]`);
    }
  }

  return lines.join("\n");
}

export function generateNodesTable(
  nodes: SubgraphNodeItem[],
  classNameToShowName?: Map<string, string>
): string {
  if (!nodes.length) return "";
  const lines: string[] = [
    `| ${t("thinking.objectClass")} | ${t("thinking.filterCondition")} | ${t("thinking.extractField")} |`,
    "|---|---|---|",
  ];
  for (const n of nodes) {
    const row = [
      displayNameWithFallback(n.node || "", classNameToShowName) || "—",
      norm(n.filters || "") || t("thinking.none"),
      norm(n.select || "") || t("thinking.none"),
    ].map((x) => x.replace(/\|/g, "\\|"));
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function tryParseCheckResult(obj: unknown): QcCheckResult | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  let steps: QcCheckStep[] | undefined;

  if (Array.isArray(o.steps)) steps = o.steps as QcCheckStep[];
  else if (Array.isArray(obj)) steps = obj as QcCheckStep[];

  if (steps?.length) {
    const hasValidStep = steps.some((s) => s && typeof s === "object" && (s.summary || s.label));
    if (!hasValidStep) steps = undefined;
  }

  const score = typeof o.score === "number" ? o.score : undefined;
  const fittedQuestion = typeof o.fittedQuestion === "string" ? o.fittedQuestion : undefined;
  const conclusion = typeof o.conclusion === "string" ? o.conclusion : undefined;

  if (!steps?.length && score === undefined && !fittedQuestion && !conclusion) return null;

  return {
    steps,
    score,
    fittedQuestion,
    conclusion,
  };
}

export function formatCheckScore(s: number): number {
  return Math.round(s);
}

export function computeCardDisplayData(card: {
  md: string;
  originSubQuery?: unknown;
  originCheckResult?: unknown;
}) {
  const title = extractMdTitle(card.md);
  const question = extractQuestionFromMd(card.md);
  const answerBody = extractAnswerBody(card.md, question);
  const subgraph = card.originSubQuery !== undefined ? tryParseSubgraph(card.originSubQuery) : null;
  const checkResult =
    card.originCheckResult !== undefined ? tryParseCheckResult(card.originCheckResult) : null;
  const rawSubQuery =
    card.originSubQuery !== undefined && !subgraph ? card.originSubQuery : undefined;
  const rawCheckResult =
    card.originCheckResult !== undefined && !checkResult ? card.originCheckResult : undefined;

  return { title, question, answerBody, subgraph, checkResult, rawSubQuery, rawCheckResult };
}
