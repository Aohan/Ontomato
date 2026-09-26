import { describe, expect, it } from "vitest";
import { workbenchIdentity } from "../installed";

describe("workbench identity", () => {
  it("fails closed when the application has not installed an identity", () => {
    expect(() => workbenchIdentity()).toThrow(/not installed/);
  });
});
