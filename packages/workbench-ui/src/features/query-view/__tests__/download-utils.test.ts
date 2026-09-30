import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCsvFromData, downloadDsl } from "../utils/downloadUtils";

describe("result downloads", () => {
  let blob: Blob;
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      blob = value as Blob;
      return "blob:result";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.stubGlobal("document", {
      createElement: () => ({ click() {}, remove() {} }),
      body: { appendChild() {} },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports all raw rows and preserves CSV delimiters inside cells", async () => {
    downloadCsvFromData(
      [
        { name: "A\rB", value: 'a,"b"' },
        { name: "Second row", extra: 6669 },
      ],
      "Result"
    );
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toBe('name,value,extra\r\n"A\rB","a,""b""",\r\nSecond row,,6669');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 3))).toEqual([
      239, 187, 191,
    ]);
  });

  it("exports the selected dataset DSL without changing its content", async () => {
    const dsl = { problem: "Count people", answer: { steps: [{ output: { distinct: true } }] } };
    downloadDsl(dsl, "Result");
    expect(JSON.parse(await blob.text())).toEqual(dsl);
  });
});
