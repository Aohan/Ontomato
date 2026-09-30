import { beforeEach, describe, expect, it } from "vitest";
import { syncView } from "../view";
import { isolateShellPerTest } from "./isolation";

const resetShell = isolateShellPerTest();

function start(url: string, initialRoute = "") {
  resetShell();
  window.history.replaceState({}, "", url);
  return syncView(initialRoute);
}

describe("view and hash", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("a non-root hash wins over the view parameter and initial route, and the query passes through as-is", () => {
    const { view } = start("/?view=assets#/visual-modeling?focus=object&id=A&back=playground", "/objects");
    expect(view.value).toBe("/visual-modeling?focus=object&id=A&back=playground");
  });

  it("a root hash does not locate anything; the view parameter maps to data browsing and smart assets", () => {
    expect(start("/?view=data-browser#/").view.value).toBe("/data");
    expect(start("/?view=assets").view.value).toBe("/assets/metrics");
    expect(start("/?view=knowledge").view.value).toBe("/knowledge");
  });

  it("view=visual-modeling maps to the modeling view; focus/id/back enter the view query as-is and other parameters are dropped", () => {
    expect(start("/?view=visual-modeling&theme=dark").view.value).toBe("/visual-modeling");
    expect(
      start("/?view=visual-modeling&focus=relation&id=placedBy&back=playground&keep=1").view.value
    ).toBe("/visual-modeling?focus=relation&id=placedBy&back=playground");
    expect(start("/?view=visual-modeling&id=Order#/data").view.value).toBe("/data");
  });

  it("next comes the deployment's initial route normalized to a path, and finally /playground", () => {
    expect(start("/?view=other", "#objects/A").view.value).toBe("/objects/A");
    expect(start("/", " /data ").view.value).toBe("/data");
    expect(start("/").view.value).toBe("/playground");
  });

  it("the initial view and component navigation replace the hash without adding history", () => {
    const before = window.history.length;
    const { view, replaceView } = start("/?view=assets");
    expect(window.location.hash).toBe("#/assets/metrics");
    replaceView("/assets/actions/a-1");
    expect(view.value).toBe("/assets/actions/a-1");
    expect(window.location.hash).toBe("#/assets/actions/a-1");
    expect(window.location.search).toBe("?view=assets");
    expect(window.history.length).toBe(before);
  });

  it("the view follows manual hash changes", () => {
    const { view } = start("/#/data/Order");
    window.location.hash = "#/relations/placedBy";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(view.value).toBe("/relations/placedBy");
  });

  it("test isolation: restarting removes the old instance's hashchange listener", () => {
    const first = start("/#/data").view;
    const second = start("/#/objects").view;
    window.location.hash = "#/relations/placedBy";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(first.value).toBe("/data");
    expect(second.value).toBe("/relations/placedBy");
  });
});
