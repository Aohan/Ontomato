import type { OutKeyRef } from "../../data-query/replay-plan";
import type { QueryExecutionFact } from "../../data-query/query-fact";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { normalizeAnswerRows, type Dataset } from "../../data-query/adapter";
import { parseQueryAnswerPayload } from "../../data-query/protocol";
import type { HotReportReplayPathBinding, HotReportReplayPlan } from "../../data-query/replay-plan";
import type { DimensionalizedQuestion } from "./dimension-types";
import type { AnalysisQueryFact, DimensionQueryResult } from "../runtime/evidence-types";
import {
  buildQueryResultDataFromDatasets,
  buildQueryResultDslFromDatasets,
  flattenQueryResultData,
  getQueryResultDataCount,
  type QueryResultRow,
} from "../runtime/query-result";
import { config } from "../../../config/application";
import { environment } from "../../../config/environment";
import { runtimeDataDir } from "../../../content/layout";
import { backendPost, BackendUnavailableError } from "../../../utils/backend-client";
import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";


const logger = createLogger("abc-replay");
const PYTHON_TIMEOUT_MS = 30000;
const ABC_PROGRAM_EXECUTE_TIMEOUT_MS = 3 * 60_000;
const ABC_PROGRAM_REQUEST_INTERVAL_MS = 500;
const execFileAsync = promisify(execFile);

/** Hot replay execution result = execution facts + business execution state; execution fields are not re-declared here. */
export interface AbcReplayExecutionResult extends AnalysisQueryFact {
  status: "completed" | "failed";
  error?: string;
}

export type AbcReplayDslExecutor = (params: {
  dsl: unknown;
  questionId: string;
  dimensionId: string;
  dimensionName: string;
  dimensionValue: string;
  subQuestion: string;
  token?: string;
  signal?: AbortSignal;
}) => Promise<DimensionQueryResult>;

export interface PythonRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export type PythonRunner = (params: {
  code: string;
  scriptPath: string;
  cwd: string;
  signal?: AbortSignal;
}) => Promise<PythonRunResult>;

export interface ExecuteAbcReplayPlanParams {
  plan: HotReportReplayPlan;
  question: DimensionalizedQuestion;
  executeDsl: AbcReplayDslExecutor;
  token?: string;
  signal?: AbortSignal;
  replayRootDir?: string;
  replayId?: string;
  pythonRunner?: PythonRunner;
}

export interface ExecuteSavedAbcReplayParams extends Omit<ExecuteAbcReplayPlanParams, "plan"> {
  replayPlan?: HotReportReplayPlan;
  savedDsl?: unknown;
  /** Second-level decomposition traces come from the execution facts; fields are not re-declared here */
  savedAbcTrace?: Pick<
    QueryExecutionFact,
    "abcSubQuestions" | "abcDsls" | "abcCodes" | "abcOutKeyRefs"
  >;
}

type ReplayItem = {
  title: string;
  status: "completed" | "failed" | "skipped";
  rows?: QueryResultRow[];
  dsl?: unknown;
  code?: string;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function answerRows(data: unknown): QueryResultRow[] {
  return normalizeAnswerRows(parseQueryAnswerPayload(data, tApp("analysis.dimension.abc-replay.31")).answer);
}

function safeSessionId(sessionId: string | undefined): string {
  return (sessionId || "session").replace(/[^a-zA-Z0-9_-]/g, "_") || "session";
}

async function writeAnswerFile(
  replayDir: string,
  sessionId: string | undefined,
  index: number,
  rows: QueryResultRow[]
): Promise<string> {
  const filePath = path.join(replayDir, `${safeSessionId(sessionId)}_${index}.json`);
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf8");
  return filePath;
}

function replaceCachePaths(
  code: string,
  bindings: HotReportReplayPathBinding[],
  localPathByIndex: Map<number, string>
): { code: string; missingIndexes: number[] } {
  let output = code;
  const missingIndexes: number[] = [];
  for (const binding of bindings) {
    const localPath = localPathByIndex.get(binding.subQueryIndex);
    if (!localPath) {
      missingIndexes.push(binding.subQueryIndex);
      continue;
    }
    output = output.split(binding.originalFilePath).join(localPath);
  }
  return { code: output, missingIndexes };
}

export const defaultPythonRunner: PythonRunner = async ({ code, scriptPath, cwd, signal }) => {
  await writeFile(scriptPath, code, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(environment.replayCommand(), [scriptPath], {
      cwd,
      signal,
      timeout: PYTHON_TIMEOUT_MS,
    });
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (error: any) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
      error:
        error?.name === "AbortError" ? tApp("analysis.dimension.abc-replay.32") : error?.message || tApp("analysis.dimension.abc-replay.33"),
    };
  }
};

