import type { AbcProgramOutKeyRef } from "@ontomato/contracts/dashboard";
/**
 * Hot report replay plan: built from the streamchatV1 final JSON by the ABC query chain, for the analysis domain to replay.
 */

import type { DataChunk } from "./client";

export type OutKeyRef = Required<AbcProgramOutKeyRef>;

export interface HotReportReplayPathBinding {
  subQueryIndex: number;
  originalFilePath: string;
  originalFileName?: string;
}

export interface HotReportReplayStep {
  index: number;
  sourceChunkIndex?: number;
  subQuestion?: string;
  dsl?: unknown;
  initialError?: string;
  originalFilePath?: string;
  originalFileName?: string;
}

export interface HotReportAfterCalculation {
  index: number;
  sourceChunkIndex?: number;
  subQuestion?: string;
  code: string;
  initialError?: string;
  dependencySubQueryIndexes: number[];
  pathBindings: HotReportReplayPathBinding[];
}

export interface HotReportReplayPlan {
  version: 1;
  source: "streamchatV1-final";
  sessionId?: string;
  queryCount: number;
  rawChunkCount: number;
  steps: HotReportReplayStep[];
  afterCalculations: HotReportAfterCalculation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dataItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  return isRecord(data) ? [data] : [];
}

function chunkProblem(chunk: DataChunk): string | undefined {
  if (typeof chunk.dsl?.problem === "string" && chunk.dsl.problem) return chunk.dsl.problem;
  return dataItems(chunk.data).find((item) => typeof item.problem === "string")?.problem as
    | string
    | undefined;
}

function chunkCode(chunk: DataChunk): string | undefined {
  if (typeof chunk.code === "string" && chunk.code) return chunk.code;
  return dataItems(chunk.data).find((item) => typeof item.code === "string")?.code as
    | string
    | undefined;
}

function chunkError(chunk: DataChunk): string | undefined {
  if (typeof chunk.error === "string" && chunk.error) return chunk.error;
  return dataItems(chunk.data).find((item) => typeof item.error === "string")?.error as
    | string
    | undefined;
}

function schemaDefs(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function pathBindings(defs: Record<string, unknown>[]): HotReportReplayPathBinding[] {
  return defs.flatMap((def, subQueryIndex) => {
    if (typeof def.filePath !== "string" || !def.filePath) return [];
    return [
      {
        subQueryIndex,
        originalFilePath: def.filePath,
        originalFileName: typeof def.fileName === "string" ? def.fileName : undefined,
      },
    ];
  });
}

function dependencyIndexes(chunk: DataChunk, bindings: HotReportReplayPathBinding[]): number[] {
  const indexes = new Set<number>(bindings.map((binding) => binding.subQueryIndex));
  if (Array.isArray(chunk.afterCalculatorConsanguinityList)) {
    for (const item of chunk.afterCalculatorConsanguinityList) {
      if (!isRecord(item) || !Array.isArray(item.sources)) continue;
      for (const source of item.sources) {
        if (!isRecord(source)) continue;
        const index = Number(source.subQueryIndex);
        if (Number.isInteger(index) && index >= 0) indexes.add(index);
      }
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

export function buildAbcReplayPlanFromChunks(
  chunks: DataChunk[],
  sessionId?: string
): HotReportReplayPlan | undefined {
  const finalChunks = chunks
    .filter((chunk) => chunk.source === "final")
    .sort((a, b) => (a.finalIndex ?? 0) - (b.finalIndex ?? 0));
  if (finalChunks.length === 0) return undefined;

  const steps: HotReportReplayStep[] = [];
  const afterCalculations: HotReportAfterCalculation[] = [];

  for (const chunk of finalChunks) {
    if (chunk.dsl) {
      steps.push({
        index: steps.length,
        sourceChunkIndex: chunk.finalIndex,
        subQuestion: chunkProblem(chunk),
        dsl: chunk.dsl,
        initialError: chunkError(chunk),
      });
      continue;
    }

    const code = chunkCode(chunk);
    if (!code) continue;

    const defs = schemaDefs(chunk.schemaDefs);
    const bindings = pathBindings(defs);
    afterCalculations.push({
      index: afterCalculations.length,
      sourceChunkIndex: chunk.finalIndex,
      subQuestion: chunkProblem(chunk),
      code,
      initialError: chunkError(chunk),
      dependencySubQueryIndexes: dependencyIndexes(chunk, bindings),
      pathBindings: bindings,
    });
  }

  for (const afterCalculation of afterCalculations) {
    for (const binding of afterCalculation.pathBindings) {
      const step = steps[binding.subQueryIndex];
      if (!step) continue;
      step.originalFilePath = binding.originalFilePath;
      step.originalFileName = binding.originalFileName;
    }
  }

  if (steps.length === 0 && afterCalculations.length === 0) return undefined;
  return {
    version: 1,
    source: "streamchatV1-final",
    sessionId,
    queryCount: steps.length,
    rawChunkCount: finalChunks.length,
    steps,
    afterCalculations,
  };
}
