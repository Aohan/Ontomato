<script setup lang="ts">
import { ZoomIn } from "lucide-vue-next";
import {
  computed,
  watch,
  nextTick,
  ref,
  toRef,
  onMounted,
  onBeforeUnmount,
  createVNode,
  render,
} from "vue";
import { renderMarkdown } from "./utils/markdown";
import { renderMermaidIn } from "../../utils/mermaid";
import { useTableAdjustment } from "../../composables/useTableAdjustment";
import { useContentParser } from "../../composables/useContentParser";
import { useTheme } from "../../../../composables/useTheme";
import { ElImageViewer } from "element-plus";
import { useI18n } from "vue-i18n";
import { withSkillResourceCredentials } from "../../../skills/utils/skill-resource";
import SubgraphView from "../thinking/SubgraphView.vue";
import ResultDatasetActions from "./ResultDatasetActions.vue";
import type { ResultDataset, TableData } from "./types";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    content: string;
    forceShow?: boolean;
    visualizationHTML?: string;
    visualizationLoading?: boolean;
    /**
     * Result datasets produced by this query: the body tables correspond to them by sub-question,
     * header, or title, and the name, row count, data/DSL download, and DSL/code/lineage details
     * are provided with the corresponding table. Datasets without a body table are still presented
     * as result entries, so deduplication does not drop real output.
     */
    resultDatasets?: ResultDataset[];
    /**
     * Whether to show the table's dashboard entry: shown by default. Turned off when the caller has
     * no dashboard context, keeping only download; a button that would be unresponsive to clicks
     * must not be delivered.
     */
    showDashboardAction?: boolean;
  }>(),
  { resultDatasets: () => [] }
);

const emit = defineEmits<{
  addToDashboard: [payload: { datasetIndex: number; datasetTitle?: string }];
}>();

function normalizeText(value?: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColumnName(value: string) {
  return normalizeText(value).toLowerCase();
}

function tableHeadersMatchDataset(part: TableData, dataset: ResultDataset) {
  if (!Array.isArray(part.headers) || part.headers.length === 0) return false;
  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) return false;

  const datasetColumns = new Set(
    dataset.rows.flatMap((row) => Object.keys(row).map((key) => normalizeColumnName(key)))
  );
  if (datasetColumns.size === 0) return false;

  const matchedHeaderCount = part.headers.filter((header) =>
    datasetColumns.has(normalizeColumnName(header))
  ).length;
  return matchedHeaderCount > 0 && matchedHeaderCount === part.headers.length;
}

function extractLatestSubQuestion(beforeContent?: string) {
  const text = String(beforeContent || "");
  const matches = Array.from(
    text.matchAll(
      workbenchContent().answerSubject
    )
  );
  const latest = matches[matches.length - 1];
  return latest ? normalizeText(latest[1] || latest[2] || latest[3]) : "";
}

/**
 * Maps a body table to the dataset it presents. Only datasets with rows are matched — a zero-row
 * result is a no-data empty state in the body rather than a table; the index comes from the filtered
 * order here, consistent with the dashboard datasets the server retrieves in the same order.
 */
function resolveDatasetMeta(part: TableData): ResultDataset | undefined {
  const datasets = props.resultDatasets.filter((dataset) => dataset.rows.length > 0);

  const latestSubQuestion = extractLatestSubQuestion(part.beforeContent);
  if (latestSubQuestion) {
    const matched = datasets.find((dataset) => {
      const subQuestion = normalizeText(dataset.subQuestion);
      return !!subQuestion && latestSubQuestion === subQuestion;
    });
    if (matched) return matched;
  }

  const tableTitle = normalizeText(part.title);
  if (tableTitle) {
    const matched = datasets.find(
      (dataset) =>
        tableTitle === normalizeText(dataset.title) ||
        tableTitle === normalizeText(dataset.subQuestion)
    );
    if (matched) return matched;
  }

  return datasets.length === 1 && tableHeadersMatchDataset(part, datasets[0])
    ? datasets[0]
    : undefined;
}

/**
 * Datasets resolved for each body table. Recorded by `TableData` object identity: when one body is
 * split into multiple segments for parsing, table ids restart, so using the id as a key would make
 * an earlier segment's table point to a later segment's dataset.
 */