function parsePythonAnswer(stdout: string): { rows: QueryResultRow[]; error?: string } {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .pop();
  if (!line) return { rows: [], error: tApp("analysis.dimension.abc-replay.34") };

  try {
    const parsed = JSON.parse(line);
    const rows = answerRows(parsed);
    const error =
      isRecord(parsed) && typeof parsed.error === "string" && parsed.error
        ? parsed.error
        : undefined;
    return { rows, error };
  } catch {
    return { rows: [], error: tApp("analysis.dimension.abc-replay.35") };
  }
}

function dataset(title: string, rows: QueryResultRow[], dsl?: unknown): Dataset {
  return {
    name: title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_").slice(0, 50) || "hot_report",
    description: title,
    columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
    data: rows,
    dsl,
    subQuestion: title,
  };
}

function table(title: string, rows: QueryResultRow[] | undefined, error?: string): string {
  if (error) return error;
  const count = rows?.length || 0;
  return tApp("analysis.dimension.abc-replay.36", { title: title, count: count });
}

function toResult(items: ReplayItem[], plan: HotReportReplayPlan): AbcReplayExecutionResult {
  const completed = items.filter((item) => item.status === "completed" && item.rows);
  const datasets = completed.map((item) => dataset(item.title, item.rows || [], item.dsl));
  const errors = items
    .filter((item) => item.status !== "completed" && item.error)
    .map((item) => item.error as string);
  // Display body and result table are one and the same: a replay result's body is each dataset's title and row-count description.
  const markdownTable = items
    .map((item) => `### ${item.title}\n\n${table(item.title, item.rows, item.error)}`)
    .join("\n\n");

  return {
    status: completed.length > 0 ? "completed" : "failed",
    data: buildQueryResultDataFromDatasets(datasets),
    dsl: buildQueryResultDslFromDatasets(datasets),
    fullContent: markdownTable,
    markdownTable,
    datasets,
    datasetPreviews: completed.map((item) => ({
      title: item.title,
      markdownTable: table(item.title, item.rows),
      dataCount: item.rows?.length || 0,
    })),
    abcSubQuestions: [
      ...plan.steps.map((step) => step.subQuestion || tApp("analysis.dimension.abc-replay.37", { value: step.index + 1 })),
      ...plan.afterCalculations.map((item) => item.subQuestion || tApp("analysis.dimension.abc-replay.38", { value: item.index + 1 })),
    ],
    abcDsls: plan.steps.map((step) => step.dsl),
    abcCodes: completed.map((item) => item.code || ""),
    abcOutKeyRefs: completed.map(() => []),
    replayPlan: plan,
    dataCount: datasets.reduce((sum, item) => sum + item.data.length, 0),
    error: errors.length > 0 ? errors.join(tApp("analysis.dimension.abc-replay.39")) : undefined,
  };
}

function isExecutableDsl(value: unknown): value is Record<string, unknown> {
  return (
    !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
  );
}

export function normalizeSavedAbcDsls(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isExecutableDsl);
  }
  return isExecutableDsl(value) ? [value] : [];
}

function buildDirectDslDatasetPreviews(results: DimensionQueryResult[]) {
  return results.map((result, index) => {
    const dataset = result.datasets?.[0];
    const title =
      dataset?.description ||
      dataset?.name ||
      result.subQuestion ||
      (results.length > 1 ? tApp("analysis.dimension.abc-replay.40", { value: index + 1 }) : tApp("analysis.dimension.abc-replay.41"));
    return {
      title,
      markdownTable: result.markdownTable || result.error || "",
      dataCount: getQueryResultDataCount(result.data),
    };
  });
}

