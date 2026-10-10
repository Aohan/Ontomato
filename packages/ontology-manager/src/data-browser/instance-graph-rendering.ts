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
  }
) {
  let completed = 0;
  for (let offset = 0; offset < nodes.length; offset += GRAPH_BATCH_SIZE) {
    await options.yieldControl();
    if (!options.isCurrent()) return false;
    const batch = nodes.slice(offset, offset + GRAPH_BATCH_SIZE).map((node, index) => ({
      id: node.id,
      data: { node, color: color(node.class) },
      style: instanceNodePosition(offset + index, nodes.length),
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
    }));
    target.addData({ edges: batch });
    await target.draw();
    if (!options.isCurrent()) return false;
    completed += batch.length;
    options.onProgress(completed);
  }
  return options.isCurrent();
}
