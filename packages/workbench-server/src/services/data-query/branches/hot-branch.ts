import type { ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import type { BaseQueryOutput, BranchContext, HotCard } from "./types";
import {
  streamDocuments,
  findKnowledge,
  normalizeHotDocs,
  calcHitCountFromPayload,
  formatDirectAnswerDetail,
} from "../hot-data/hot-data-utils";
import { judgeAndAnswerByDocs } from "../hot-data/hot-data-dynamic";
import { fetchHotCards } from "../hot-data/hot-data-fetcher";
import { streamConclusion } from "../conclusion";
import type { Dataset } from "../adapter";

import { t, tApp } from "../../../i18n";

function buildCardContent(
  validDocs: ThinkingBranchCard[],
  cards: HotCard[],
  hotDataMap: Map<string, ThinkingBranchCard>
): { text: string; cardList: ThinkingBranchCard[] } {
  const cardList: ThinkingBranchCard[] = [];

  if (cards.length > 0) {
    const parts: string[] = [];
    for (const card of cards) {
      const hotItem = hotDataMap.get(card.url);
      if (hotItem) {
        parts.push(tApp("queryFixed.209", { v0: (card.atomicAsk) }));
        parts.push(hotItem.md);
        if (hotItem.parameterInstanceDesc && hotItem.parameterInstanceDesc.length > 0) {
          parts.push(tApp("queryFixed.213"));
          for (const desc of hotItem.parameterInstanceDesc) {
            parts.push(`> ${desc}\n`);
          }
        }
        cardList.push({
          md: hotItem.md,
          url: hotItem.url,
          originQuestion: hotItem.originQuestion,
          parameterInstanceDesc: hotItem.parameterInstanceDesc,
          originSubQuery: hotItem.originSubQuery,
          originCheckResult: hotItem.originCheckResult,
        });
      }
    }
    return { text: parts.join("\n\n"), cardList };
  }

  if (validDocs.length > 0) {
    const parts: string[] = [];
    for (let i = 0; i < validDocs.length; i++) {
      const item = validDocs[i];
      let prefix = "";
      if (validDocs.length > 1) {
        prefix = tApp("queryFixed.210", { v0: (i + 1) });
      }
      let mdText = prefix + item.md;
      if (item.parameterInstanceDesc && item.parameterInstanceDesc.length > 0) {
        mdText += tApp("queryFixed.214");
        for (const desc of item.parameterInstanceDesc) {
          mdText += `> ${desc}\n`;
        }
      }
      parts.push(mdText);
      cardList.push({
        md: item.md,
        url: item.url,
        originQuestion: item.originQuestion,
        parameterInstanceDesc: item.parameterInstanceDesc,
        originSubQuery: item.originSubQuery,
        originCheckResult: item.originCheckResult,
      });
    }
    return { text: parts.join("\n\n---\n\n"), cardList };
  }

  return { text: "", cardList: [] };
}

export async function runHotBranch(
  metricViewGeneralUrl: string,
  findKnowledgeUrl: string,
  ctx: BranchContext<"hot">
): Promise<BaseQueryOutput | undefined> {
  const { queryQuestion, token, userId, locale, pushEvent, thinking, apiKey } = ctx;
  thinking.ensureParallelStarted();

  if (!metricViewGeneralUrl) {
    thinking.set("insufficient", t("query.status.notConfigured"));
    return undefined;
  }

  thinking.set("running", t("query.status.retrieving"));
  thinking.log(t("query.thinking.hotSearching"));

  const {
    items: docs,
    sessionId,
    backendNodeId,
  } = await streamDocuments({
    endpoint: metricViewGeneralUrl,
    question: queryQuestion,
    token,
    userId,
    locale,
    apiKey,
    signal: ctx.signal,
    onBackendLocation: ctx.reportBackendLocation,
  });

  if (!docs.length) {
    thinking.set("not_found", t("query.status.notFound"));
    thinking.log(t("query.thinking.hotNotFound"));
    return undefined;
  }

  const validDocs = normalizeHotDocs(docs);
  if (!validDocs.length) {
    thinking.set("not_found", t("query.status.noAvailableData"));
    thinking.log(t("query.thinking.hotNotAvailable"));
    return undefined;
  }

  let bizKnowledge = "";
  if (findKnowledgeUrl) {
    try {
      thinking.log(t("query.thinking.hotKnowledgeSupplement"));
      bizKnowledge = await findKnowledge({
        question: queryQuestion,
        token,
        userId,
        locale,
        apiKey,
        signal: ctx.signal,
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      thinking.log(t("query.thinking.hotKnowledgeFailed"));
    }
  }

  const docTexts = validDocs.map((item) => item.md + tApp("queryFixed.211", { v0: (item.url) }));
  const verdict = await judgeAndAnswerByDocs({
    question: queryQuestion,
    docs: docTexts,
    bizKnowledge,
    signal: ctx.signal,
  });

  const cards: HotCard[] = verdict.cards;
  const hitCount = calcHitCountFromPayload(validDocs);
  thinking.log(t("query.thinking.hotHitVerifying", { count: hitCount }));

  const hotDataMap = new Map<string, ThinkingBranchCard>();
  for (const item of validDocs) {
    if (item.url) hotDataMap.set(item.url, item);
  }

  const { text: mergedText, cardList } = buildCardContent(validDocs, cards, hotDataMap);
  if (mergedText) {
    thinking.setContent(mergedText);
    thinking.setCards(cardList);
  }

  if (!verdict.sufficient || cards.length === 0) {
    thinking.set("insufficient", t("query.status.insufficientCoverage"));
    thinking.log(t("query.thinking.hotInsufficient"));
    return undefined;
  }

  const detail = formatDirectAnswerDetail({
    branch: "hot",
    docs: validDocs,
    cardsCount: cards.length,
    sufficient: true,
  });
  thinking.set("running", detail);
  thinking.log(t("query.thinking.hotSufficient"));

  if (mergedText) {
    pushEvent({
      type: "abc_content",
      content: t("query.thinking.hotCardLocated") + mergedText,
      loading: true,
    });
  }

  let mergedContent = "";
  const datasets: Dataset[] = [];

  const fetchedResults = await fetchHotCards({
    cards,
    question: queryQuestion,
    token,
    userId,
    apiKey,
    locale,
    signal: ctx.signal,
  });

  for (const result of fetchedResults) {
    if (fetchedResults.length > 1) {
      mergedContent += tApp("queryFixed.212", { v0: (result.card.atomicAsk), v1: (result.tableMarkdown) });
    } else {
      mergedContent += result.tableMarkdown + "\n";
    }

    if (result.html) {
      mergedContent += result.html + "\n";
    }

    datasets.push(result.dataset);
  }

  mergedContent += "\n";

  mergedContent = await streamConclusion(
    queryQuestion,
    datasets,
    mergedContent,
    (content: string) => {
      pushEvent({
        type: "abc_content",
        content,
        loading: false,
      });
    },
    ctx.signal,
    locale
  );

  if (datasets.length > 0) {
    pushEvent({
      type: "query_datasets",
      datasets,
      nodeIds: [],
    });
  }

  thinking.set("success", detail);

  return {
    content: mergedContent,
    datasets,
    sessionId,
    backendNodeId,
  };
}
