import { describe, expect, it } from "vitest";
import { englishMessages, ontologyText, sharedText } from "../i18n";

describe("message lookup", () => {
  it("reads the host-supplied table and interpolates parameters", () => {
    expect(ontologyText(englishMessages, "assetSaved", { title: "Metric view" })).toBe("Metric view saved");
    expect(sharedText(englishMessages, "dataBrowser.filterCount", { n: 2 })).toBe("Filter (2)");
  });
});
