import { describe, expect, it, vi } from "vitest";
import type { GraphData } from "@antv/g6";
import {
  drawInstanceGraphBatches,
  GRAPH_BATCH_SIZE,
  instanceNodePosition,
  isLargeInstanceGraph,
  instanceEdgeGeometry,
  neighborNodePosition,
  overviewPositions,
} from "../data-browser/instance-graph-rendering";

const nodes = Array.from({ length: 451 }, (_, index) => ({
  id: `node:${index}`, name: `Node ${index}`, class: "Item",
}));
const edges = nodes.slice(1).map((node) => ({ source: nodes[0].id, target: node.id }));

describe("instance graph incremental drawing", () => {
  it("keeps sampled types in separate compact clusters", () => {
    const sample = Array.from({ length: 100 }, (_, index) => ({ id: String(index), class: index < 50 ? "A" : "B", name: String(index) }));
    const positions = overviewPositions(sample);
    expect(Object.keys(positions)).toHaveLength(100);
    expect(positions["0"]).toEqual({ x: 0, y: 0 });
    expect(positions["50"]).toEqual({ x: 520, y: 0 });
    expect(Math.hypot(positions["49"].x, positions["49"].y)).toBeLessThan(200);
  });
  it("separates parallel relationships and draws self relationships as loops", () => {
    const geometry = instanceEdgeGeometry([
      { source: "A", target: "B", type: "owns" },
      { source: "A", target: "B", type: "reviews" },
      { source: "A", target: "A", type: "parent" },
    ]);
    expect(geometry[0].type).toBe("quadratic");
    expect(geometry[0].style.curveOffset).not.toBe(geometry[1].style.curveOffset);
    expect(geometry[2].style.loop).toBe(true);
  });

  it("places later neighborhood pages beyond earlier positions", () => {
    const center = { x: 15, y: 20 };
    const first = neighborNodePosition(0, center);
    const later = neighborNodePosition(100, center);
    expect(Math.hypot(later.x - center.x, later.y - center.y)).toBeGreaterThan(Math.hypot(first.x - center.x, first.y - center.y));
  });
  it("draws bounded batches, yields between draws and adds edges only after their endpoints", async () => {
    const batches: GraphData[] = [];
    const knownIds = new Set<string>();
    let yielded = false;
    const target = {
      addData(data: GraphData) {
        expect(yielded).toBe(true);
        expect((data.nodes?.length || 0) + (data.edges?.length || 0)).toBeLessThanOrEqual(GRAPH_BATCH_SIZE);
        data.nodes?.forEach((node) => knownIds.add(node.id));
        data.edges?.forEach((edge) => {
          expect(knownIds.has(edge.source)).toBe(true);
          expect(knownIds.has(edge.target)).toBe(true);
        });
        batches.push(data);
        yielded = false;
      },
      draw: vi.fn(async () => {}),
    };
    const progress: number[] = [];
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => true,
      yieldControl: async () => { yielded = true; },
      onProgress: (completed) => progress.push(completed),
    })).toBe(true);
    expect(batches.map((batch) => batch.nodes?.length || batch.edges?.length)).toEqual([200, 200, 51, 200, 200, 50]);
    expect(batches.flatMap((batch) => batch.nodes || []).map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(batches.flatMap((batch) => batch.edges || [])).toHaveLength(edges.length);
    expect(target.draw).toHaveBeenCalledTimes(6);
    expect(progress).toEqual([200, 400, 451, 651, 851, 901]);
  });

  it("does not touch a replaced or unmounted graph after yielding", async () => {
    const target = { addData: vi.fn(), draw: vi.fn(async () => {}) };
    let current = true;
    const progress = vi.fn();
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => current,
      yieldControl: async () => { current = false; },
      onProgress: progress,
    })).toBe(false);
    expect(target.addData).not.toHaveBeenCalled();
    expect(target.draw).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("stops after an in-flight draw without publishing stale progress or starting another batch", async () => {
    let current = true;
    const target = {
      addData: vi.fn(),
      draw: vi.fn(async () => { current = false; }),
    };
    const progress = vi.fn();
    expect(await drawInstanceGraphBatches(target, nodes, edges, () => "red", {
      isCurrent: () => current,
      yieldControl: async () => {},
      onProgress: progress,
    })).toBe(false);
    expect(target.addData).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });

  it("uses large-graph limits and stable spaced positions without a force simulation", () => {
    expect(isLargeInstanceGraph(1000, 2000)).toBe(false);
    expect(isLargeInstanceGraph(1001, 0)).toBe(true);
    expect(isLargeInstanceGraph(2, 2001)).toBe(true);
    expect(instanceNodePosition(0, 10000)).toEqual({ x: 0, y: 0 });
    expect(instanceNodePosition(100, 10000)).toEqual({ x: 0, y: 120 });
    expect(new Set(nodes.map((_, index) => JSON.stringify(instanceNodePosition(index, nodes.length)))).size).toBe(nodes.length);
  });
});
