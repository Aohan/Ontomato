import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../../../content/layout";
import { workbenchServerResourceRoot } from "../../../../../content/resources";
import { syncDefaultPrompts } from "../../../../../core/prompts/loader";
import { configureI18n } from "../../../../../i18n";
import { appTextEn } from "../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../i18n/locales/en";
import { executeSingleCase } from "../single-case";

const OSS_DEFAULT = "A result counts as correct";

const mocks = vi.hoisted(() => ({
  executeApiChat: vi.fn(),
  evaluateAnswer: vi.fn(),
  buildTurnEvidenceWorkspace: vi.fn(),
}));

vi.mock("../../strategies/api-chat", () => ({ executeApiChat: mocks.executeApiChat }));
vi.mock("../../evaluation/answer-evaluator", () => ({ evaluateAnswer: mocks.evaluateAnswer }));
vi.mock("../../../observe/workspaces/turn-evidence-workspace", () => ({
  buildTurnEvidenceWorkspace: mocks.buildTurnEvidenceWorkspace,
}));

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oss-judgment-"));

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: {
      en: {
        messages: { ...en, ...appTextEn },
        ...enLocaleMeta,
      },
    },
  });
  installContentLayout({
    runtimeRoot,
    prompts: [{ from: path.join(workbenchServerResourceRoot, "prompts"), to: "." }],
    skillTemplate: [],
    runtimeResources: [],
  });
  syncDefaultPrompts();
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.executeApiChat.mockResolvedValue({
    status: "success",
    durationMs: 1,
    turnKey: "turn-1",
    finalAnswer: "answer",
  });
  mocks.evaluateAnswer.mockResolvedValue({
    passed: false,
    analysis: "model-analysis",
    answerSummary: "model-summary",
  });
  mocks.buildTurnEvidenceWorkspace.mockImplementation(async (input: { artifactDir: string }) => {
    fs.mkdirSync(input.artifactDir, { recursive: true });
    return {
      status: "success",
      artifactResult: { artifactDir: input.artifactDir, logicMarkdown: "" },
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("OSS default judgment", () => {
  it("uses the protocol value when the case omits judgment", async () => {
    const result = await run("omitted");
    expect(mocks.evaluateAnswer).not.toHaveBeenCalled();
    expect(result.answerEvaluation).toMatchObject({
      passed: true,
      analysis: OSS_DEFAULT,
      answerSummary: "Result produced",
    });
    expect(report("omitted")).toContain(OSS_DEFAULT);
  });

  it("keeps the shortcut when the case repeats the protocol value", async () => {
    const result = await run("explicit", OSS_DEFAULT);
    expect(mocks.evaluateAnswer).not.toHaveBeenCalled();
    expect(result.answerEvaluation).toMatchObject({ analysis: OSS_DEFAULT, answerSummary: "Result produced" });
    expect(report("explicit")).toContain(`### Evaluation Criteria\n\n${OSS_DEFAULT}`);
  });

  it("calls the evaluator when judgment is not the protocol value", async () => {
    const result = await run("custom", "must name the region");
    expect(mocks.evaluateAnswer).toHaveBeenCalledOnce();
    expect(mocks.evaluateAnswer.mock.calls[0][0].judgment).toBe("must name the region");
    expect(result.answerEvaluation).toMatchObject({ passed: false, analysis: "model-analysis" });
    const text = report("custom");
    expect(text).toContain("model-analysis");
    expect(text).toContain("must name the region");
    expect(text).not.toContain(OSS_DEFAULT);
  });
});

async function run(caseId: string, judgment?: string) {
  vi.useFakeTimers();
  const pending = executeSingleCase({
    domainId: "default",
    runId: "run-1",
    testCase: { caseId, question: "q", judgment },
  });
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

function report(caseId: string): string {
  return fs.readFileSync(path.join(runtimeRoot, "data", "autotest", "runs", "run-1", caseId, "evaluation.md"), "utf8");
}