function mergeDirectDslReplayResults(
  question: DimensionalizedQuestion,
  results: DimensionQueryResult[],
  savedAbcTrace?: ExecuteSavedAbcReplayParams["savedAbcTrace"]
): AbcReplayExecutionResult {
  const completedResults = results.filter((result) => result.status === "completed");
  const datasets = completedResults.flatMap((result) => result.datasets || []);
  const datasetPreviews = results.length > 1 ? buildDirectDslDatasetPreviews(results) : undefined;
  const errorMessages = results
    .filter((result) => result.status !== "completed" && result.error)
    .map((result) => result.error as string);
  const abcSubQuestions =
    savedAbcTrace?.abcSubQuestions ||
    results.map((result) => result.subQuestion).filter((item): item is string => !!item);
  const abcDsls =
    savedAbcTrace?.abcDsls ||
    results.map((result) => result.dsl).filter((item) => item !== undefined);
  // When results exist, details are collected together with this run's successful datasets; failed items or unexecuted stale programs must never be attached to it.
  const abcCodes =
    datasets.length > 0
      ? completedResults.flatMap((result) =>
          (result.datasets || []).map((_, index) => result.abcCodes?.[index] || "")
        )
      : savedAbcTrace?.abcCodes;
  const abcOutKeyRefs =
    datasets.length > 0
      ? completedResults.flatMap((result) =>
          (result.datasets || []).map((_, index) => result.abcOutKeyRefs?.[index] || [])
        )
      : savedAbcTrace?.abcOutKeyRefs;

  if (completedResults.length === 0) {
    // Display body and result table are one and the same.
    const markdownTable =
      results.length > 1
        ? buildDirectDslDatasetPreviews(results)
            .map((preview) => `### ${preview.title}\n\n${preview.markdownTable}`)
            .join("\n\n")
        : results[0]?.markdownTable;
    return {
      status: "failed",
      dsl: results.length > 1 ? results.map((result) => result.dsl) : results[0]?.dsl,
      fullContent: markdownTable,
      markdownTable,
      datasets,
      datasetPreviews,
      abcSubQuestions,
      abcDsls,
      abcCodes,
      abcOutKeyRefs,
      dataCount: 0,
      error: errorMessages.join(tApp("analysis.dimension.abc-replay.39")) || tApp("analysis.dimension.abc-replay.42"),
    };
  }

  const data =
    datasets.length > 0
      ? buildQueryResultDataFromDatasets(datasets)
      : completedResults.length > 1
        ? completedResults.flatMap((result) => flattenQueryResultData(result.data))
        : completedResults[0]?.data;
  const dsl =
    datasets.length > 0
      ? buildQueryResultDslFromDatasets(datasets)
      : results.length > 1
        ? results.map((result) => result.dsl)
        : results[0]?.dsl;
  const dataCount =
    datasets.length > 0
      ? datasets.reduce((sum, dataset) => sum + (dataset.data?.length || 0), 0)
      : completedResults.reduce((sum, result) => sum + getQueryResultDataCount(result.data), 0);
  const markdownTable =
    results.length > 1
      ? buildDirectDslDatasetPreviews(results)
          .map((preview) => `### ${preview.title}\n\n${preview.markdownTable}`)
          .join("\n\n")
      : completedResults[0]?.markdownTable || "";

  return {
    status: "completed",
    data,
    dsl,
    // Display body and result table are one and the same.
    fullContent: markdownTable,
    markdownTable,
    datasets,
    datasetPreviews,
    abcSubQuestions,
    abcDsls,
    abcCodes,
    abcOutKeyRefs,
    dataCount,
    error: errorMessages.length > 0 ? errorMessages.join(tApp("analysis.dimension.abc-replay.39")) : undefined,
  };
}

const ABC_PROGRAM_EXECUTE_ENDPOINT = "abcProgram/execute";

function buildAbcProgramExecuteUrl(backendUrl: string) {
  return `${backendUrl.replace(/\/$/, "")}/abcProgram/execute`;
}

