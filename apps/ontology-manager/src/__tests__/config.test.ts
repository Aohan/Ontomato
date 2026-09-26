import { afterEach, describe, expect, it, vi } from "vitest";
import { readRuntimeConfig } from "../config";

describe("运行配置：config.js → VITE_ONTOLOGY_* → 默认", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__ONTOLOGY_MANAGER_CONFIG__;
  });

  it("config.js 的值优先于构建期环境，apiBase 去掉末尾斜杠", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "/vite-api");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "/runtime/api//", INITIAL_ROUTE: "/assets/metrics" };
    expect(readRuntimeConfig()).toEqual({ apiBase: "/runtime/api", initialRoute: "/assets/metrics" });
  });

  it("config.js 缺失（未提供或加载失败）时取构建期环境", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "https://gateway.example/api/");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    expect(readRuntimeConfig()).toEqual({ apiBase: "https://gateway.example/api", initialRoute: "/data" });
  });

  it("config.js 字段为空（部署变量留空）时取构建期环境", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "/vite-api");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "/data");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "", INITIAL_ROUTE: "" };
    expect(readRuntimeConfig()).toEqual({ apiBase: "/vite-api", initialRoute: "/data" });
  });

  it("都未给值时 apiBase 为 /api、初始路由为空（交给视图默认）", () => {
    vi.stubEnv("VITE_ONTOLOGY_API_BASE", "");
    vi.stubEnv("VITE_ONTOLOGY_INITIAL_ROUTE", "");
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "", INITIAL_ROUTE: "" };
    expect(readRuntimeConfig()).toEqual({ apiBase: "/api", initialRoute: "" });
    delete window.__ONTOLOGY_MANAGER_CONFIG__;
    expect(readRuntimeConfig()).toEqual({ apiBase: "/api", initialRoute: "" });
  });
});
