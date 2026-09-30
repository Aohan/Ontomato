import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Real consumers of the two text rules: the model and the data engine are external dependencies replaced by test doubles; parsing and request construction run the real code.
vi.mock("@ontomato/workbench-server/config/model-factory", () => ({
  createModel: () => ({
    // The escaped literals are Chinese dataset column names (see the \u escapes below) — user data kept byte-identical.
    invoke: async () => ({ content: JSON.stringify({ "\u9500\u552e\u989d（\u4e07\u5143）": "revenue", "\u65e5\u671f (day)": "date" }) }),
  }),
}));
import {
  installContentLayout,
  installRuntimeDefaults,
  installWorkbenchProduct,
} from "@ontomato/workbench-server";
import { buildHeaders, getApiConfig } from "@ontomato/workbench-server/config/data-query-api";
import { batchAppendChartFieldMapper } from "@ontomato/workbench-server/services/dashboard/planning/core/chart-recommender";
import { datasetSchemaService } from "@ontomato/workbench-server/services/data-query/dataset-schema";
import { runWithLogContext } from "@ontomato/workbench-server/logging/log-context";
import { getSystemModelConfig } from "@ontomato/workbench-server/config/system-model";
import { ossContentLayout } from "../content";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";
import { ossRuntimeDefaults } from "../runtime-defaults";

let runtimeRoot: string;

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oss-defaults-"));
  vi.stubEnv("ONTOMATO_LOG_DIR", path.join(runtimeRoot, "logs"));
  installContentLayout(ossContentLayout(runtimeRoot));
  installWorkbenchProduct(ossProduct);
  installRuntimeDefaults(ossRuntimeDefaults);
  configureOssI18n();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));

describe("open-source application defaults", () => {
  it("provides default system model config with harness mode and default timeout", () => {
    expect(getSystemModelConfig("oss-domain")).toEqual({
      abcQuestionMode: "harness",
      queryTimeoutSeconds: 600,
    });
  });

  it("always asks DataRAG for English, even when the caller passes another locale", () => {
    expect(buildHeaders(getApiConfig(), undefined, undefined, "zh-CN")["Accept-Language"]).toBe("en");
    expect(buildHeaders(getApiConfig())["Accept-Language"]).toBe("en");
  });

  it("strips chart field annotations with the open-source parenthesis rule", async () => {
    const { charts } = await batchAppendChartFieldMapper(
      [{ name: "q", type: "bar", datasetKey: "d" }] as never,
      [{ datasetKey: "d", sourceRows: [{ x: 1 }] }] as never
    );
    expect(charts[0].fields).toEqual({ "\u9500\u552e\u989d（\u4e07\u5143）": "revenue", "\u65e5\u671f": "date" });
  });

  it("extracts dataset class paths with the open-source delimiter rule", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        requests.push({ url: String(url), body: JSON.parse(init.body) });
        return String(url).endsWith("/admin/getschemamarkdown-v2")
          ? Response.json({ data: { KEY_CLASS_DEF: "/a/b，desc\n| /c/d，note | x |" } })
          : Response.json({ data: "" });
      })
    );
    datasetSchemaService.setConfig("http://datarag.invalid");
    await runWithLogContext({ domainId: "schema-domain" }, () =>
      datasetSchemaService.getSchemaForQuestion("xyz")
    );
    expect(requests.find((request) => request.url.endsWith("/admin/getSchemaByClassName"))?.body).toEqual({
      classNames: ["/a/b，desc", "/c/d，note"],
    });
  });
});
