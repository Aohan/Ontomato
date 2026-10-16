import type { GraphData } from "@antv/g6";
import type { InstanceGraphEdge, InstanceGraphNode } from "../api";

export const GRAPH_BATCH_SIZE = 200;

export function isLargeInstanceGraph(nodeCount: number, edgeCount: number) {
  return nodeCount > 1000 || edgeCount > 2000;
}

export function instanceGraphNodeLabel(name: string | undefined, id: string) {
  const label = name?.trim() || id;
  const characters = Array.from(label);
  return characters.length > 24 ? `${characters.slice(0, 23).join("")}…` : label;
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
  const clusterRadius = (className: string) => 28 * Math.sqrt(Math.max(0, groups.get(className)!.length - 1));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: Math.ceil(classes.length / columns) }, () => 0);
  classes.forEach((className, index) => {
    const diameter = clusterRadius(className) * 2;
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], diameter);
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], diameter);
  });
  const centers = (sizes: number[]) => sizes.reduce<number[]>((result, size, index) => {
    result.push(index === 0 ? 0 : result[index - 1] + Math.max(520, (sizes[index - 1] + size) / 2 + 120));
    return result;
  }, []);
  const xCenters = centers(columnWidths);
  const yCenters = centers(rowHeights);
  const positions: Record<string, { x: number; y: number }> = {};
  classes.forEach((className, groupIndex) => {
    const items = groups.get(className)!;
    items.forEach((node, index) => {
      const angle = index * 2.399963229728653;
      const radius = 28 * Math.sqrt(index);
      positions[node.id] = { x: xCenters[groupIndex % columns] + Math.cos(angle) * radius,
        y: yCenters[Math.floor(groupIndex / columns)] + Math.sin(angle) * radius };
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

/** Aggregate only loaded sample edges; counts never imply datasource totals. */
export function overviewRelations(
  nodes: InstanceGraphNode[], edges: InstanceGraphEdge[],
  positions: Record<string, { x: number; y: number }>, selectedId = "",
) {
  const classes = new Map(nodes.map((node) => [node.id, node.class]));
  const groups = new Map<string, { source: string; target: string; type?: string; count: number }>();
  const anchorId = (name: string) => `overview-class:${JSON.stringify(name)}`;
  for (const edge of edges) {
    const source = classes.get(edge.source), target = classes.get(edge.target);
    if (source == null || target == null) continue;
    const key = JSON.stringify([source, target, edge.type ?? ""]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { source: anchorId(source), target: anchorId(target), type: edge.type, count: 1 });
  }
  const anchors = [...new Set(classes.values())].map((name) => {
    const points = nodes.filter((node) => node.class === name).map((node) => positions[node.id]).filter(Boolean);
    const x = points.length ? (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2 : 0;
    const y = points.length ? (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2 : 0;
    return { id: anchorId(name), data: { anchor: true }, style: { x, y, size: 0, labelText: "", lineWidth: 0, shadowBlur: 0, opacity: 0 } };
  });
  const aggregated = [...groups.values()];
  const geometry = instanceEdgeGeometry(aggregated);
  const radii = new Map(anchors.map((anchor) => [anchor.id, Math.max(0, ...nodes
    .filter((node) => anchorId(node.class) === anchor.id)
    .map((node) => positions[node.id] ? Math.hypot(positions[node.id].x - anchor.style.x, positions[node.id].y - anchor.style.y) : 0))]));
  const drawnEdges = aggregated.map((edge, index) => ({
    id: `overview-relation:${index}`, source: edge.source, target: edge.target,
    data: { type: edge.type, count: edge.count, aggregated: true }, ...geometry[index],
    style: { ...geometry[index].style,
      ...(edge.source === edge.target ? { loopDist: (radii.get(edge.source) || 0) + (geometry[index].style.loopDist || 60) } : {}),
      lineWidth: Math.min(7, 1.5 + Math.log2(edge.count + 1)), opacity: selectedId ? 0.15 : 0.8 },
  }));
  const direct = edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
  const directGeometry = instanceEdgeGeometry(direct);
  return { nodes: anchors, edges: [...drawnEdges, ...direct.map((edge, index) => ({
    id: `overview-direct:${index}`, source: edge.source, target: edge.target,
    data: { type: edge.type }, ...directGeometry[index],
  }))] };
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
