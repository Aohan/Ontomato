<script setup lang="ts">
import type { ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import { computed, ref, watch, nextTick, onMounted } from "vue";
import { marked } from "../../../../utils/marked";
import SubgraphView from "./SubgraphView.vue";
import QcInlineResult from "./QcInlineResult.vue";
import { computeCardDisplayData } from "../../utils/thinkingUtils";

import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();

const props = defineProps<{
  card: ThinkingBranchCard;
}>();

const display = computed(() => computeCardDisplayData(props.card));
const markdownRef = ref<HTMLElement | null>(null);

function parseParamDesc(desc: string): { original: string; replaced: string } | null {
  const match = desc.match(workbenchContent().hotCardConditionReplacement);
  if (match) return { original: match[1].trim(), replaced: match[2].trim() };
  return null;
}

const hasOriginCard = computed(() => {
  return !!(props.card.originQuestion || display.value.subgraph || display.value.checkResult);
});

const isSimpleCard = computed(() => !hasOriginCard.value);

const renderedAnswerBody = computed(() => {
  let body: string;
  if (isSimpleCard.value) {
    body = (props.card.md || "").replace(/^\s*#\s+.+\n?/m, "").trim();
  } else {
    body = display.value.answerBody;
  }
  if (!body) return "";
  return marked.parse(body) as string;
});

function setupTableMerge() {
  const root = markdownRef.value;
  if (!root) return;

  const detailsList = root.querySelectorAll("details[data-ai-table-details]");
  detailsList.forEach((detailsEl) => {
    const details = detailsEl as HTMLDetailsElement;
    if (details.hasAttribute("data-ai-merge-bound")) return;
    details.setAttribute("data-ai-merge-bound", "true");

    const summary = details.querySelector("summary");
    const innerTable = details.querySelector("table");
    if (!summary || !innerTable) return;

    summary.classList.add("ai-table-more-toggle");
    if (!summary.getAttribute("data-ai-state")) {
      summary.setAttribute("data-ai-state", "collapsed");
    }

    let merged = false;
    let savedRows: HTMLTableRowElement[] = [];

    summary.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (merged) return;

      let prev = details.previousElementSibling;
      let mainTable: HTMLTableElement | null = null;
      while (prev) {
        if (prev.tagName === "TABLE") {
          mainTable = prev as HTMLTableElement;
          break;
        }
        const inner = prev.querySelector("table");
        if (inner) {
          mainTable = inner;
          break;
        }
        prev = prev.previousElementSibling;
      }
      if (!mainTable) return;

      const mainBody = mainTable.tBodies[0];
      const innerBody = innerTable.tBodies[0];
      if (!mainBody || !innerBody) return;

      const visibleCount = mainBody.rows.length;
      const extraRows = Array.from(innerBody.rows);
      if (!extraRows.length) return;

      savedRows = extraRows;
      extraRows.forEach((tr) => mainBody.appendChild(tr));
      merged = true;

      summary.setAttribute("data-ai-state", "expanded");
      summary.textContent = t("example.collapseToRows", { n: visibleCount });

      const collapseTrigger = document.createElement("div");
      collapseTrigger.className = "ai-table-more-toggle";
      collapseTrigger.setAttribute("data-ai-state", "expanded");
      collapseTrigger.textContent = t("example.collapseToRows", { n: visibleCount });
      collapseTrigger.style.cssText =
        "display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--el-color-primary);font-size:13px;margin-top:8px;";

      details.style.display = "none";
      details.insertAdjacentElement("afterend", collapseTrigger);

      collapseTrigger.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const allRows = Array.from(mainBody.rows);
        for (let i = allRows.length - 1; i >= visibleCount; i--) {
          const row = allRows[i];
          row.parentNode?.removeChild(row);
          innerBody.appendChild(row);
        }
        details.style.display = "";
        merged = false;
        summary.setAttribute("data-ai-state", "collapsed");
        summary.textContent = t("example.expandToViewAll", {
          more: savedRows.length,
          total: visibleCount + savedRows.length,
        });
        collapseTrigger.remove();
      });
    });
  });
}

onMounted(() => {
  nextTick(() => setupTableMerge());
});

watch(renderedAnswerBody, () => {
  nextTick(() => setupTableMerge());
});
</script>

