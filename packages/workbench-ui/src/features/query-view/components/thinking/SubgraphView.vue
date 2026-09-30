<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Graph } from "@antv/g6";
import { Network, Table2, ZoomIn } from "lucide-vue-next";
import { tryParseSubgraph } from "../../utils/thinkingUtils";
import type { SubgraphNodeItem } from "../../utils/thinkingUtils";
import { queryViewApi } from "../../api";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const listItems = workbenchContent().subgraphListItems;

const { t } = useI18n();

const props = defineProps<{
  subQuery: unknown;
}>();

const nodes = ref<SubgraphNodeItem[]>([]);
const containerRef = ref<HTMLElement | null>(null);
const graphRef = ref<HTMLElement | null>(null);
const viewerGraphRef = ref<HTMLElement | null>(null);
const classMetasMap = ref<Map<string, string>>(new Map());
const relationMetasMap = ref<Map<string, string>>(new Map());
const expandedNodeIds = ref<Set<string>>(new Set());
const viewerVisible = ref(false);
const viewMode = ref<"graph" | "table">("graph");
let metasFetched = false;
let graph: Graph | null = null;
let viewerGraph: Graph | null = null;
let themeObserver: MutationObserver | null = null;

const parsed = computed(() => tryParseSubgraph(props.subQuery));

type G6SubgraphNode = {
  id: string;
  label: string;
  data: {
    filters: string[];
    selects: string[];
    expanded: boolean;
  };
};

type G6SubgraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

async function fetchClassMetas() {
  if (metasFetched) return;
  metasFetched = true;
  try {
    const json = await queryViewApi.getMetas();
    const metas = json?.data || json;
    const classMap = new Map<string, string>();
    const relationMap = new Map<string, string>();
    const classDef = Array.isArray(metas?.classDef) ? metas.classDef : [];
    const relationshipRule = metas?.relationship_rule || {};
    for (const cls of classDef) {
      if (cls.className && cls.showName) {
        classMap.set(cls.className.trim(), cls.showName.trim());
      }
    }
    if (relationshipRule && typeof relationshipRule === "object") {
      for (const [key, rel] of Object.entries(relationshipRule) as [string, any][]) {
        if (rel.desc) {
          const desc = String(rel.desc).trim();
          relationMap.set(key.trim(), desc);
          if (rel.fromclass && rel.toclass) {
            relationMap.set(`${String(rel.fromclass).trim()}->${String(rel.toclass).trim()}`, desc);
          }
        }
      }
    }
    classMetasMap.value = classMap;
    relationMetasMap.value = relationMap;
    update();
  } catch {
    // Keep the original class name when fetching fails
  }
}

function update() {
  if (!parsed.value) {
    nodes.value = [];
    destroyGraph();
    return;
  }
  nodes.value = parsed.value.nodes || [];
  if (viewMode.value === "graph") renderGraph();
}

async function toggleViewMode() {
  viewMode.value = viewMode.value === "graph" ? "table" : "graph";
  if (viewMode.value === "table") {
    destroyGraph();
    return;
  }
  await nextTick();
  renderGraph();
}

function norm(s: unknown): string {
  return String(s || "").trim();
}

function displayName(className: unknown, map?: Map<string, string>): string {
  const raw = norm(className);
  if (!map) return raw;
  return map.get(raw) || raw;
}

function relationLabel(item: { source: unknown; relation: unknown; target: unknown }): string {
  const relation = norm(item.relation);
  return (
    relationMetasMap.value.get(relation) ||
    relationMetasMap.value.get(`${norm(item.source)}->${norm(item.target)}`) ||
    relation ||
    t("thinking.relation")
  );
}

function tableRows() {
  const items = Array.isArray(parsed.value?.nodes) ? parsed.value.nodes : [];
  const detailsMap = buildNodeDetailsMap(items);
  return items.map((item) => {
    const rawName = norm(item.node);
    const details = detailsMap.get(rawName);
    return {
      name: displayName(rawName, classMetasMap.value) || t("thinking.unknown"),
      filters: details?.filters || [],
      selects: details?.selects || [],
    };
  });
}