const resolvedTableDatasets = computed(() => {
  const resolved = new Map<TableData, ResultDataset>();
  for (const part of contentParts.value) {
    if (part.type !== "table" || !part.table) continue;
    const dataset = resolveDatasetMeta(part.table);
    if (dataset) resolved.set(part.table, dataset);
  }
  return resolved;
});

const resolvedDatasetFor = (table: TableData) => resolvedTableDatasets.value.get(table);

/**
 * Real results with no body table to attach to: when there is no body but there is data, the body
 * lacks a table, or headers do not match, the name, row count, and details can still be viewed and
 * downloaded without losing output to body deduplication.
 */
const unattachedDatasets = computed(() => {
  const attached = new Set(resolvedTableDatasets.value.values());
  return props.resultDatasets.filter((dataset) => !attached.has(dataset));
});

function onAddToDashboard(dataset: ResultDataset) {
  const datasetIndex = props.resultDatasets.filter((item) => item.rows.length > 0).indexOf(dataset);
  emit("addToDashboard", { datasetIndex, datasetTitle: dataset.title });
}

const contentRef = ref<HTMLElement | null>(null);
const renderKey = ref(0);
const viewerVisible = ref(false);
const viewerUrls = ref<string[]>([]);
const viewerIndex = ref(0);
let imageUpgradeTimer: ReturnType<typeof setTimeout> | null = null;
let imageObserver: MutationObserver | null = null;
let mermaidResizeObserver: ResizeObserver | null = null;
let mermaidViewerResizeObserver: ResizeObserver | null = null;
const viewerCaption = ref("");
const displayedCaption = ref("");
const viewerCounter = ref("");
const mermaidViewerVisible = ref(false);
const mermaidViewerSvg = ref("");
const mermaidViewerContentRef = ref<HTMLElement | null>(null);
const shownCaptionKeys = new Set<string>();
let captionTimer: ReturnType<typeof setTimeout> | null = null;
let thinkingTimer: ReturnType<typeof setInterval> | null = null;
let thinkingTimeout: ReturnType<typeof setTimeout> | null = null;
const { initializeTableAdjustment } = useTableAdjustment(contentRef);
const { contentParts } = useContentParser(
  toRef(props, "content"),
  toRef(props, "visualizationHTML"),
  toRef(props, "visualizationLoading")
);
const { isDark } = useTheme();

const openMermaidViewer = (host: HTMLElement) => {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.removeProperty("width");
  mermaidViewerSvg.value = clone.outerHTML;
  mermaidViewerVisible.value = true;
  void fitMermaidViewer();
};

const fitMermaidToHost = (host: HTMLElement, constrainHeight = false) => {
  const svg = host.querySelector("svg") as SVGSVGElement | null;
  const viewBox = svg?.getAttribute("viewBox");
  const viewBoxParts = viewBox?.trim().split(/\s+/).map(Number) || [];
  const viewBoxWidth = viewBoxParts[2];
  const viewBoxHeight = viewBoxParts[3];
  if (
    !svg ||
    !Number.isFinite(viewBoxWidth) ||
    viewBoxWidth <= 0 ||
    !Number.isFinite(viewBoxHeight) ||
    viewBoxHeight <= 0
  )
    return;

  const styles = getComputedStyle(host);
  const horizontalPadding =
    Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const availableWidth = Math.max(0, host.clientWidth - horizontalPadding);
  const verticalPadding =
    Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const availableHeight = Math.max(0, host.clientHeight - verticalPadding);
  const heightLimitedWidth =
    constrainHeight && availableHeight > 0
      ? (availableHeight * viewBoxWidth) / viewBoxHeight
      : viewBoxWidth;
  const displayWidth = Math.min(
    viewBoxWidth,
    availableWidth > 0 ? availableWidth : viewBoxWidth,
    heightLimitedWidth
  );
  svg.style.width = `${Math.ceil(displayWidth)}px`;
};

const fitMermaidViewer = async () => {
  await nextTick();
  const host = mermaidViewerContentRef.value;
  if (!host) return;
  fitMermaidToHost(host, true);
  mermaidViewerResizeObserver?.disconnect();
  mermaidViewerResizeObserver = new ResizeObserver(() => fitMermaidToHost(host, true));
  mermaidViewerResizeObserver.observe(host);
};

