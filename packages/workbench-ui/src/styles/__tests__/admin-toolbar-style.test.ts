// @vitest-environment node
// Non-component tests in the original repository defaulted to the node environment (reading style sources); this package defaults to happy-dom, so this file keeps the original environment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminStyles = readFileSync(
  new URL("../admin-common.css", import.meta.url),
  "utf8"
);

describe("admin toolbar styles", () => {
  it("uses the same framed layout for legacy and shared toolbar classes", () => {
    expect(adminStyles).toContain(".toolbar,\n.admin-toolbar");
    expect(adminStyles).toContain("height: 54px;");
    expect(adminStyles).toContain("background: var(--el-bg-color) !important;");
    expect(adminStyles).toContain("border-radius: var(--radius-sm) !important;");
  });

  it("keeps toolbar controls usable on narrow screens", () => {
    expect(adminStyles).toContain("@media (max-width: 768px)");
    expect(adminStyles).toContain("height: auto;");
    expect(adminStyles).toContain("width: 100% !important;");
  });
});
