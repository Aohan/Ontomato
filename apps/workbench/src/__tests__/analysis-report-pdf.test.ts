import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@ontomato/workbench-server/i18n/index";
import { buildDeepAnalysisMarkdown } from "@ontomato/workbench-server/services/analysis-agent/task/task-result";
import { buildAttachmentContentDisposition } from "@ontomato/workbench-server/api/utils/http";

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  getRule: vi.fn(async (): Promise<{ id: string } | null> => null),
  toScheduleRuleTask: vi.fn(),
  exportMarkdownPdf: vi.fn(),
  dotenv: vi.fn(() => ({})),
  started: undefined as undefined | ((app: http.RequestListener) => void),
}));

vi.mock("dotenv", () => ({ default: { config: mocks.dotenv } }));

vi.mock("@ontomato/workbench-server/http/create-app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ontomato/workbench-server/http/create-app")>();
  return {
    ...actual,
    startWorkbench: async (app: http.RequestListener) => {
      mocks.started!(app);
    },
  };
});

vi.mock("@ontomato/workbench-server/services/analysis-agent/task/task-service", () => ({
  getAnalysisTaskService: () => ({ getTask: mocks.getTask }),
}));

vi.mock("@ontomato/workbench-server/services/analysis-agent/task/schedule-rules", () => ({
  getAnalysisScheduleRuleService: () => ({ get: mocks.getRule }),
  toScheduleRuleTask: mocks.toScheduleRuleTask,
}));

vi.mock("@ontomato/workbench-server/services/analysis-agent/delivery/pdf-export", () => ({
  exportMarkdownPdf: mocks.exportMarkdownPdf,
}));

const reportPayload = {
  executionMode: "dimension" as const,
  runState: {
    status: "cancelled" as const,
    revision: 1,
    progress: { done: 1, label: "" },
  },
  activities: [],
  sections: [
    {
      sectionId: "report",
      title: "Summary",
      titleLevel: 2,
      order: 0,
      revision: 1,
      markdown: "Body\n\n[chart:summary:c1]",
      status: "success" as const,
    },
  ],
  charts: [
    {
      chartId: "c1",
      scopeId: "report",
      title: "Chart",
      chartType: "bar",
      sourceSubQuestion: "q",
      html: "<div>chart</div>",
      skillId: "bar",
      dataCount: 1,
    },
  ],
  chartDiagnostics: [],
};

const task = {
  id: "task-1",
  userId: "system",
  domainId: "default",
  name: "Analyse trimestrielle",
  status: "cancelled" as const,
  reportDeliverableEnabled: true,
  analysisPayload: reportPayload,
};

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-pdf-oss-"));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
let server: http.Server;
let base: string;