const enhanceMermaidZoomControls = () => {
  if (!contentRef.value) return;

  const graphs = Array.from(contentRef.value.querySelectorAll(".mermaid-svg")) as HTMLElement[];
  for (const graph of graphs) {
    fitMermaidToHost(graph);
    if (graph.dataset.zoomEnhanced === "true") continue;

    graph.classList.add("mermaid-zoom-host");
    graph.dataset.zoomEnhanced = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-zoom-button";
    button.setAttribute("aria-label", t("dashboard.zoomIn"));
    button.setAttribute("title", t("dashboard.zoomIn"));
    render(createVNode(ZoomIn, { size: 16, strokeWidth: 2 }), button);
    graph.appendChild(button);
  }

  mermaidResizeObserver?.disconnect();
  mermaidResizeObserver = new ResizeObserver(() => {
    for (const graph of graphs) fitMermaidToHost(graph);
  });
  for (const graph of graphs) mermaidResizeObserver.observe(graph);
};

const renderMermaid = async () => {
  await nextTick();
  if (contentRef.value) {
    try {
      await renderMermaidIn(contentRef.value, isDark.value ? "dark" : "default");
      enhanceMermaidZoomControls();
    } catch (error) {
      console.warn("[Mermaid] Render failed:", error);
    }
  }
};

const stopCaptionAnimation = () => {
  if (captionTimer) {
    clearTimeout(captionTimer);
    captionTimer = null;
  }
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  if (thinkingTimeout) {
    clearTimeout(thinkingTimeout);
    thinkingTimeout = null;
  }
};

const typeWriterCaption = (text: string) => {
  stopCaptionAnimation();
  displayedCaption.value = "";

  if (!text) return;

  let index = 0;
  const tick = () => {
    displayedCaption.value = text.slice(0, index);
    index += 1;
    if (index <= text.length) {
      const delay = 35 + Math.random() * 50;
      captionTimer = setTimeout(tick, delay);
      return;
    }
    captionTimer = null;
  };

  tick();
};

const startThinkingThenType = (text: string) => {
  stopCaptionAnimation();
  displayedCaption.value = t("chat.analyzingImage");

  let dots = 0;
  thinkingTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    displayedCaption.value = `${t("chat.analyzingImage")}${".".repeat(dots || 3)}`;
  }, 360);

  const thinkDuration = 2000 + Math.random() * 600;
  thinkingTimeout = setTimeout(() => {
    if (thinkingTimer) {
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
    thinkingTimeout = null;
    typeWriterCaption(text);
  }, thinkDuration);
};

const updateViewerCaption = (node?: HTMLElement | null) => {
  viewerCaption.value = node?.getAttribute("data-caption") || "";

  const captionKey = node?.getAttribute("data-caption-key") || node?.getAttribute("data-src") || "";
  if (!viewerCaption.value) {
    displayedCaption.value = "";
    stopCaptionAnimation();
    return;
  }

  if (captionKey && shownCaptionKeys.has(captionKey)) {
    stopCaptionAnimation();
    displayedCaption.value = viewerCaption.value;
    return;
  }

  if (captionKey) shownCaptionKeys.add(captionKey);
  startThinkingThenType(viewerCaption.value);
};

const updateViewerMeta = (node?: HTMLElement | null) => {
  updateViewerCaption(node);
  viewerCounter.value =
    viewerUrls.value.length > 1 ? `${viewerIndex.value + 1} / ${viewerUrls.value.length}` : "";
};

const getLightboxSrc = (node: HTMLElement) => {
  return (
    node.getAttribute("data-src") ||
    (node instanceof HTMLImageElement ? node.currentSrc || node.src : "") ||
    (node.querySelector("img") as HTMLImageElement | null)?.src ||
    ""
  );
};

