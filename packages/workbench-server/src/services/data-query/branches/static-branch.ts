import type { ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import type { BaseQueryOutput, BranchContext, HotCard } from "./types";
import {
  findDocuments,
  findKnowledge,
  normalizeHotDocs,
  calcHitCountFromPayload,
  formatDirectAnswerDetail,
} from "../hot-data/hot-data-utils";
import { judgeAndAnswerByStaticDocs } from "../hot-data/hot-data-static";
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
      let text = prefix + item.md;
      if (item.parameterInstanceDesc && item.parameterInstanceDesc.length > 0) {
        text += tApp("queryFixed.214");
        for (const desc of item.parameterInstanceDesc) {
          text += `> ${desc}\n`;
        }
      }
      parts.push(text);
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

export async function runStaticBranch(
  metricViewStaticUrl: string,
  findKnowledgeUrl: string,
  ctx: BranchContext<"static">
): Promise<BaseQueryOutput | undefined> {
  const { queryQuestion, token, userId, locale, pushEvent, thinking, apiKey } = ctx;
  thinking.ensureParallelStarted();

  if (!metricViewStaticUrl) {
    thinking.set("insufficient", t("query.status.notConfigured"));
    return undefined;
  }

  thinking.set("running", t("query.status.retrieving"));
  thinking.log(t("query.thinking.staticChecking"));

  const docs = await findDocuments({
    endpoint: metricViewStaticUrl,
    question: queryQuestion,
    token,
    userId,
    locale,
    apiKey,
    signal: ctx.signal,
  });

  if (!docs.length) {
    thinking.set("not_found", t("query.status.notFound"));
    thinking.log(t("query.thinking.staticNotFound"));
    return undefined;
  }

  const validDocs = normalizeHotDocs(docs);
  if (!validDocs.length) {
    thinking.set("not_found", t("query.status.noAvailableData"));
    thinking.log(t("query.thinking.staticNotAvailable"));
    return undefined;
  }

  let bizKnowledge = "";
  if (findKnowledgeUrl) {
    try {
      thinking.log(t("query.thinking.staticKnowledgeSupplement"));
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
      thinking.log(t("query.thinking.staticKnowledgeFailed"));
    }
  }

  const docTexts = validDocs.map((item) => item.md + tApp("queryFixed.211", { v0: (item.url) }));
  const verdict = await judgeAndAnswerByStaticDocs({
    question: queryQuestion,
    docs: docTexts,
    bizKnowledge,
    signal: ctx.signal,
  });

  const cards: HotCard[] = verdict.cards;
  const hitCount = calcHitCountFromPayload(validDocs);
  thinking.log(t("query.thinking.staticHitVerifying", { count: hitCount }));

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
    thinking.log(t("query.thinking.staticInsufficient"));
    return undefined;
  }

  const detail = formatDirectAnswerDetail({
    branch: "static",
    docs: validDocs,
    cardsCount: cards.length,
    sufficient: true,
  });
  thinking.set("running", detail);
  thinking.log(t("query.thinking.staticSufficient"));

  if (mergedText) {
    pushEvent({
      type: "abc_content",
      content: t("query.thinking.staticCardLocated") + mergedText,
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

    if (result.dataset) {
      datasets.push(result.dataset);
    }
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
  };
}