beforeAll(async () => {
  vi.stubEnv("ONTOMATO_LOG_DIR", logDir);
  vi.stubEnv("API_BASE", "/api");
  vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "");
  const app = await new Promise<http.RequestListener>((resolve) => {
    mocks.started = resolve;
    void import("../index");
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  mocks.getTask.mockReset().mockResolvedValue(task);
  mocks.getRule.mockReset().mockResolvedValue(null);
  mocks.toScheduleRuleTask.mockReset();
  mocks.exportMarkdownPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-1.4"));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe("open-source anonymous report PDF", () => {
  it("returns a local download URL and serves that PDF without a credential", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 0));
    try {
      const listed = await callPdfTool();
      const downloadUrl = `${base}/api/analysis-tasks/task-1/report.pdf`;
      if (listed.downloadUrl !== downloadUrl) {
        throw new Error(`unexpected download URL: ${listed.downloadUrl ?? listed.error}`);
      }
      const response = await fetch(downloadUrl);
      const fileName = "Analyse trimestrielle_2026-09-24T10-00-00.pdf";

      expect(mocks.dotenv).toHaveBeenCalledWith({ path: path.join(repoRoot, ".env") });
      expect(listed).toEqual({ success: true, downloadUrl });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        buildAttachmentContentDisposition(fileName)
      );
      expect(response.headers.get("content-disposition")).toContain(encodeURIComponent("Analyse trimestrielle"));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("%PDF-1.4"));
      expect(mocks.exportMarkdownPdf).toHaveBeenCalledTimes(1);
      expect(mocks.exportMarkdownPdf).toHaveBeenCalledWith({
        title: "Analyse trimestrielle",
        markdown: buildDeepAnalysisMarkdown(reportPayload),
        renderInlineCharts: true,
      });
      expect(mocks.getTask).toHaveBeenCalledWith("task-1", "default");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a caller API key and does not verify it upstream", async () => {
    const realFetch = globalThis.fetch;
    let upstream = 0;
    vi.stubGlobal("fetch", (input: unknown, init?: unknown) => {
      if (!String(input).startsWith(base)) upstream += 1;
      return realFetch(
        input as Parameters<typeof realFetch>[0],
        init as Parameters<typeof realFetch>[1]
      );
    });
    try {
      const listed = await callPdfTool({ "x-api-key": "not-a-credential" });
      const downloadUrl = `${base}/api/analysis-tasks/task-1/report.pdf`;
      if (listed.downloadUrl !== downloadUrl) {
        throw new Error(`unexpected download URL: ${listed.downloadUrl ?? listed.error}`);
      }
      const response = await fetch(downloadUrl, {
        headers: { "x-api-key": "not-a-credential" },
      });
      expect(listed).toEqual({
        success: true,
        downloadUrl: `${base}/api/analysis-tasks/task-1/report.pdf`,
      });
      expect(response.status).toBe(200);
      expect(upstream).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("derives the download URL from forwarded proto and host", async () => {
    const listed = await callPdfTool({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "public.example",
    });
    expect(listed).toEqual({
      success: true,
      downloadUrl: "https://public.example/api/analysis-tasks/task-1/report.pdf",
    });
    expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
  });

  it("rejects an MCP URL override that does not end with the analysis-agent path", async () => {
    vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "https://public.example/mcp");
    try {
      const listed = await callPdfTool();
      expect(JSON.stringify(listed)).toContain("/mcp/analysis-agents");
      expect(listed).not.toMatchObject({ success: true });
      expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "");
    }
  });

  it("rejects a task that does not deliver a report", async () => {
    mocks.getTask.mockResolvedValue({
      ...task,
      status: "completed",
      reportDeliverableEnabled: false,
    });
    const listed = await callPdfTool();
    expect(listed).toEqual({ success: false, error: "No analysis report to export" });
    expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
  });

  it("rejects a report whose latest run has no body", async () => {
    mocks.getTask.mockResolvedValue({
      ...task,
      status: "running",
      analysisPayload: { ...reportPayload, sections: [], charts: [] },
    });
    const response = await fetch(`${base}/api/analysis-tasks/task-1/report.pdf`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: t("api.noReportToExport") });
    expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
  });

  it("rejects a schedule rule even when the projection has report text", async () => {
    mocks.getTask.mockResolvedValue(null);
    mocks.getRule.mockResolvedValue({ id: "rule-1" });
    mocks.toScheduleRuleTask.mockReturnValue({ ...task, id: "rule-1", name: "Schedule rule" });
    const response = await fetch(`${base}/api/analysis-tasks/rule-1/report.pdf`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: t("api.noReportToExport") });
    expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
  });

  it("rejects a task owned by someone other than system/default", async () => {
    mocks.getTask.mockResolvedValue({ ...task, userId: "user-b" });
    const response = await fetch(`${base}/api/analysis-tasks/task-1/report.pdf`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: t("api.noAccessToTask") });
    expect(mocks.exportMarkdownPdf).not.toHaveBeenCalled();
  });
});

async function callPdfTool(headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/mcp/analysis-agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_analysis_report_pdf", arguments: { taskId: "task-1" } },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  const raw = dataLine ? dataLine.slice("data: ".length) : body;
  let message: {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message?: string };
  };
  try {
    message = JSON.parse(raw);
  } catch {
    return { success: false, error: body };
  }
  if (message.error?.message) return { success: false, error: message.error.message };
  const text = message.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return { success: false, error: body };
  try {
    return JSON.parse(text) as { success: boolean; downloadUrl?: string; error?: string };
  } catch {
    return { success: false, error: text };
  }
}
