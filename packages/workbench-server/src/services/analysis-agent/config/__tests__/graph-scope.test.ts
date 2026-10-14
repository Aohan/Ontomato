import { describe, expect, it, vi } from "vitest";
import { backendPost } from "../../../../utils/backend-client";
import {
  intersectAnalysisClassNames,
  normalizeAnalysisGraphScope,
  resolveAnalysisGraphClassNames,
} from "../graph-scope";

vi.mock("../../../../utils/backend-client", () => ({ backendPost: vi.fn() }));

describe("analysis graph scope", () => {
  it("defaults malformed and omitted values to panorama", () => {
    expect(normalizeAnalysisGraphScope(undefined)).toEqual({ mode: "panorama" });
    expect(normalizeAnalysisGraphScope({ mode: "subgraph", rootClassNames: [], maxDepth: 2 })).toEqual({
      mode: "panorama",
    });
  });

  it("resolves connected classes up to the configured depth", async () => {
    vi.mocked(backendPost).mockResolvedValue({
      text: JSON.stringify({
        success: true,
        data: {
          relationship_rule: {
            customer_order: { fromclass: "Customer", toclass: "Order" },
            order_item: { fromclass: "Order", toclass: "Item" },
            item_supplier: { fromclass: "Item", toclass: "Supplier" },
          },
        },
      }),
    } as never);

    await expect(
      resolveAnalysisGraphClassNames(
        { mode: "subgraph", rootClassNames: ["Customer"], maxDepth: 2 },
        "token"
      )
    ).resolves.toEqual(["Customer", "Order", "Item"]);
  });

  it("intersects graph scope with the existing configured class allow-list", () => {
    expect(intersectAnalysisClassNames(["Order", "Supplier"], ["Order", "Item"])).toEqual([
      "Order",
    ]);
    expect(intersectAnalysisClassNames(undefined, ["Order", "Item"])).toEqual(["Order", "Item"]);
    expect(intersectAnalysisClassNames(["Order"], undefined)).toEqual(["Order"]);
  });
});
