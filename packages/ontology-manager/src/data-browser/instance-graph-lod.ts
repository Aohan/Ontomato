import type { InstanceGraphData, InstanceGraphNode } from "../api";

export const INSTANCE_NODE_LIMIT = 300;
export const INSTANCE_EDGE_LIMIT = 600;
export const INSTANCE_MAX_DEPTH = 2;

export function mergeInstanceSubgraph(current: InstanceGraphData, page: InstanceGraphData) {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  page.nodes.forEach((node) => nodes.set(node.id, node));
  const edges = new Map(current.edges.map((edge) => [JSON.stringify([edge.source, edge.target]), edge]));
  page.edges.forEach((edge) => edges.set(JSON.stringify([edge.source, edge.target]), edge));
  if (nodes.size > INSTANCE_NODE_LIMIT || edges.size > INSTANCE_EDGE_LIMIT) return null;
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
  };
}

export function localNodePosition(node: InstanceGraphNode, index: number, count: number, centerId: string) {
  if (node.id === centerId) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = Math.max(160, Math.sqrt(index + 1) * 85);
  if (!centerId) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    return { x: (index % columns) * 160, y: Math.floor(index / columns) * 120 };
  }
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