const openImageViewer = (target: HTMLElement) => {
  const group = target.getAttribute("data-lightbox-group") || "message-content";
  const all = Array.from(contentRef.value?.querySelectorAll("[data-lightbox-group]") || []).filter(
    (node): node is HTMLElement => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.getAttribute("data-lightbox-group") !== group) return false;
      if (node instanceof HTMLImageElement && node.closest(".message-inline-image-host"))
        return false;
      return !!getLightboxSrc(node);
    }
  );
  if (!all.length) return;

  const targetSrc = getLightboxSrc(target);
  viewerUrls.value = all.map((node) => getLightboxSrc(node)).filter(Boolean);
  viewerIndex.value = Math.max(
    0,
    all.findIndex((node) => node === target || getLightboxSrc(node) === targetSrc)
  );
  updateViewerMeta(all[viewerIndex.value]);
  viewerVisible.value = viewerUrls.value.length > 0;
};

const handleImageClick = (event: Event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const mermaidButton = target.closest(".mermaid-zoom-button") as HTMLElement | null;
  if (mermaidButton) {
    const graph = mermaidButton.closest(".mermaid-svg") as HTMLElement | null;
    if (graph) openMermaidViewer(graph);
    return;
  }

  const trigger =
    (target.closest(".message-inline-image-host") as HTMLElement | null) ||
    (target.closest("[data-lightbox-group]") as HTMLElement | null);
  if (!trigger) return;
  if (!getLightboxSrc(trigger)) return;
  openImageViewer(trigger);
};

const upgradeImagesToElImage = () => {
  if (!contentRef.value) return;

  const rawImages = Array.from(
    contentRef.value.querySelectorAll(
      "img.message-inline-image[data-lightbox-group], img.da-img-thumb[data-lightbox-group]"
    )
  ) as HTMLImageElement[];

  for (const img of rawImages) {
    if (img.dataset.upgraded === "true") continue;
    if (img.closest(".message-inline-image-host")) continue;

    const wrapper = document.createElement("span");
    const isTableThumb = img.classList.contains("da-img-thumb");
    wrapper.className = isTableThumb
      ? "message-inline-image-host table-thumb-host"
      : "message-inline-image-host";
    wrapper.setAttribute(
      "data-lightbox-group",
      img.getAttribute("data-lightbox-group") || "message-content"
    );
    wrapper.setAttribute("data-caption", img.getAttribute("data-caption") || "");
    wrapper.setAttribute("data-src", img.getAttribute("src") || "");
    wrapper.dataset.state = "loading";

    const placeholder = document.createElement("span");
    placeholder.className = "image-state-placeholder image-state-loading";
    placeholder.innerHTML = '<span class="image-state-spinner"></span>';

    const error = document.createElement("span");
    error.className = "image-state-placeholder image-state-error";
    error.textContent = t("chat.imageLoadFailed");
    error.hidden = true;

    img.classList.add("message-inline-image-upgraded");
    if (isTableThumb) img.classList.add("table-thumb-image");
    img.dataset.upgraded = "true";
    img.loading = "lazy";

    const markLoaded = () => {
      wrapper.dataset.state = "loaded";
      placeholder.hidden = true;
      error.hidden = true;
    };

    const markError = () => {
      wrapper.dataset.state = "error";
      placeholder.hidden = true;
      error.hidden = false;
    };

    img.addEventListener("load", markLoaded, { once: true });
    img.addEventListener("error", markError, { once: true });

    wrapper.appendChild(placeholder);
    wrapper.appendChild(error);
    img.replaceWith(wrapper);
    wrapper.appendChild(img);

    if (img.complete) {
      if (img.naturalWidth > 0) {
        markLoaded();
      } else {
        setTimeout(() => {
          if (wrapper.dataset.state === "loading" && img.complete && img.naturalWidth === 0) {
            markError();
          }
        }, 1500);
      }
    }
  }
};

const scheduleImageUpgrade = () => {
  if (imageUpgradeTimer) clearTimeout(imageUpgradeTimer);
  imageUpgradeTimer = setTimeout(() => {
    imageUpgradeTimer = null;
    upgradeImagesToElImage();
  }, 0);
};

const connectImageObserver = () => {
  imageObserver?.disconnect();
  if (!contentRef.value) return;

  imageObserver = new MutationObserver(() => {
    scheduleImageUpgrade();
  });
  imageObserver.observe(contentRef.value, { childList: true, subtree: true });
};

onMounted(() => {
  connectImageObserver();
});

