import { describe, expect, it } from "vitest";
import { INSTANCE_NODE_LIMIT, INSTANCE_EDGE_LIMIT, mergeInstanceSubgraph } from "../data-browser/instance-graph-lod";

const node = (id: string) => ({ id, name: id, class: "Item" });
describe("instance graph LOD budgets", () => {
  it("deduplicates overlapping neighbors and drops edges without endpoints", () => {
    expect(mergeInstanceSubgraph({ nodes: [node("1")], edges: [] }, {
      nodes: [node("1"), node("2")],
      edges: [{ source: "1", target: "2" }, { source: "1", target: "2" }, { source: "1", target: "missing" }],
    })).toEqual({ nodes: [node("1"), node("2")], edges: [{ source: "1", target: "2" }] });
  });
  it("rejects a whole page rather than silently discarding neighbors at the budget boundary", () => {
    const nodes = Array.from({ length: INSTANCE_NODE_LIMIT }, (_, index) => node(String(index)));
    expect(mergeInstanceSubgraph({ nodes, edges: [] }, { nodes: [node("extra")], edges: [] })).toBeNull();
    const edges = Array.from({ length: INSTANCE_EDGE_LIMIT + 1 }, (_, index) => ({ source: String(index), target: "end" }));
    expect(mergeInstanceSubgraph({ nodes: [], edges: [] }, { nodes: [], edges })).toBeNull();
  });
});