<template>
  <div class="hot-card">
    <div class="hot-card__title">{{ display.title || t("hotData.dynamicMetricHotData") }}</div>

    <div v-if="!isSimpleCard" class="hot-card__kv">
      <span class="hot-card__key">{{ t("hotData.currentQuestion") }}</span>
      <span class="hot-card__value">{{ display.question || t("hotData.notProvided") }}</span>
    </div>

    <div v-if="card.parameterInstanceDesc?.length" class="hot-card__block">
      <div class="block-label">{{ t("hotData.conditionReplacement") }}</div>
      <div
        v-for="(desc, di) in card.parameterInstanceDesc"
        :key="di"
        class="hot-card__param-replace"
      >
        <template v-if="parseParamDesc(desc)">
          <span class="param-original">{{ parseParamDesc(desc)!.original }}</span>
          <span class="param-arrow">→</span>
          <span class="param-replaced">{{ parseParamDesc(desc)!.replaced }}</span>
        </template>
        <template v-else>{{ desc }}</template>
      </div>
    </div>

    <div v-if="hasOriginCard" class="hot-card__block">
      <div class="block-label">{{ t("hotData.matchedOriginalData") }}</div>

      <div class="origin-card">
        <div v-if="card.originQuestion" class="hot-card__kv">
          <span class="hot-card__key">{{ t("hotData.originQuestion") }}</span>
          <span class="hot-card__value">{{ card.originQuestion }}</span>
        </div>

        <SubgraphView v-if="display.subgraph" :sub-query="card.originSubQuery" />

        <details v-if="display.rawSubQuery !== undefined" class="hot-card__details">
          <summary>{{ t("hotData.originalSubgraph") }}</summary>
          <pre class="hot-card__pre">{{ JSON.stringify(display.rawSubQuery, null, 2) }}</pre>
        </details>

        <QcInlineResult v-if="display.checkResult" :check-result="display.checkResult" />

        <details v-if="display.rawCheckResult !== undefined" class="hot-card__details">
          <summary>{{ t("hotData.originalQcData") }}</summary>
          <pre class="hot-card__pre">{{ JSON.stringify(display.rawCheckResult, null, 2) }}</pre>
        </details>
      </div>
    </div>

    <div v-if="renderedAnswerBody" class="hot-card__block">
      <div v-if="hasOriginCard" class="block-label">{{ t("hotData.answerContent") }}</div>
      <div v-else class="block-label">{{ t("hotData.resultContent") }}</div>
      <div ref="markdownRef" class="hot-card__markdown" v-html="renderedAnswerBody"></div>
    </div>

    <div v-if="card.url" class="hot-card__block">
      <div class="block-label">{{ t("hotData.dataLink") }}</div>
      <a :href="card.url" target="_blank" class="hot-card__link">{{ card.url }}</a>
    </div>
  </div>
</template>

<style scoped>
.hot-card {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 16px;
  margin-bottom: 16px;
}
.hot-card:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}
.hot-card__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.hot-card__kv {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.hot-card__key {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  min-width: 56px;
  flex-shrink: 0;
}
.hot-card__value {
  font-size: 13px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
  word-break: break-word;
}
.hot-card__block {
  margin: 14px 0;
}
.block-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}
.hot-card__param-replace {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.param-original {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}
.param-arrow {
  color: var(--el-color-primary);
  font-weight: 700;
  flex-shrink: 0;
}
.param-replaced {
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.origin-card {
  padding: 14px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}
.hot-card__link {
  display: block;
  color: var(--el-color-primary);
  font-size: 12px;
  word-break: break-all;
  line-height: 1.6;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}
.hot-card__link:hover {
  text-decoration-color: var(--el-color-primary);
}
.hot-card__details {
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.hot-card__details summary {
  cursor: pointer;
  font-weight: 600;
  padding: 2px 0;
}
.hot-card__pre {
  margin-top: 4px;
  padding: 10px;
  background: var(--el-bg-color);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}
.hot-card__markdown {
  font-size: 13px;
  color: var(--el-text-color-primary);
  line-height: 1.7;
}
.hot-card__markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 8px 0;
}
.hot-card__markdown :deep(th),
.hot-card__markdown :deep(td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 10px;
  text-align: left;
}
.hot-card__markdown :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
  white-space: nowrap;
}
.hot-card__markdown :deep(tr:nth-child(even)) {
  background: var(--el-fill-color-lighter);
}
.hot-card__markdown :deep(h1),
.hot-card__markdown :deep(h2),
.hot-card__markdown :deep(h3) {
  font-size: 14px;
  margin: 8px 0 4px;
}
.hot-card__markdown :deep(p) {
  margin: 4px 0;
}
.hot-card__markdown :deep(ul),
.hot-card__markdown :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.hot-card__markdown :deep(.ai-table-more-toggle) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  color: var(--el-color-primary);
  font-size: 13px;
}
.hot-card__markdown :deep(.ai-table-more-toggle)::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid currentColor;
  transform: rotate(-90deg);
  transition: transform 0.15s;
}
.hot-card__markdown :deep(.ai-table-more-toggle[data-ai-state="expanded"])::before {
  transform: rotate(0deg);
}
</style>
