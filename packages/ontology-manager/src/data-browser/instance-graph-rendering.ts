import type { GraphData } from "@antv/g6";
import type { InstanceGraphEdge, InstanceGraphNode } from "../api";

export const GRAPH_BATCH_SIZE = 200;

export function isLargeInstanceGraph(nodeCount: number, edgeCount: number) {
  return nodeCount > 1000 || edgeCount > 2000;
}

export function instanceNodePosition(index: number, nodeCount: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
  return { x: (index % columns) * 160, y: Math.floor(index / columns) * 120 };
}

export function neighborNodePosition(index: number, center: { x: number; y: number }) {
  const angle = index * 2.399963229728653;
  const radius = 180 + Math.sqrt(index) * 45;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

export function overviewPositions(nodes: InstanceGraphNode[]) {
  const groups = new Map<string, InstanceGraphNode[]>();
  nodes.forEach((node) => groups.set(node.class, [...(groups.get(node.class) || []), node]));
  const classes = [...groups.keys()].sort();
  const columns = Math.max(1, Math.ceil(Math.sqrt(classes.length)));
  const positions: Record<string, { x: number; y: number }> = {};
  classes.forEach((className, groupIndex) => {
    const items = groups.get(className)!;
    items.forEach((node, index) => {
      const angle = index * 2.399963229728653;
      const radius = 28 * Math.sqrt(index);
      positions[node.id] = { x: (groupIndex % columns) * 520 + Math.cos(angle) * radius,
        y: Math.floor(groupIndex / columns) * 520 + Math.sin(angle) * radius };
    });
  });
  return positions;
}

export function instanceEdgeGeometry(edges: InstanceGraphEdge[]) {
  const groups = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = JSON.stringify([edge.source, edge.target].sort());
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  return edges.map((edge, index) => {
    const group = groups.get(JSON.stringify([edge.source, edge.target].sort()))!;
    const position = group.indexOf(index);
    if (edge.source === edge.target) {
      return { type: "cubic", style: { loop: true, loopPlacement: "top" as const, loopDist: 60 + position * 28 } };
    }
    const offset = (position - (group.length - 1) / 2) * 36;
    return { type: group.length > 1 ? "quadratic" : "line", style: { curveOffset: edge.source < edge.target ? offset : -offset } };
  });
}

// Nodes precede edges so every edge endpoint exists before G6 draws it.
export async function drawInstanceGraphBatches(
  target: { addData: (data: GraphData) => void; draw: () => Promise<void> },
  nodes: InstanceGraphNode[],
  edges: InstanceGraphEdge[],
  color: (className: string) => string,
  options: {
    isCurrent: () => boolean;
    yieldControl: () => Promise<void>;
    onProgress: (completed: number) => void;
    positions?: Record<string, { x: number; y: number }>;
  }
) {
  let completed = 0;
  const geometry = instanceEdgeGeometry(edges);
  for (let offset = 0; offset < nodes.length; offset += GRAPH_BATCH_SIZE) {
    await options.yieldControl();
    if (!options.isCurrent()) return false;
    const batch = nodes.slice(offset, offset + GRAPH_BATCH_SIZE).map((node, index) => ({
      id: node.id,
      data: { node, color: color(node.class) },
      style: options.positions?.[node.id] || instanceNodePosition(offset + index, nodes.length),
    }));
    target.addData({ nodes: batch });
    await target.draw();
    if (!options.isCurrent()) return false;
    completed += batch.length;
    options.onProgress(completed);
  }
  for (let offset = 0; offset < edges.length; offset += GRAPH_BATCH_SIZE) {
    await options.yieldControl();
    if (!options.isCurrent()) return false;
    const batch = edges.slice(offset, offset + GRAPH_BATCH_SIZE).map((edge, index) => ({
      id: `edge:${offset + index}:${edge.source}:${edge.target}`,
      source: edge.source,
      target: edge.target,
      data: { type: edge.type, label: edge.label },
      ...geometry[offset + index],
    }));
    target.addData({ edges: batch });
    await target.draw();
    if (!options.isCurrent()) return false;
    completed += batch.length;
    options.onProgress(completed);
  }
  return options.isCurrent();
}