function tableRelations() {
  const path = Array.isArray(parsed.value?.path) ? parsed.value.path : [];
  return path.map((item) => ({
    source: displayName(item.source, classMetasMap.value) || t("thinking.unknown"),
    relation: relationLabel(item),
    target: displayName(item.target, classMetasMap.value) || t("thinking.unknown"),
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitDetailItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitDetailItems(item));
  }
  const text = norm(value);
  if (!text) return [];
  return text
    .split(listItems.split)
    .map((item) => item.trim())
    .filter((item) => item && !listItems.empty.test(item));
}

function stableNodeIdFactory() {
  const map = new Map<string, string>();
  let idx = 0;
  return (label: string): string => {
    const key = label.trim();
    const existed = map.get(key);
    if (existed) return existed;
    const id = `N${idx++}`;
    map.set(key, id);
    return id;
  };
}

function buildNodeDetailsMap(items: SubgraphNodeItem[]) {
  const details = new Map<string, { filters: string[]; selects: string[] }>();
  for (const item of items) {
    const key = norm(item.node);
    if (!key || details.has(key)) continue;
    const filters = splitDetailItems(item.filters);
    const selects = splitDetailItems(item.select);
    if (filters.length || selects.length) details.set(key, { filters, selects });
  }
  return details;
}

function buildGraphData() {
  const sg = parsed.value;
  const path = Array.isArray(sg?.path) ? sg.path : [];
  const nodeItems = Array.isArray(sg?.nodes) ? sg.nodes : [];
  const getId = stableNodeIdFactory();
  const detailsMap = buildNodeDetailsMap(nodeItems);
  const graphNodes = new Map<string, G6SubgraphNode>();
  const edges: G6SubgraphEdge[] = [];

  const ensureNode = (rawName: unknown, fallback: string) => {
    const key = norm(rawName) || fallback;
    const id = getId(key);
    if (!graphNodes.has(id)) {
      const detail = detailsMap.get(key);
      graphNodes.set(id, {
        id,
        label: displayName(key, classMetasMap.value) || t("thinking.unknown"),
        data: {
          filters: detail?.filters || [],
          selects: detail?.selects || [],
          expanded: expandedNodeIds.value.has(id),
        },
      });
    }
    return id;
  };

  if (path.length) {
    for (const item of path) {
      const source = ensureNode(item.source, t("thinking.unknown"));
      const target = ensureNode(item.target, t("thinking.unknown"));
      edges.push({
        id: `e_${edges.length}`,
        source,
        target,
        label: relationLabel(item),
      });
    }
  }

  for (const item of nodeItems) {
    ensureNode(item.node, t("thinking.unknown"));
  }

  return { nodes: Array.from(graphNodes.values()), edges };
}

function nodeHtml(node: G6SubgraphNode) {
  const filters = node.data.filters;
  const selects = node.data.selects;
  const hasDetails = filters.length > 0 || selects.length > 0;
  const renderSwatches = (items: string[], type: "filter" | "select") =>
    items
      .map(
        (_, index) =>
          `<span class="subgraph-node__swatch subgraph-node__swatch--${type}" aria-hidden="true" title="${escapeHtml(type === "filter" ? t("thinking.filterCondition") : t("thinking.extractField"))} ${index + 1}"></span>`
      )
      .join("");
  const renderDetails = (items: string[], label: string, type: "filter" | "select") => {
    if (!items.length) return "";
    return `<div class="subgraph-node__detail-group"><div class="subgraph-node__detail-title"><span class="subgraph-node__swatch subgraph-node__swatch--${type}" aria-hidden="true"></span>${escapeHtml(label)} (${items.length})</div>${items.map((item) => `<div class="subgraph-node__detail-item"><span class="subgraph-node__detail-bullet" aria-hidden="true"></span><span class="subgraph-node__detail-text">${escapeHtml(item)}</span></div>`).join("")}</div>`;
  };
  const detailsHtml = [
    renderDetails(filters, t("thinking.filterCondition"), "filter"),
    renderDetails(selects, t("thinking.extractField"), "select"),
  ].join("");
  const indicatorRows = [
    filters.length
      ? `<div class="subgraph-node__indicator-row" title="${escapeHtml(t("thinking.filterCondition"))}: ${filters.length}"><div class="subgraph-node__swatches">${renderSwatches(filters, "filter")}</div></div>`
      : "",
    selects.length
      ? `<div class="subgraph-node__indicator-row" title="${escapeHtml(t("thinking.extractField"))}: ${selects.length}"><div class="subgraph-node__swatches">${renderSwatches(selects, "select")}</div></div>`
      : "",
  ].join("");
  return `
    <div class="subgraph-node ${node.data.expanded ? "is-expanded" : ""}">
      <div class="subgraph-node__title">${escapeHtml(node.label)}</div>
      ${
        hasDetails
          ? `<div class="subgraph-node__indicators">${indicatorRows}<span class="subgraph-node__arrow">${node.data.expanded ? "⌃" : "⌄"}</span></div>`
          : ""
      }
      ${hasDetails && node.data.expanded ? `<div class="subgraph-node__details">${detailsHtml}</div>` : ""}
    </div>
  `;
}

function getNodeSize(node: G6SubgraphNode): [number, number] {
  const detailsCount = node.data.filters.length + node.data.selects.length;
  if (!detailsCount) return [220, 58];
  if (!node.data.expanded) {
    const indicatorRows =
      Number(node.data.filters.length > 0) + Number(node.data.selects.length > 0);
    return [220, indicatorRows === 1 ? 78 : 96];
  }
  return [220, Math.min(220, 112 + detailsCount * 22)];
}

function destroyGraph(target: "main" | "viewer" = "main") {
  const instance = target === "main" ? graph : viewerGraph;
  if (!instance) return;
  instance.destroy();
  if (target === "main") graph = null;
  else viewerGraph = null;
}

async function fitGraphToContainer(currentGraph: Graph) {
  await currentGraph.fitView({ when: "always", direction: "both" });
  if (currentGraph.getZoom() > 1) {
    await currentGraph.zoomTo(1, false);
  }
  await currentGraph.fitCenter(false);
}

async function renderGraph(target: "main" | "viewer" = "main") {
  const elRef = target === "main" ? graphRef : viewerGraphRef;
  if (!elRef.value || !parsed.value) return;
  await nextTick();
  const el = elRef.value;
  if (!el) return;

  destroyGraph(target);

  const data = buildGraphData();
  if (!data.nodes.length) return;

  const expanded = data.nodes.some((node) => node.data.expanded);
  const height = target === "viewer" ? (expanded ? 620 : 560) : expanded ? 320 : 240;
  const theme = getComputedStyle(document.documentElement);
  const primary = theme.getPropertyValue("--el-color-primary").trim();
  const regularText = theme.getPropertyValue("--el-text-color-regular").trim();
  const overlay = theme.getPropertyValue("--el-bg-color-overlay").trim();
  const currentGraph = new Graph({
    container: el,
    width: el.clientWidth || 640,
    height,
    padding: 24,
    layout: { type: "antv-dagre", rankdir: "LR", ranksep: 72, nodesep: 44 },
    animation: false,
    data,
    node: {
      type: "html",
      style: {
        size: (d: any) => getNodeSize(d as G6SubgraphNode),
        dx: (d: any) => (d.data?.expanded ? -110 : -100),
        dy: (d: any) => {
          const size = getNodeSize(d as G6SubgraphNode);
          return -size[1] / 2;
        },
        innerHTML: (d: any) => nodeHtml(d as G6SubgraphNode),
        cursor: "pointer",
      },
    },
    edge: {
      style: {
        stroke: primary,
        lineWidth: 2,
        endArrow: true,
        labelText: (d: any) => d.label,
        labelFill: regularText,
        labelFontSize: 13,
        labelFontWeight: 600,
        labelBackground: true,
        labelBackgroundFill: overlay,
        labelBackgroundRadius: 4,
        labelBackgroundPadding: [4, 8],
      },
    },
    behaviors: ["drag-canvas", "drag-element"],
  });

  currentGraph.on("node:click", (event: any) => {
    const id = event?.target?.id;
    const model = id ? (currentGraph.getNodeData(id) as G6SubgraphNode | undefined) : undefined;
    if (!model || model.data.filters.length + model.data.selects.length === 0) return;

    const next = new Set(expandedNodeIds.value);
    if (next.has(model.id)) next.delete(model.id);
    else next.add(model.id);
    expandedNodeIds.value = next;
    renderGraph("main");
    if (viewerVisible.value) renderGraph("viewer");
  });

  if (target === "main") graph = currentGraph;
  else viewerGraph = currentGraph;

  await currentGraph.render();
  await fitGraphToContainer(currentGraph);
}

function refitGraph(target: "main" | "viewer" = "main") {
  const currentGraph = target === "main" ? graph : viewerGraph;
  const el = target === "main" ? graphRef.value : viewerGraphRef.value;
  if (!currentGraph || !el) return;
  fitGraphToContainer(currentGraph);
}

function resizeGraph() {
  if (graph && graphRef.value) {
    graph.resize(graphRef.value.clientWidth || 640, graphRef.value.clientHeight || 240);
    refitGraph("main");
  }
  if (viewerGraph && viewerGraphRef.value) {
    viewerGraph.resize(
      viewerGraphRef.value.clientWidth || 960,
      viewerGraphRef.value.clientHeight || 560
    );
    refitGraph("viewer");
  }
}

async function openViewer() {
  viewerVisible.value = true;
  await nextTick();
  renderGraph("viewer");
}

update();
watch(
  () => props.subQuery,
  () => {
    expandedNodeIds.value = new Set();
    update();
  }
);

onMounted(() => {
  fetchClassMetas();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderGraph();
    });
  });
  window.addEventListener("resize", resizeGraph);
  themeObserver = new MutationObserver(() => {
    if (viewMode.value === "graph") renderGraph();
    if (viewerVisible.value) renderGraph("viewer");
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeGraph);
  themeObserver?.disconnect();
  destroyGraph();
  destroyGraph("viewer");
});
</script>

