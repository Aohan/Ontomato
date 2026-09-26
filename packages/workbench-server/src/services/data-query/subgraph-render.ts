import { workbenchProduct } from "../../product/installed";
import { t } from "../../i18n";

type SubgraphPathItem = {
  source: string;
  relation: string;
  target: string;
};

type SubgraphNodeItem = {
  node: string;
  filters: string;
  select: string;
  filter_source?: string;
  select_reason?: string;
};

export type Subgraph = {
  path?: SubgraphPathItem[];
  nodes?: SubgraphNodeItem[];
};

function norm(s: string): string {
  return (s || "").trim();
}

function relationLabel(item: SubgraphPathItem, relationToDesc?: Map<string, string>): string {
  const relation = norm(item.relation);
  return (
    relationToDesc?.get(relation) ||
    relationToDesc?.get(`${norm(item.source)}->${norm(item.target)}`) ||
    relation
  );
}

export function renderSubgraphBlock(
  subgraph?: Subgraph | null,
  _classNameToShowName?: Map<string, string>,
  relationToDesc?: Map<string, string>
): string {
  if (!subgraph) return "";

  const path = Array.isArray(subgraph.path) ? subgraph.path : [];
  const nodes = Array.isArray(subgraph.nodes) ? subgraph.nodes : [];

  if (path.length === 0 && nodes.length === 0) return "";

  const normalized: Subgraph = {
    path: path.map((item) => ({
      source: norm(item.source),
      relation: relationLabel(item, relationToDesc),
      target: norm(item.target),
    })),
    nodes: nodes.map((item) => ({
      ...item,
      node: norm(item.node),
      filters: norm(item.filters),
      select: norm(item.select),
    })),
  };

  const subgraphBlock = [
    `\`\`\`${workbenchProduct().subgraphFence}`,
    JSON.stringify({ subgraph: normalized }, null, 2),
    "```",
  ].join("\n");

  return ["\n\n**" + t("query.subgraph.label") + "**\n", subgraphBlock, "\n"].join("\n");
}