onBeforeUnmount(() => {
  imageObserver?.disconnect();
  mermaidResizeObserver?.disconnect();
  mermaidViewerResizeObserver?.disconnect();
  stopCaptionAnimation();
  if (imageUpgradeTimer) clearTimeout(imageUpgradeTimer);
});

watch(viewerIndex, () => {
  if (!viewerVisible.value || !contentRef.value) return;
  const all = Array.from(
    contentRef.value.querySelectorAll(
      '[data-lightbox-group="message-content"][data-src], [data-lightbox-group^="row-"][data-src]'
    )
  ) as HTMLElement[];
  const currentUrl = viewerUrls.value[viewerIndex.value];
  const currentNode = all.find((node) => node.getAttribute("data-src") === currentUrl);
  updateViewerMeta(currentNode);
});

watch(viewerVisible, (visible) => {
  if (!visible) {
    stopCaptionAnimation();
    viewerCaption.value = "";
    displayedCaption.value = "";
    viewerCounter.value = "";
  }
});

watch(
  () => props.content,
  () => {
    nextTick(async () => {
      await renderMermaid();
      await initializeTableAdjustment();
      scheduleImageUpgrade();
    });
  },
  { immediate: true }
);

watch(isDark, () => {
  renderKey.value++;
  nextTick(async () => {
    connectImageObserver();
    await renderMermaid();
    upgradeImagesToElImage();
  });
});
</script>

<template>
  <div>
    <div ref="contentRef" :key="renderKey" class="message-content" @click="handleImageClick">
      <template v-for="(part, index) in contentParts" :key="index">
        <div
          v-if="part.type === 'text'"
          class="markdown-content"
          v-html="renderMarkdown(part.content)"
        ></div>

        <div v-else-if="part.type === 'visualization' && part.visualization" class="chart-section">
          <div class="chart-container">
            <div class="chart-header">
              <span class="chart-title">📊 {{ t("chat.visualizationResult") }}</span>
            </div>
            <div class="chart-wrapper">
              <div v-if="part.visualization.meta?.loading" class="visualization-loading">
                <div class="loading-spinner"></div>
                <span>{{ t("chat.visualizing") }}</span>
              </div>
              <iframe
                v-else
                :srcdoc="withSkillResourceCredentials(part.visualization.html)"
                class="visualization-iframe"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        </div>

        <div v-else-if="part.type === 'chart' && part.chart" class="chart-section">
          <div class="no-chart-message">
            <p>{{ t("chart.legacyJsonFormatWarning") }}</p>
          </div>
        </div>

        <SubgraphView
          v-else-if="part.type === 'subgraph' && part.subgraph"
          :sub-query="part.subgraph"
        />

        <div v-else-if="part.type === 'table' && part.table" class="table-section">
          <div class="markdown-content" v-html="renderMarkdown(part.content)"></div>
          <ResultDatasetActions
            v-if="resolvedDatasetFor(part.table)"
            :dataset="resolvedDatasetFor(part.table)!"
            :show-dashboard-action="props.showDashboardAction !== false"
            @add-to-dashboard="onAddToDashboard(resolvedDatasetFor(part.table)!)"
          />
        </div>
      </template>
    </div>

    <div v-if="unattachedDatasets.length > 0" class="unattached-results">
      <ResultDatasetActions
        v-for="dataset in unattachedDatasets"
        :key="dataset.id"
        :dataset="dataset"
        :show-dashboard-action="props.showDashboardAction !== false"
        @add-to-dashboard="onAddToDashboard(dataset)"
      />
    </div>

    <el-image-viewer
      v-if="viewerVisible"
      :url-list="viewerUrls"
      :initial-index="viewerIndex"
      @switch="(index: number) => (viewerIndex = index)"
      @close="viewerVisible = false"
    />
    <div v-if="viewerVisible && displayedCaption" class="lightbox-caption">
      {{ displayedCaption }}
    </div>

    <el-dialog
      v-model="mermaidViewerVisible"
      :title="t('thinking.subgraph')"
      width="min(1120px, 92vw)"
      class="mermaid-viewer-dialog"
      append-to-body
    >
      <div
        ref="mermaidViewerContentRef"
        class="mermaid-viewer-content"
        v-html="mermaidViewerSvg"
      ></div>
    </el-dialog>
  </div>
</template>