<template>
  <div v-if="parsed" ref="containerRef" class="subgraph-block">
    <div class="subgraph-g6-wrap">
      <div v-if="viewMode === 'graph'" ref="graphRef" class="subgraph-g6" />
      <div v-else class="subgraph-table-wrap">
        <table class="subgraph-table">
          <thead>
            <tr>
              <th>{{ t("thinking.objectClass") }}</th>
              <th>{{ t("thinking.filterCondition") }}</th>
              <th>{{ t("thinking.extractField") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows()" :key="row.name">
              <td class="subgraph-table__class">{{ row.name }}</td>
              <td>{{ row.filters.join(listItems.join) || "—" }}</td>
              <td>{{ row.selects.join(listItems.join) || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <table v-if="tableRelations().length" class="subgraph-table subgraph-table--relations">
          <thead>
            <tr>
              <th>{{ t("thinking.objectClass") }}</th>
              <th>{{ t("thinking.relation") }}</th>
              <th>{{ t("thinking.objectClass") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(relation, index) in tableRelations()"
              :key="`${relation.source}-${relation.target}-${index}`"
            >
              <td class="subgraph-table__class">{{ relation.source }}</td>
              <td class="subgraph-table__relation">{{ relation.relation }}</td>
              <td class="subgraph-table__class">{{ relation.target }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="viewMode === 'graph'" class="subgraph-legend" aria-label="subgraph legend">
        <div class="subgraph-legend__item">
          <span class="subgraph-legend__swatch subgraph-legend__swatch--filter" />
          <span>{{ t("thinking.filterCondition") }}</span>
        </div>
        <div class="subgraph-legend__item">
          <span class="subgraph-legend__swatch subgraph-legend__swatch--select" />
          <span>{{ t("thinking.extractField") }}</span>
        </div>
      </div>
      <button
        :class="['subgraph-mode-btn', { 'subgraph-mode-btn--table': viewMode === 'table' }]"
        type="button"
        :title="viewMode === 'graph' ? t('thinking.tableMode') : t('thinking.graphMode')"
        @click.stop="toggleViewMode"
      >
        <Table2 v-if="viewMode === 'graph'" :size="16" :stroke-width="2" />
        <Network v-else :size="16" :stroke-width="2" />
      </button>
      <button
        v-if="viewMode === 'graph'"
        class="subgraph-zoom-btn"
        type="button"
        :title="t('dashboard.zoomIn')"
        @click.stop="openViewer"
      >
        <ZoomIn :size="16" :stroke-width="2" />
      </button>
    </div>

    <el-dialog
      v-model="viewerVisible"
      :title="t('thinking.subgraph')"
      width="min(1120px, 92vw)"
      append-to-body
      class="subgraph-viewer-dialog"
      @closed="destroyGraph('viewer')"
    >
      <div ref="viewerGraphRef" class="subgraph-g6 subgraph-g6--viewer" />
      <div class="subgraph-legend subgraph-legend--viewer" aria-label="subgraph legend">
        <div class="subgraph-legend__item">
          <span class="subgraph-legend__swatch subgraph-legend__swatch--filter" />
          <span>{{ t("thinking.filterCondition") }}</span>
        </div>
        <div class="subgraph-legend__item">
          <span class="subgraph-legend__swatch subgraph-legend__swatch--select" />
          <span>{{ t("thinking.extractField") }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.subgraph-block {
  margin-top: 14px;
}
.block-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subgraph-g6-wrap {
  position: relative;
}
.subgraph-table-wrap {
  min-height: 240px;
  margin: 8px 0;
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.subgraph-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  font-size: 13px;
  line-height: 1.45;
}
.subgraph-table th,
.subgraph-table td {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color);
  text-align: left;
  vertical-align: top;
}
.subgraph-table th {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
  font-weight: 700;
  white-space: nowrap;
}
.subgraph-table__class,
.subgraph-table__relation {
  color: var(--el-color-primary);
  font-weight: 600;
}
.subgraph-table--relations {
  margin-top: 16px;
}
.subgraph-g6 {
  width: 100%;
  min-height: 240px;
  margin: 8px 0;
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  border: 1px solid var(--el-border-color);
  overflow: hidden;
}
.subgraph-mode-btn {
  position: absolute;
  right: 52px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--el-border-color-dark);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-shadow-sm);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
}
.subgraph-mode-btn:hover {
  transform: translateY(-1px);
  background: var(--el-fill-color);
  box-shadow: var(--el-shadow);
}
.subgraph-mode-btn--table {
  right: 12px;
}
.subgraph-g6 :deep(.subgraph-node) {
  width: 200px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-dark);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-shadow-sm);
  cursor: pointer;
  overflow: hidden;
}
.subgraph-g6 :deep(.subgraph-node.is-expanded) {
  border-color: var(--el-color-primary);
  box-shadow: var(--shadow-primary);
}
.subgraph-g6 :deep(.subgraph-node__title) {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color);
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
  word-break: break-word;
  background: var(--el-fill-color);
}
.subgraph-g6 :deep(.subgraph-node__indicators) {
  position: relative;
  display: grid;
  gap: 6px;
  padding: 8px 28px 8px 12px;
  background: var(--el-bg-color);
}
.subgraph-g6 :deep(.subgraph-node__indicator-row) {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  min-height: 14px;
}
.subgraph-g6 :deep(.subgraph-node__swatches) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
  max-width: 156px;
}
.subgraph-g6 :deep(.subgraph-node__swatch),
.subgraph-legend__swatch {
  display: inline-block;
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45);
}
.subgraph-g6 :deep(.subgraph-node__swatch--filter),
.subgraph-legend__swatch--filter {
  background: var(--el-color-primary);
}
.subgraph-g6 :deep(.subgraph-node__swatch--select),
.subgraph-legend__swatch--select {
  background: var(--el-color-success);
}
.subgraph-g6 :deep(.subgraph-node__arrow) {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  color: var(--el-color-primary);
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
}
.subgraph-g6 :deep(.subgraph-node__details) {
  margin: 0 12px 12px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color);
  font-size: 12px;
  line-height: 1.55;
  word-break: break-word;
}
.subgraph-g6 :deep(.subgraph-node__detail-group + .subgraph-node__detail-group) {
  margin-top: 8px;
}
.subgraph-g6 :deep(.subgraph-node__detail-title) {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--el-text-color-primary);
  font-weight: 700;
}
.subgraph-g6 :deep(.subgraph-node__detail-item) {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding-left: 16px;
}
.subgraph-g6 :deep(.subgraph-node__detail-bullet) {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--el-text-color-tertiary);
}
.subgraph-g6 :deep(.subgraph-node__detail-text) {
  min-width: 0;
}
.subgraph-legend {
  position: absolute;
  left: 16px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-regular);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 92%, transparent);
  box-shadow: var(--el-shadow-sm);
  font-size: 12px;
  line-height: 1;
}
.subgraph-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.subgraph-legend--viewer {
  position: absolute;
  left: 44px;
  bottom: 38px;
}
.subgraph-zoom-btn {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--el-border-color-dark);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-shadow-sm);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
}
.subgraph-zoom-btn:hover {
  transform: translateY(-1px);
  background: var(--el-fill-color);
  box-shadow: var(--el-shadow);
}
.subgraph-g6--viewer {
  min-height: 560px;
  margin: 0;
}
</style>
