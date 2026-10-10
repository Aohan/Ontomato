import { afterEach, describe, expect, it, vi } from "vitest";
import { readRuntimeConfig } from "../config";

describe("runtime config: config.js → VITE_ONTOLOGY_* → defaults", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.unstubAllEnvs();
    delete window.__ONTOLOGY_MANAGER_CONFIG__;
  });

  it("config.js values take precedence over the build-time environment and apiBase loses its trailing slash", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "/vite-api");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "/runtime/api//", INITIAL_ROUTE: "/assets/metrics" };
    expect(readRuntimeConfig()).toEqual({ apiBase: `${window.location.origin}/runtime/api`, initialRoute: "/assets/metrics" });
  });

  it("uses the build-time environment when config.js is missing (not provided or failed to load)", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "https://gateway.example/api/");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    expect(readRuntimeConfig()).toEqual({ apiBase: "https://gateway.example/api", initialRoute: "/data" });
  });

  it("uses the build-time environment when config.js fields are empty (deployment variables left blank)", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "/vite-api");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "", INITIAL_ROUTE: "" };
    expect(readRuntimeConfig()).toEqual({ apiBase: `${window.location.origin}/vite-api`, initialRoute: "/data" });
  });

  it("without any values apiBase is relative to the page and the initial route is empty (left to the view default)", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "", INITIAL_ROUTE: "" };
    expect(readRuntimeConfig()).toEqual({ apiBase: `${window.location.origin}/api`, initialRoute: "" });
    delete window.__ONTOLOGY_MANAGER_CONFIG__;
    expect(readRuntimeConfig()).toEqual({ apiBase: `${window.location.origin}/api`, initialRoute: "" });
  });
  it("resolves the generated ./api under the Manager's own mount independently of the workbench", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "");
    for (const path of ["/", "/manager/", "/nested/manager/index.html"]) {
      window.history.replaceState({}, "", `${path}#/playground`);
      window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "./api" };
      expect(readRuntimeConfig().apiBase).toBe(new URL("./api", window.location.href).href);
      delete window.__ONTOLOGY_MANAGER_CONFIG__;
      expect(readRuntimeConfig().apiBase).toBe(new URL("./api", window.location.href).href);
    }
  });

});