export async function executeAbcProgram(params: {
  code: string;
  outKeyRefs: OutKeyRef[];
  questionId: string;
  dimensionId: string;
  dimensionName: string;
  dimensionValue: string;
  subQuestion: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<DimensionQueryResult> {
  const {
    code,
    outKeyRefs,
    questionId,
    dimensionId,
    dimensionName,
    dimensionValue,
    subQuestion,
    token,
    signal,
  } = params;

  const baseResult: DimensionQueryResult = {
    questionId,
    dimensionId,
    dimensionName,
    dimensionValue,
    subQuestion,
    status: "pending",
  };

  const backendUrl = config.dataQuery.baseUrl;
  if (!backendUrl) {
    baseResult.status = "failed";
    baseResult.error = tApp("analysis.dimension.abc-replay.43");
    return baseResult;
  }

  const executeUrl = buildAbcProgramExecuteUrl(backendUrl);

  try {
    baseResult.status = "in_progress";

    const response = await backendPost(
      ABC_PROGRAM_EXECUTE_ENDPOINT,
      executeUrl,
      {
        code,
        outKeyRefs,
      },
      {
        token,
        timeoutMs: ABC_PROGRAM_EXECUTE_TIMEOUT_MS,
        signal,
      }
    );

    const contentType = response.headers.get("content-type") || "";
    const rawText = response.text;
    const payload = contentType.includes("application/json")
      ? (() => {
          try {
            return JSON.parse(rawText);
          } catch {
            return rawText;
          }
        })()
      : rawText;

    if (!payload || typeof payload !== "object" || !(payload as Record<string, unknown>).success) {
      baseResult.status = "failed";
      baseResult.error = tApp("analysis.dimension.abc-replay.44", { value: typeof payload === "string" ? payload : JSON.stringify(payload) });
      return baseResult;
    }

    const rawData = Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as Record<string, unknown>[])
      : [];

    baseResult.status = "completed";
    baseResult.data = rawData;
    baseResult.dataCount = rawData.length;

    const columns = rawData.length > 0 ? Object.keys(rawData[0]) : [];
    const dataset: Dataset = {
      name:
        subQuestion.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_").slice(0, 50) ||
        "abc_program_result",
      description: subQuestion,
      columns,
      data: rawData,
      subQuestion,
    };
    baseResult.datasets = [dataset];
    baseResult.abcCodes = [code];
    baseResult.abcOutKeyRefs = [outKeyRefs];

    if (rawData.length > 0) {
      const headerRow = `| ${columns.join(" | ")} |`;
      const separatorRow = `| ${columns.map(() => "---").join(" | ")} |`;
      const dataRows = rawData
        .map((row) => `| ${columns.map((col) => String(row[col] ?? "")).join(" | ")} |`)
        .join("\n");
      // Display body and result table are one and the same.
      baseResult.fullContent =
        baseResult.markdownTable = `${headerRow}\n${separatorRow}\n${dataRows}`;
    } else {
      // Display body and result table are one and the same.
      baseResult.fullContent = baseResult.markdownTable = tApp("analysis.dimension.abc-replay.45", { subQuestion: subQuestion });
    }

    return baseResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(tApp("analysis.dimension.abc-replay.46"), { url: executeUrl, error: message });

    if (error instanceof BackendUnavailableError) {
      baseResult.status = "failed";
      baseResult.error = tApp("analysis.dimension.abc-replay.47", { message: message });
    } else {
      baseResult.status = "failed";
      baseResult.error = tApp("analysis.dimension.abc-replay.48", { message: message });
    }
    return baseResult;
  }
}

export async function executeSavedAbcReplay({
  replayPlan,
  savedDsl,
  savedAbcTrace,
  question,
  executeDsl,
  token,
  signal,
  replayRootDir,
  replayId,
  pythonRunner,
}: ExecuteSavedAbcReplayParams): Promise<AbcReplayExecutionResult> {
  const abcCodes = savedAbcTrace?.abcCodes;
  const abcOutKeyRefs = savedAbcTrace?.abcOutKeyRefs;
  if (abcCodes && abcCodes.length > 0 && abcOutKeyRefs && abcOutKeyRefs.length > 0) {
    const results: DimensionQueryResult[] = [];
    for (const [index, code] of abcCodes.entries()) {
      if (index > 0) {
        await delay(ABC_PROGRAM_REQUEST_INTERVAL_MS, undefined, { signal });
      }
      results.push(
        await executeAbcProgram({
          code,
          outKeyRefs: abcOutKeyRefs[index] || [],
          questionId: question.id,
          dimensionId: question.dimensionId,
          dimensionName: question.dimensionName,
          dimensionValue: question.dimensionValue,
          subQuestion:
            abcCodes.length > 1
              ? `${question.subQuestion} - ${String(index + 1)}`
              : question.subQuestion,
          token,
          signal,
        })
      );
    }

    return mergeDirectDslReplayResults(question, results, savedAbcTrace);
  }

  if (replayPlan) {
    return executeAbcReplayPlan({
      plan: replayPlan,
      question,
      executeDsl,
      token,
      signal,
      replayRootDir,
      replayId,
      pythonRunner,
    });
  }

  const savedDsls = normalizeSavedAbcDsls(savedDsl);
  if (savedDsls.length === 0) {
    return {
      status: "failed",
      abcSubQuestions: savedAbcTrace?.abcSubQuestions || [question.subQuestion],
      abcDsls: savedAbcTrace?.abcDsls,
      abcCodes: savedAbcTrace?.abcCodes,
      abcOutKeyRefs: savedAbcTrace?.abcOutKeyRefs,
      dataCount: 0,
      error: tApp("analysis.dimension.abc-replay.49"),
    };
  }

  const results = await Promise.all(
    savedDsls.map((dsl, dslIndex) =>
      executeDsl({
        dsl,
        questionId: question.id,
        dimensionId: question.dimensionId,
        dimensionName: question.dimensionName,
        dimensionValue: question.dimensionValue,
        subQuestion:
          savedDsls.length > 1
            ? `${question.subQuestion} - ${String(dsl.problem || dslIndex + 1)}`
            : question.subQuestion,
        token,
        signal,
      })
    )
  );

  return mergeDirectDslReplayResults(question, results, savedAbcTrace);
}

export async function executeAbcReplayPlan({
  plan,
  question,
  executeDsl,
  token,
  signal,
  replayRootDir = environment.replayDir(runtimeDataDir("abc-replay")),
  replayId = randomUUID(),
  pythonRunner = defaultPythonRunner,
}: ExecuteAbcReplayPlanParams): Promise<AbcReplayExecutionResult> {
  const replayDir = path.join(replayRootDir, replayId);
  await mkdir(replayDir, { recursive: true });

  const items: ReplayItem[] = [];
  const localPathByIndex = new Map<number, string>();

  for (const step of plan.steps) {
    if (!step.dsl) continue;
    const title = step.subQuestion || tApp("analysis.dimension.abc-replay.50", { subQuestion: question.subQuestion, value: step.index + 1 });

    if (step.initialError) {
      items.push({
        title,
        status: "skipped",
        dsl: step.dsl,
        error: tApp("analysis.dimension.abc-replay.51", { initialError: step.initialError }),
      });
      continue;
    }

    const result = await executeDsl({
      dsl: step.dsl,
      questionId: question.id,
      dimensionId: question.dimensionId,
      dimensionName: question.dimensionName,
      dimensionValue: question.dimensionValue,
      subQuestion: title,
      token,
      signal,
    });
    const rows = result.status === "completed" ? flattenQueryResultData(result.data) : [];

    if (rows.length === 0) {
      items.push({
        title,
        status: "failed",
        dsl: step.dsl,
        error: result.error || tApp("analysis.dimension.abc-replay.52"),
      });
      continue;
    }

    localPathByIndex.set(
      step.index,
      await writeAnswerFile(replayDir, plan.sessionId, step.index, rows)
    );
    items.push({ title, status: "completed", rows, dsl: step.dsl });
  }

  for (const afterCalculation of plan.afterCalculations) {
    const title = afterCalculation.subQuestion || tApp("analysis.dimension.abc-replay.53", { subQuestion: question.subQuestion });
    const missingDependency = afterCalculation.dependencySubQueryIndexes.filter(
      (index) => !localPathByIndex.has(index)
    );
    if (missingDependency.length > 0) {
      items.push({
        title,
        status: "skipped",
        error: tApp("analysis.dimension.abc-replay.54", { join: missingDependency.join(", ") }),
      });
      continue;
    }

    const rewritten = replaceCachePaths(
      afterCalculation.code,
      afterCalculation.pathBindings,
      localPathByIndex
    );
    if (rewritten.missingIndexes.length > 0) {
      items.push({
        title,
        status: "skipped",
        error: tApp("analysis.dimension.abc-replay.55", { join: rewritten.missingIndexes.join(", ") }),
      });
      continue;
    }

    const py = await pythonRunner({
      code: rewritten.code,
      scriptPath: path.join(replayDir, `after_calculation_${afterCalculation.index}.py`),
      cwd: replayDir,
      signal,
    });
    if (!py.ok) {
      logger.warn(tApp("analysis.dimension.abc-replay.56"), { title, error: py.error || py.stderr });
      items.push({ title, status: "failed", error: py.error || py.stderr || tApp("analysis.dimension.abc-replay.33") });
      continue;
    }

    const parsed = parsePythonAnswer(py.stdout);
    if (parsed.error || parsed.rows.length === 0) {
      items.push({ title, status: "failed", error: parsed.error || tApp("analysis.dimension.abc-replay.57") });
      continue;
    }
    items.push({ title, status: "completed", rows: parsed.rows, code: rewritten.code });
  }

  return toResult(items, plan);
}
