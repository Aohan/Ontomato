import type { AbcProgramDashboard } from "@ontomato/contracts/dashboard";
import { createLogger } from "../../../logging/logger";
import { assertMetricViewSuccess, type HotCard } from "./hot-data-utils";
import {
  buildTableFromRows,
  convertChunkToDataset,
  rowsFromQueryAnswerPayloads,
  type Dataset,
} from "../adapter";
import { parseQueryAnswerPayload, parseQueryAnswerPayloads } from "../protocol";
import { t, tApp } from "../../../i18n";
import { backendGet } from "../../../utils/backend-client";
import { runWithConcurrency } from "../../../utils/concurrency";

const logger = createLogger("hot-data-fetcher");

export interface FetchedCardResult {
  card: HotCard;
  data: any[];
  tableMarkdown: string;
  dataset: Dataset;
  html?: string;
}

const HOT_CARD_FETCH_ENDPOINT = "hot-card-fetch";
const HOT_CARD_FETCH_CONCURRENCY = 4;

interface FailedCardRead {
  card: HotCard;
  reason: string;
}

function resolveCardDataPayload(json: any): unknown {
  if (json?.data !== undefined) return json.data;
  if (json?.result !== undefined) return json.result;
  if (json?.answer !== undefined) return { answer: json.answer };
  return json;
}

function parseAbcProgram(value: unknown): AbcProgramDashboard | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(tApp("queryFixed.248"));
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const outKeyRefs = Array.isArray(record.outKeyRefs) ? record.outKeyRefs : [];
  const parameters = record.parameters;
  if (!title || !code || outKeyRefs.length === 0 || !Array.isArray(parameters)) {
    throw new Error(tApp("queryFixed.249"));
  }

  return {
    title,
    code,
    outKeyRefs: outKeyRefs as AbcProgramDashboard["outKeyRefs"],
    parameters: parameters as NonNullable<AbcProgramDashboard["parameters"]>,
  };
}

async function fetchCardJson(params: {
  card: HotCard;
  token?: string;
  userId?: string;
  apiKey?: string;
  locale?: string;
  signal?: AbortSignal;
}): Promise<any> {
  const { card, token, userId, apiKey, locale, signal } = params;
  const response = await backendGet(HOT_CARD_FETCH_ENDPOINT, card.url, {
    token,
    userId,
    apiKey,
    locale,
    signal,
  });
  let json: any;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new Error(t("query.error.responseNotJson"));
  }
  assertMetricViewSuccess(json);
  return json;
}

export async function fetchHotCards(params: {
  cards: HotCard[];
  question: string;
  token?: string;
  userId?: string;
  apiKey?: string;
  locale?: string;
  signal?: AbortSignal;
}): Promise<FetchedCardResult[]> {
  const { cards, token, userId, apiKey, locale, signal } = params;

  const results = await runWithConcurrency(
    cards.map((card) => async (): Promise<FetchedCardResult | FailedCardRead> => {
      try {
        const json = await fetchCardJson({ card, token, userId, apiKey, locale, signal });
        const payload = resolveCardDataPayload(json);
        const answerPayloads = Array.isArray(payload)
          ? parseQueryAnswerPayloads(payload, tApp("queryFixed.250"))
          : [parseQueryAnswerPayload(payload, tApp("queryFixed.250"))];
        const rawData = rowsFromQueryAnswerPayloads(answerPayloads);
        const abcProgram = parseAbcProgram(json?.abcProgram);
        if (!abcProgram) {
          throw new Error(tApp("queryFixed.251"));
        }

        const { tableSegment, normalizedRows, fieldDisplayPlan } = await buildTableFromRows(
          rawData,
          card.atomicAsk,
          {
            signal,
            maxRows: 10,
            outputKeyDescriptionMDTable: json?.outputKeyDescriptionMDTable,
            code: abcProgram?.code,
            locale,
          }
        );

        const tableMarkdown = tableSegment;
        const dataset = convertChunkToDataset({ data: normalizedRows }, 0, locale);
        dataset.abcProgram = abcProgram;
        dataset.subQuestion = card.atomicAsk;
        dataset.description = card.atomicAsk;
        dataset.fieldDisplayPlan = fieldDisplayPlan;

        let html: string | undefined;
        if (json?.chartHtml) {
          html = String(json.chartHtml);
        }

        return { card, data: rawData, tableMarkdown, dataset, html };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.name === "AbortError" || /abort/i.test(err.message)) {
          throw err;
        }
        logger.error(tApp("queryFixed.252"), {
          cardName: card.atomicAsk.slice(0, 50),
          error: err.message,
        });
        return { card, reason: err.message };
      }
    }),
    HOT_CARD_FETCH_CONCURRENCY
  );

  const failures: FailedCardRead[] = [];
  const successfulResults: FetchedCardResult[] = [];
  for (const result of results) {
    if (result instanceof Error) throw result;
    if ("reason" in result) failures.push(result);
    else successfulResults.push(result);
  }

  if (failures.length > 0 && successfulResults.length === 0) {
    throw new Error(
      failures.map((failure) => `${failure.card.atomicAsk}：${failure.reason}`).join("；")
    );
  }

  logger.debug(tApp("queryFixed.247", { v0: (successfulResults.length), v1: (cards.length) }));
  return successfulResults;
}
