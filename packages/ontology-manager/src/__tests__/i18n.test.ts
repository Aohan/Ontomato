import { describe, expect, it } from "vitest";
import { englishMessages, ontologyText, sharedText, type ManagerMessages } from "../i18n";

describe("message lookup", () => {
  it("reads the host-supplied table and interpolates parameters", () => {
    expect(ontologyText(englishMessages, "assetSaved", { title: "Metric view" })).toBe("Metric view saved");
    expect(sharedText(englishMessages, "dataBrowser.filterCount", { n: 2 })).toBe("Filter (2)");
  });

  it("falls back to English when an older host omits newly added messages", () => {
    const ontology: Partial<{ -readonly [Key in keyof ManagerMessages["ontology"]]: string }> = {
      ...englishMessages.ontology,
    };
    delete ontology.instanceGraphRenderProgress;
    delete ontology.searchInstanceNodes;
    const messages = { ...englishMessages, ontology } as ManagerMessages;
    expect(ontologyText(messages, "instanceGraphRenderProgress", { completed: 200, total: 1201 }))
      .toBe("Rendering graph: 200 / 1201");
    expect(ontologyText(messages, "searchInstanceNodes"))
      .toBe("Search nodes by name, ID or class");
  });

  it("preserves host translations and falls back for missing shared messages", () => {
    const messages = {
      ...englishMessages,
      ontology: { ...englishMessages.ontology, instanceGraphRenderProgress: "Progress {completed}/{total}" },
      shared: { ...englishMessages.shared, dataBrowser: {} },
    } as ManagerMessages;
    expect(ontologyText(messages, "instanceGraphRenderProgress", { completed: 1, total: 2 }))
      .toBe("Progress 1/2");
    expect(sharedText(messages, "dataBrowser.filterCount", { n: 2 })).toBe("Filter (2)");
  });
});