<style scoped>
.message-content {
  font-size: 14px;
  line-height: 1.8;
}

.message-content :deep(.message-inline-image) {
  display: none;
}

.message-content :deep(.message-inline-image-host) {
  display: inline-flex;
  flex: 0 0 100px;
  align-items: center;
  justify-content: center;
  position: relative;
  box-sizing: border-box;
  width: 100px;
  height: 100px;
  min-width: 100px;
  max-width: 100px;
  min-height: 100px;
  max-height: 100px;
  aspect-ratio: 1 / 1;
  vertical-align: middle;
  margin-right: 6px;
  cursor: zoom-in;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.message-content :deep(.table-thumb-host) {
  width: 100px;
  height: 100px;
  margin: 2px 6px 2px 0;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.message-content :deep(.da-img-thumb) {
  display: inline-block;
  box-sizing: border-box;
  width: 100px;
  height: 100px;
  min-width: 100px;
  max-width: 100px;
  min-height: 100px;
  max-height: 100px;
  margin: 2px 6px 2px 0;
  vertical-align: middle;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  object-fit: cover;
  object-position: center;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.message-content :deep(.message-inline-image-upgraded) {
  width: 100%;
  height: 100%;
  min-width: 100%;
  max-width: 100%;
  min-height: 100%;
  max-height: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  object-position: center;
  display: none;
}

.message-content :deep(.message-inline-image-host .message-inline-image-upgraded) {
  margin: 0;
  border: 0;
  border-radius: inherit;
  box-shadow: none;
}

.message-content :deep(.table-thumb-image) {
  width: 100%;
  height: 100%;
}

.message-content :deep(.da-pdf-thumb-link) {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100px;
  height: 100px;
  margin: 2px 6px 2px 0;
  vertical-align: middle;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(180deg, var(--el-bg-color) 0%, var(--el-fill-color-light) 100%);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  text-decoration: none;
  position: relative;
}

.message-content :deep(.da-pdf-thumb-link::after) {
  content: "PDF";
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--el-text-color-secondary);
  line-height: 1;
}

.message-content :deep(.da-pdf-thumb) {
  width: 36px;
  height: 36px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e74c3c' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'%3E%3C/path%3E%3Cpolyline points='14 2 14 8 20 8'%3E%3C/polyline%3E%3Cline x1='8' y1='13' x2='16' y2='13'%3E%3C/line%3E%3Cline x1='8' y1='17' x2='16' y2='17'%3E%3C/line%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.message-content :deep(.image-state-placeholder) {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.message-content :deep(.image-state-loading) {
  display: flex;
}

.message-content :deep(.image-state-spinner) {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid var(--el-border-color);
  border-top-color: var(--el-color-primary);
  animation: spin 0.8s linear infinite;
}

.message-content :deep(.image-state-error) {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  text-align: center;
  padding: 8px;
}

.message-content
  :deep(.message-inline-image-host[data-state="loaded"] .message-inline-image-upgraded) {
  display: block;
}

.message-content :deep(.message-inline-image-host[data-state="loaded"] .image-state-placeholder) {
  display: none;
}

.message-content :deep(.message-inline-image-host[data-state="error"] .image-state-loading) {
  display: none;
}

.message-content :deep(.message-inline-image-host[data-state="error"] .image-state-error) {
  display: flex;
}

.lightbox-caption {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  max-width: 80vw;
  font-size: 16px;
  line-height: 1.6;
  color: #fff;
  z-index: 999999;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.35);
  white-space: pre-wrap;
  font-family: var(--font-sans);
  background: rgba(0, 0, 0, 0.5);
  padding: 10px 14px;
  border-radius: 10px;
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.message-content :deep(td:has(.table-thumb-host, .da-pdf-thumb-link)) {
  padding-top: 6px;
  padding-bottom: 6px;
}

.message-content :deep(.table-thumb-host:hover),
.message-content :deep(.da-pdf-thumb-link:hover) {
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
}

.message-content :deep(.table-thumb-host:hover) {
  border-color: var(--el-color-primary-light-5);
}

.message-content :deep(.da-pdf-thumb-link:hover) {
  border-color: var(--el-color-danger-light-5);
}

.message-content :deep(.mermaid-zoom-host) {
  position: relative;
  box-sizing: border-box;
  min-height: 120px;
  padding: 8px 8px 34px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.message-content :deep(.mermaid-zoom-host > svg) {
  display: block;
  width: auto;
  min-width: 0;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.message-content :deep(.mermaid-zoom-button) {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 5px;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color-overlay);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease;
}

.message-content :deep(.mermaid-zoom-button:hover) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
}

.mermaid-viewer-content {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.mermaid-viewer-content :deep(svg) {
  width: auto;
  min-width: 0;
  max-width: 100%;
  height: auto;
  max-height: 72vh;
}

@media (max-width: 768px) {
  .lightbox-caption {
    max-width: calc(100vw - 32px);
    bottom: 80px;
    font-size: 16px;
    line-height: 1.6;
  }
}

.chart-section {
  margin: 16px 0;
}

.table-section {
  margin: 16px 0;
}

.unattached-results {
  margin-top: 12px;
}

.chart-container {
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color);
}

.chart-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.chart-toggle {
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 13px;
}

.chart-toggle:hover {
  text-decoration: underline;
}

.chart-type {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 2px 8px;
  border-radius: 4px;
}

.chart-wrapper {
  padding: 10px;
  background: var(--el-fill-color-lighter);
}

.visualization-iframe {
  width: 100%;
  height: 400px;
  border: none;
  border-radius: 4px;
}

.visualization-loading {
  width: 100%;
  height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--el-border-color-lighter);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.no-chart-message {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 20px 0 10px 0;
  color: var(--el-text-color-primary);
}

.markdown-content :deep(h1) {
  font-size: 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 6px;
}

.markdown-content :deep(h2) {
  font-size: 18px;
}

.markdown-content :deep(h3) {
  font-size: 16px;
}

.markdown-content :deep(h4) {
  font-size: 15px;
}

.markdown-content :deep(p) {
  margin: 8px 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(.table-scroll-wrapper) {
  width: 100%;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
}

.markdown-content :deep(.data-result-table-wrapper) {
  width: 100%;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-content :deep(.data-result-table-wrapper > table) {
  margin: 0;
  width: max-content;
  min-width: 100%;
}

.markdown-content :deep(table thead) {
  display: table-header-group;
}

.markdown-content :deep(table tbody) {
  display: table-row-group;
}

.markdown-content :deep(table th),
.markdown-content :deep(table td) {
  border: none;
  border-bottom: 1px solid var(--el-border-color-light);
  padding: 8px 12px;
  text-align: left;
  white-space: normal;
  max-width: none;
  overflow: visible;
  overflow-wrap: anywhere;
  word-break: break-word;
  vertical-align: middle;
}

.markdown-content :deep(table.table-fixed) {
  table-layout: fixed;
  display: table;
  overflow-x: visible;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: none;
  border-bottom: 1px solid var(--el-border-color);
  padding: 8px 12px;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  vertical-align: middle;
}

.markdown-content :deep(th.cell-wrap),
.markdown-content :deep(td.cell-wrap) {
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.markdown-content :deep(th) {
  background: var(--el-fill-color);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.markdown-content :deep(code) {
  background: var(--el-fill-color-lighter);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.markdown-content :deep(pre) {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
  border: 1px solid var(--el-border-color);
}

.markdown-content :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--el-color-primary);
  margin: 12px 0;
  padding: 8px 16px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

.markdown-content :deep(details[data-ai-table-details]) {
  margin: 0;
  border: none;
  border-radius: 0;
}

.markdown-content :deep(details[data-ai-table-details] summary) {
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  font-weight: 500;
  color: var(--el-color-primary);
  user-select: none;
  transition: background 0.2s;
  border: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details[data-ai-table-details][open] summary) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details[data-ai-table-details] table) {
  margin: 0;
  border-top: none;
  border-radius: 0;
  width: 100%;
  min-width: max-content;
}

/* Expand/collapse button styles (arrow) */
.markdown-content :deep(.ai-table-more-toggle) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  color: var(--el-color-primary);
  font-weight: 500;
  font-size: 13px;
  transition: background 0.2s;
}

.markdown-content :deep(.ai-table-more-toggle:hover) {
  background: var(--el-fill-color);
}

/* Arrow (points right by default) */
.markdown-content :deep(.ai-table-more-toggle::before) {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid var(--el-color-primary);
  margin-right: 4px;
  transition: transform 0.15s ease;
}

/* Expanded state: arrow points up (collapse button) */
.markdown-content :deep(.ai-table-more-toggle[data-ai-state="expanded"]::before) {
  transform: rotate(-90deg);
}

/* Only hide the "table details" marker */
.markdown-content :deep(details[data-ai-table-details="1"] > summary.ai-table-more-toggle::marker) {
  content: "";
}

.markdown-content :deep(details) {
  margin: 12px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}

.markdown-content :deep(summary) {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  font-weight: 500;
  color: var(--el-color-primary);
  user-select: none;
  transition: background 0.2s;
}

.markdown-content :deep(summary:hover) {
  background: var(--el-fill-color);
}

.markdown-content :deep(details[open] summary) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details > *:not(summary)) {
  padding: 0;
}

.markdown-content :deep(details table) {
  margin: 0;
  border: none;
  border-radius: 0;
  width: 100%;
  min-width: 100%;
}

.markdown-content :deep(details table:first-of-type) {
  border-top: none;
}

.markdown-content :deep(details[data-ai-table-details] summary) {
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  font-weight: 500;
  color: var(--el-color-primary);
  user-select: none;
  transition: background 0.2s;
  border: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details[data-ai-table-details][open] summary) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details[data-ai-table-details] table) {
  margin: 0;
  border-top: none;
  border-radius: 0;
  width: 100%;
  min-width: max-content;
}

.markdown-content :deep(details[data-ai-table-details] table thead) {
  display: none;
}

.markdown-content :deep(details) {
  margin: 12px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}

.markdown-content :deep(summary) {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  font-weight: 500;
  color: var(--el-color-primary);
  user-select: none;
  transition: background 0.2s;
}

.markdown-content :deep(summary:hover) {
  background: var(--el-fill-color);
}

.markdown-content :deep(details[open] summary) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.markdown-content :deep(details > *:not(summary)) {
  padding: 0;
}

.markdown-content :deep(details table) {
  margin: 0;
  border: none;
  border-radius: 0;
  width: 100%;
  min-width: 100%;
}

.markdown-content :deep(details table:first-of-type) {
  border-top: none;
}

@media (max-width: 767px) {
  .chart-section,
  .table-section {
    margin: 12px 0;
  }

  .chart-container {
    margin-bottom: 10px;
    border-radius: 6px;
  }

  .chart-header {
    padding: 6px 10px;
  }

  .chart-title {
    font-size: 13px;
  }

  .chart-type {
    font-size: 11px;
    padding: 2px 6px;
  }

  .chart-toggle {
    font-size: 12px;
  }

  .chart-wrapper {
    padding: 10px;
  }

  .visualization-iframe {
    height: 300px;
  }

  .no-chart-message {
    padding: 10px;
    font-size: 13px;
  }

  .markdown-content :deep(h1) {
    font-size: 18px;
    margin: 10px 0 6px;
  }

  .markdown-content :deep(h2) {
    font-size: 16px;
    margin: 8px 0 6px;
  }

  .markdown-content :deep(h3) {
    font-size: 15px;
    margin: 6px 0 4px;
  }

  .markdown-content :deep(p) {
    margin: 6px 0;
    font-size: 14px;
  }

  .markdown-content :deep(table) {
    font-size: 12px;
  }

  .markdown-content :deep(th),
  .markdown-content :deep(td) {
    padding: 6px 8px;
    font-size: 12px;
  }

  .markdown-content :deep(code) {
    font-size: 12px;
  }

  .markdown-content :deep(pre) {
    padding: 10px;
    font-size: 12px;
    border-radius: 4px;
  }

  .markdown-content :deep(blockquote) {
    padding: 6px 12px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .visualization-iframe {
    height: 250px;
  }

  .chart-wrapper {
    padding: 8px;
  }

  .chart-header {
    padding: 5px 8px;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chart-title {
    font-size: 12px;
    width: 100%;
  }

  .chart-type {
    font-size: 10px;
  }

  .chart-toggle {
    font-size: 11px;
  }

  .no-chart-message {
    font-size: 12px;
  }
}
</style>
