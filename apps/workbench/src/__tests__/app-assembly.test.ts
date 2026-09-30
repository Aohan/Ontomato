import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisTask } from "@ontomato/workbench-server/services/analysis-agent/task-types";

// Real entry assembly; only startup side effects (listening, syncing, DB, scheduler), task storage, and model runs are replaced.
// dotenv replaces only the file-read step: it records the path the entry provides and writes one config variable like a .env would,
// proving it runs before the config modules evaluate (see product-env.test.ts for the real read).
const DOTENV_BASE_URL = "http://from-product-env.invalid";
const mocks = vi.hoisted(() => ({
  dotenv: vi.fn(),
  started: undefined as undefined | ((app: Express) => void),
  task: undefined as AnalysisTask | undefined,
  createTask: vi.fn(),
  workflow: vi.fn(),
}));

vi.mock("dotenv", () => ({ default: { config: mocks.dotenv } }));
vi.mock("@ontomato/workbench-server/http/create-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/workbench-server/http/create-app")>()),
  startWorkbench: async (app: Express) => mocks.started!(app),
}));
vi.mock("@ontomato/workbench-server/services/analysis-agent/runtime", () => ({
  getAnalysisAgentService: async () => ({
    getAgent: async () => ({ id: "agent-1", name: "Agent", executionMode: "loop" }),
  }),
  runDeepAnalysis: mocks.workflow,
}));
vi.mock("@ontomato/workbench-server/services/chat/thread-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/workbench-server/services/chat/thread-store")>()),
  createThreadPlaceholder: async () => {},
}));
vi.mock("@ontomato/workbench-server/api/utils/title", () => ({
  generateTitleAsync: async () => undefined,
}));
vi.mock("@ontomato/workbench-server/services/analysis-agent/report/email-notify", () => ({
  getEmailNotifyService: () => ({
    sendTaskCompleteNotification: async () => true,
    sendTaskFailedNotification: async () => true,
  }),
}));
vi.mock("@ontomato/workbench-server/services/analysis-agent/task/task-service", () => ({
  getAnalysisTaskService: () => ({
    createTask: mocks.createTask,
    getTask: async () => mocks.task,
    tryStartTask: async () => {
      mocks.task = { ...mocks.task!, status: "running", runHistory: [{ id: "run", status: "running" }] };
      return mocks.task;
    },
    updateTaskStatus: async (_id: string, status: AnalysisTask["status"], extra: object) => {
      mocks.task = { ...mocks.task!, ...extra, status };
      return mocks.task;
    },
    updateTaskArtifacts: async (_id: string, artifacts: Partial<AnalysisTask>) => {
      mocks.task = { ...mocks.task!, ...artifacts };
      return mocks.task;
    },
    listConversationTurns: async () => [],
  }),
}));

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sharedResources = path.join(repoRoot, "packages", "workbench-server");
let server: Server;
let base: string;
const realFetch = globalThis.fetch;
const tempDirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

beforeAll(async () => {
  // The startup directory is not the repo root: the assembly result must not depend on the invoking cwd.
  vi.spyOn(process, "cwd").mockReturnValue(tempDir("oss-cwd-"));
  // Logs go to a temp directory through the existing directory override variable; the tests never write into repository runtime data.
  vi.stubEnv("ONTOMATO_LOG_DIR", tempDir("oss-logs-"));
  vi.stubEnv("DATA_QUERY_BASE_URL", "");
  mocks.dotenv.mockImplementation(() => void vi.stubEnv("DATA_QUERY_BASE_URL", DOTENV_BASE_URL));
  const app = await new Promise<Express>((resolve) => {
    mocks.started = resolve;
    void import("../index");
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.createTask.mockReset();
  mocks.workflow.mockReset();
});

describe("open-source workbench assembly", () => {
  it("loads the product-root .env first and installs the product runtime root regardless of cwd", async () => {
    const layout = await import("@ontomato/workbench-server/content/layout");
    expect(mocks.dotenv).toHaveBeenCalledOnce();
    expect(mocks.dotenv).toHaveBeenCalledWith({ path: path.join(repoRoot, ".env") });
    const { config } = await import("@ontomato/workbench-server/config/application");
    expect(config.dataQuery.baseUrl).toBe(DOTENV_BASE_URL);
    expect(layout.runtimeRoot()).toBe(repoRoot);
    expect(layout.runtimeDataDir()).toBe(path.join(repoRoot, "data"));
    expect(layout.webDistDir()).toBe(path.join(repoRoot, "dist", "web"));
    expect(layout.promptSources()).toEqual([
      { from: path.join(sharedResources, "prompts"), to: "." },
    ]);
    expect(layout.runtimeResourceSources().map((source) => source.from)).toEqual([
      path.join(sharedResources, "data", "echart"),
      path.join(sharedResources, "data", "knowledge"),
      path.join(sharedResources, "data", "skills"),
    ]);
  });

  it("serves public routes without enterprise-only routes", async () => {
    expect((await realFetch(`${base}/api/health`)).status).toBe(200);
    for (const route of ["/api/auth/domains", "/api/connections", "/api/data-governance/ticket"]) {
      expect((await realFetch(`${base}${route}`)).status, route).toBe(404);
    }
  });

  it("runs tasks as the fixed system/default subject and keeps the task-row owner unchecked", async () => {
    mocks.createTask.mockImplementation(async (input: Partial<AnalysisTask>) => {
      mocks.task = {
        id: "task-1",
        agentId: "agent-1",
        // The task row's attribution differs from the online principal: the OSS edition keeps the task row and never compares attribution.
        userId: "row-user",
        domainId: "row-domain",
        name: "task",
        description: "",
        status: "pending",
        threadId: input.threadId!,
        question: input.question!,
        scheduleEnabled: false,
        notifyOnComplete: false,
        triggerSource: "manual",
        createdAt: 1,
        updatedAt: 1,
      };
      return mocks.task;
    });
    mocks.workflow.mockRejectedValue(new Error("stopped after owner confirmation"));
    const fetchSpy = vi.fn(realFetch);
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const response = await realFetch(
        `${base}/api/analysis-agents/chat/deep-analysis?message=q&agentId=agent-1&threadId=oss-t&runId=oss-r`,
        { signal: AbortSignal.timeout(5_000) }
      );
      expect(response.status).toBe(200);
      const events = await response.text();
      expect(events).toContain("stopped after owner confirmation");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "system", domainId: "default" })
    );
    expect(mocks.workflow).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "row-user", domainId: "row-domain" })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the open-source log id rule: ASCII separators only", async () => {
    const ids = await import("@ontomato/workbench-server/platform/diagnosis/observe/parsers/session-id");
    expect(ids.extractSessionIdFromText("sessionId: abc-1")).toBe("abc-1");
    expect(ids.extractSessionIdFromText("sessionId：abc-1")).toBeUndefined();
    expect(ids.extractSessionIdFromObject({ message: "session_id=abc-1" })).toBe("abc-1");
    expect(ids.extractSessionIdFromObject({ message: "sessionId：abc-1" })).toBeUndefined();
    expect(ids.extractBackendNodeIdFromText("backendNodeId=n-1.a")).toBe("n-1.a");
    expect(ids.extractBackendNodeIdFromText("backendNodeId：n-1")).toBeUndefined();
    expect(ids.extractBackendNodeIdFromObject({ message: "backend node id: n-1" })).toBe("n-1");
    expect(ids.extractBackendNodeIdFromObject({ message: "backendNodeId：n-1" })).toBeUndefined();
  });
});
