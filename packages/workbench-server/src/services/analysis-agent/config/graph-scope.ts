import type { AnalysisGraphScope } from "@ontomato/contracts/analysis-agent";
import { buildUrl, getApiConfig } from "../../../config/data-query-api";
import { backendPost } from "../../../utils/backend-client";

export const DEFAULT_ANALYSIS_GRAPH_SCOPE: AnalysisGraphScope = { mode: "panorama" };

export function normalizeAnalysisGraphScope(value: unknown): AnalysisGraphScope {
  if (!value || typeof value !== "object") return DEFAULT_ANALYSIS_GRAPH_SCOPE;
  const input = value as Record<string, unknown>;
  if (input.mode !== "subgraph") return DEFAULT_ANALYSIS_GRAPH_SCOPE;
  const roots = Array.isArray(input.rootClassNames)
    ? Array.from(new Set(input.rootClassNames.map(String).map((item) => item.trim()).filter(Boolean)))
    : [];
  const depth = Number(input.maxDepth);
  if (!roots.length || !Number.isInteger(depth) || depth < 0 || depth > 10) {
    return DEFAULT_ANALYSIS_GRAPH_SCOPE;
  }
  return { mode: "subgraph", rootClassNames: roots, maxDepth: depth };
}

type OntologyRelation = { fromclass?: unknown; toclass?: unknown };

/** Resolves a configured ontology start into the class allow-list understood by query APIs. */
export async function resolveAnalysisGraphClassNames(
  scope: AnalysisGraphScope | undefined,
  token?: string,
  userId?: string,
  locale?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<string[] | undefined> {
  const normalized = normalizeAnalysisGraphScope(scope);
  if (normalized.mode === "panorama") return undefined;

  const config = getApiConfig();
  const response = await backendPost(
    "analysisGraphScope:getMetas",
    buildUrl(config, "/admin/getMetas"),
    {},
    { token, userId, locale, apiKey, signal }
  );
  const json = JSON.parse(response.text) as any;
  const payload = json?.data ?? json ?? {};
  const relations = payload.relationship_rule || {};
  const adjacency = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!from || !to) return;
    const neighbors = adjacency.get(from) || new Set<string>();
    neighbors.add(to);
    adjacency.set(from, neighbors);
  };
  for (const relation of Object.values(relations) as OntologyRelation[]) {
    add(String(relation.fromclass || "").trim(), String(relation.toclass || "").trim());
    add(String(relation.toclass || "").trim(), String(relation.fromclass || "").trim());
  }

  const result = new Set(normalized.rootClassNames);
  let frontier = new Set(normalized.rootClassNames);
  for (let depth = 0; depth < normalized.maxDepth; depth++) {
    const next = new Set<string>();
    for (const className of frontier) {
      for (const neighbor of adjacency.get(className) || []) {
        if (!result.has(neighbor)) {
          result.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return Array.from(result);
}

export function intersectAnalysisClassNames(
  configuredClassNames: readonly string[] | undefined,
  graphClassNames: readonly string[] | undefined
): string[] | undefined {
  const configured = Array.from(new Set((configuredClassNames || []).map((name) => name.trim()).filter(Boolean)));
  if (!graphClassNames) return configured.length ? configured : undefined;
  const scope = new Set(graphClassNames);
  return configured.length ? configured.filter((name) => scope.has(name)) : [...scope];
}
