<script setup lang="ts">
import { Graph } from "@antv/g6";
import {
  Box,
  DatabaseZap,
  Download,
  Focus,
  Maximize2,
  MousePointerClick,
  RefreshCw,
  Search,
  Unplug,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElSelectV2, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { InstanceGraphEdge, InstanceGraphNode, InstanceGraphResult, InstanceGraphSummary } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import {
  drawInstanceGraphBatches,
  GRAPH_BATCH_SIZE,
  instanceNodePosition,
  isLargeInstanceGraph,
} from "./instance-graph-rendering";

const context = useManagerContext();
const { message, confirm } = useManagerFeedback();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { loadInstanceGraphSummary, searchInstanceGraph, loadInstanceNeighborhood, refreshStarChartData, queryInstanceInfo, loadOntology } =
  useManagerClient();

const graphRef = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const regenerating = ref(false);
const error = ref("");
const status = ref<InstanceGraphResult["status"]>("READY");
const nodes = shallowRef<InstanceGraphNode[]>([]);
const edges = shallowRef<InstanceGraphEdge[]>([]);
const selectedNode = ref<InstanceGraphNode | null>(null);
const selectedClassLabel = ref("");
const selectedAttributes = ref<Array<{ name: string; showName: string; value: unknown }>>([]);
const classLabels = ref<Record<string, string>>({});
const layouting = ref(false);
const rendering = ref(false);
const renderedElements = ref(0);
const largeGraph = computed(() => isLargeInstanceGraph(nodes.value.length, edges.value.length));
const summary = shallowRef<InstanceGraphSummary | null>(null);
const overview = ref(true);
const selectedClass = ref("");
const searchNodes = shallowRef<InstanceGraphNode[]>([]);
const searching = ref(false);
const searchMore = ref(false);
const expanding = ref(false);
const neighborPages = shallowRef<Record<string, { nextOffset: number | null; total: number; loaded: number }>>({});
const currentPage = computed(() => selectedNode.value ? neighborPages.value[selectedNode.value.id] : undefined);
let searchRequest = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

let graph: Graph | null = null;
let selectedId = "";
let nodeInfoRequest = 0;
let graphRequest = 0;
let resizeObserver: ResizeObserver | null = null;

const searchOptions = computed(() =>
  searchNodes.value.map((node) => ({
    value: node.id,
    label: `${node.name || node.id} · ${node.id} · ${classLabels.value[node.class] || node.class} · ${node.class}`,
    name: node.name || node.id,
    description: `${classLabels.value[node.class] || node.class} · ${node.id}`,
  }))
);

function colorForClass(className: string) {
  const palette = context.presentation.nodePalette;
  let hash = 5381;
  for (const character of className) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }
  return palette[(hash >>> 0) % palette.length];
}

function graphColors() {
  const styles = getComputedStyle(graphRef.value!);
  const dark = context.theme === "dark";
  return {
    text: dark ? "#f4f6ff" : styles.getPropertyValue("--el-text-color-primary").trim() || "#1b2559",
    muted: dark
      ? "#c4cce8"
      : styles.getPropertyValue("--el-text-color-secondary").trim() || "#6b7a99",
    surface: dark ? "#181a2e" : styles.getPropertyValue("--el-bg-color").trim() || "#fff",
    edge: dark ? "#7180a8" : styles.getPropertyValue("--el-border-color-dark").trim() || "#dce3f4",
    nodeStroke: dark ? "#303858" : styles.getPropertyValue("--el-bg-color").trim() || "#fff",
    shadow: dark ? "rgba(0, 0, 0, 0.48)" : "rgba(30, 42, 90, 0.16)",
    primary: styles.getPropertyValue("--el-color-primary").trim() || "#5b3fff",
  };
}

function seededRandom(seed = 20261008) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function graphLayout() {
  return {
    type: "d3-force" as const,
    preventOverlap: true,
    linkDistance: 140,
    nodeStrength: -380,
    randomSource: seededRandom(),
  };
}

function nodeOptions(colors: ReturnType<typeof graphColors>) {
  return {
    type: "circle" as const,
    style: {
      size: (datum: any) => {
        if (!overview.value) return 32;
        const count = summary.value?.classes.find((item) => item.class === datum.id)?.instanceCount ?? 1;
        return Math.min(100, 40 + Math.log2(count + 1) * 4);
      },
      fill: (datum: any) => datum.data.color,
      stroke: colors.nodeStroke,
      lineWidth: 4,
      shadowColor: colors.shadow,
      shadowBlur: largeGraph.value ? 0 : 10,
      labelText: (datum: any) => largeGraph.value ? "" : datum.data.node.name || datum.id,
      labelFill: colors.text,
      labelFontSize: 12,
      labelFontWeight: 600,
      labelPlacement: "bottom" as const,
      labelOffsetY: 6,
      cursor: "pointer" as const,
    },
    state: {
      selected: { stroke: colors.primary, lineWidth: 5 },
    },
  };
}

function edgeOptions(colors: ReturnType<typeof graphColors>) {
  return {
    type: "line" as const,
    style: {
      stroke: colors.edge,
      lineWidth: 1.5,
      endArrow: !largeGraph.value,
      labelText: (datum: any) => overview.value ? String(datum.data?.count ?? "") : "",
      labelFill: colors.muted,
    },
  };
}

async function fitGraph(target: Graph) {
  if (!graphRef.value) return;
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  target.resize(Math.round(width), Math.round(height));
  await target.fitView({ when: "always", direction: "both" });
  const { maxFitZoom } = context.presentation;
  if (maxFitZoom !== null && target.getZoom() > maxFitZoom) {
    await target.zoomTo(maxFitZoom, false);
  }
  await target.fitCenter();
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function renderGraph(request: number) {
  if (!graphRef.value) return;
  await yieldToBrowser();
  if (request !== graphRequest || !graphRef.value) return;
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  graph?.destroy();
  graph = null;
  selectedId = "";
  const colors = graphColors();
  const target = new Graph({
    container: graphRef.value,
    width: Math.round(width),
    height: Math.round(height),
    autoResize: false,
    padding: 48,
    animation: false,
    data: { nodes: [], edges: [] },
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    node: nodeOptions(colors),
    edge: edgeOptions(colors),
  });
  graph = target;
  target.on("node:click", (event: any) => {
    if (!rendering.value && !expanding.value) {
      if (overview.value) void chooseClass(event.target.id);
      else void selectNode(event.target.id);
    }
  });
  target.on("canvas:click", clearSelection);
  const isCurrent = () => request === graphRequest && graph === target;
  rendering.value = true;
  renderedElements.value = 0;
  try {
    await target.render();
    if (!isCurrent()) return;
    const complete = await drawInstanceGraphBatches(target, nodes.value, edges.value, colorForClass, {
      isCurrent,
      yieldControl: yieldToBrowser,
      onProgress: (completed) => { renderedElements.value = completed; },
    });
    if (!complete) return;
    if (overview.value && summary.value) {
      target.updateEdgeData(summary.value.relationships.map((edge, index) => ({
        id: `edge:${index}:${edge.source}:${edge.target}`, data: { count: edge.count },
      })));
      await target.draw();
    }
    if (!largeGraph.value && nodes.value.length) await target.layout(graphLayout());
    if (isCurrent()) await fitGraph(target);
  } finally {
    if (isCurrent()) rendering.value = false;
  }
}

async function relayoutGraph() {
  if (!graph || layouting.value || loading.value || rendering.value || expanding.value) return;
  const target = graph;
  const request = graphRequest;
  const isCurrent = () => request === graphRequest && graph === target;
  layouting.value = true;
  try {
    if (largeGraph.value) {
      for (let offset = 0; offset < nodes.value.length; offset += GRAPH_BATCH_SIZE) {
        await yieldToBrowser();
        if (!isCurrent()) return;
        target.updateNodeData(nodes.value.slice(offset, offset + GRAPH_BATCH_SIZE).map((node, index) => ({
          id: node.id,
          style: instanceNodePosition(offset + index, nodes.value.length),
        })));
        await target.draw();
      }
    } else {
      await target.layout(graphLayout());
    }
    if (isCurrent()) await fitGraph(target);
  } finally {
    if (isCurrent()) layouting.value = false;
  }
}

function applySelection(id: string) {
  if (!graph) return;
  const states: Record<string, string[]> = {};
  if (selectedId && selectedId !== id) states[selectedId] = [];
  states[id] = ["selected"];
  selectedId = id;
  void graph.setElementState(states, false);
}

function clearSelection() {
  nodeInfoRequest += 1;
  if (graph && selectedId) {
    void graph.setElementState({ [selectedId]: [] }, false);
  }
  selectedId = "";
  selectedNode.value = null;
  selectedClassLabel.value = "";
  selectedAttributes.value = [];
}

async function loadNodeInfo(node: InstanceGraphNode) {
  const request = ++nodeInfoRequest;
  selectedClassLabel.value = classLabels.value[node.class] || node.class;
  selectedAttributes.value = [];
  try {
    const info = await queryInstanceInfo(node.id, node.class);
    if (request !== nodeInfoRequest) return;
    const classDef = (info.classDef ?? {}) as Record<string, unknown>;
    const attrs = Array.isArray(classDef.attrs) ? (classDef.attrs as Array<Record<string, unknown>>) : [];
    const row = (info.data ?? {}) as Record<string, unknown>;
    selectedAttributes.value = attrs
      .filter(
        (attr) => typeof attr.name === "string" && !Array.isArray(row[attr.name as string])
      )
      .map((attr) => ({
        name: attr.name as string,
        showName: (attr.showName as string) || (attr.name as string),
        value: row[attr.name as string],
      }));
  } catch (reason) {
    if (request !== nodeInfoRequest) return;
    selectedAttributes.value = [];
    message.error(reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed"));
  }
}

async function selectNode(id: string) {
  const node = nodes.value.find((item) => item.id === id);
  if (!node) return;
  selectedNode.value = node;
  applySelection(id);
  void loadNodeInfo(node);
}

async function focusNode(id: string | undefined) {
  const target = graph;
  if (!id || !target || loading.value || rendering.value || layouting.value || expanding.value) return;
  const match = searchNodes.value.find((node) => node.id === id);
  if (!match) return;
  overview.value = false;
  clearSelection();
  nodes.value = [match];
  edges.value = [];
  neighborPages.value = {};
  await renderGraph(++graphRequest);
  await selectNode(id);
  await expandNeighbors();
  if (graph) {
    await graph.zoomTo(Math.max(1, graph.getZoom()), false);
    await graph.focusElement(id, false);
  }
}

function scheduleSearch(term: string) {
  clearTimeout(searchTimer);
  const request = ++searchRequest;
  searchNodes.value = [];
  searchMore.value = false;
  searching.value = false;
  if (!term.trim() && !selectedClass.value) return;
  searching.value = true;
  searchTimer = setTimeout(() => { void runSearch(term, request); }, 250);
}

async function runSearch(term: string, request: number) {
  const version = summary.value?.version;
  if (!version) { searching.value = false; return; }
  try {
    const result = await searchInstanceGraph(term, version, selectedClass.value || undefined);
    if (request !== searchRequest) return;
    searchNodes.value = result.nodes;
    searchMore.value = result.hasMore;
  } catch (reason) {
    if (request === searchRequest) message.error((reason as Error).message);
  } finally {
    if (request === searchRequest) searching.value = false;
  }
}

async function chooseClass(id: string) {
  clearSelection();
  selectedClass.value = id;
  clearTimeout(searchTimer);
  searching.value = true;
  await runSearch("", ++searchRequest);
}

async function showOverview(request = ++graphRequest) {
  if (!summary.value) return;
  clearSelection();
  clearTimeout(searchTimer);
  searchRequest++;
  searching.value = false;
  searchNodes.value = [];
  searchMore.value = false;
  selectedClass.value = "";
  neighborPages.value = {};
  overview.value = true;
  nodes.value = summary.value.classes.map((item) => ({
    id: item.class, class: item.class,
    name: `${classLabels.value[item.class] || item.class} (${item.instanceCount.toLocaleString()})`,
  }));
  edges.value = summary.value.relationships;
  await renderGraph(request);
}

async function expandNeighbors() {
  const node = selectedNode.value;
  const version = summary.value?.version;
  const target = graph;
  if (!node || !version || !target || expanding.value || rendering.value) return;
  const page = neighborPages.value[node.id];
  if (page?.nextOffset === null) return;
  if (nodes.value.length >= 1000 || edges.value.length >= 2000) {
    message.info(ot("instanceGraphBudget"));
    return;
  }
  const request = graphRequest;
  expanding.value = true;
  try {
    const result = await loadInstanceNeighborhood(node.id, version, page?.nextOffset ?? 0);
    if (request !== graphRequest || graph !== target) return;
    const knownNodes = new Set(nodes.value.map((item) => item.id));
    const knownEdges = new Set(edges.value.map((item) => JSON.stringify([item.source, item.target])));
    const addedNodes = result.nodes.filter((item) => !knownNodes.has(item.id));
    const addedEdges = result.edges.filter((item) => !knownEdges.has(JSON.stringify([item.source, item.target])));
    if (nodes.value.length + addedNodes.length > 1000 || edges.value.length + addedEdges.length > 2000) {
      message.info(ot("instanceGraphBudget"));
      return;
    }
    const center = target.getNodeData(node.id).style ?? { x: 0, y: 0 };
    nodes.value = [...nodes.value, ...addedNodes];
    edges.value = [...edges.value, ...addedEdges];
    target.addData({
      nodes: addedNodes.map((item, index) => ({ id: item.id, data: { node: item, color: colorForClass(item.class) },
        style: { x: Number(center.x || 0) + Math.cos(index * 2.399) * (180 + Math.sqrt(index) * 45),
          y: Number(center.y || 0) + Math.sin(index * 2.399) * (180 + Math.sqrt(index) * 45) },
      })),
      edges: addedEdges.map((item) => ({ ...item, id: `connection:${JSON.stringify([item.source, item.target])}` })),
    });
    await target.draw();
    if (request !== graphRequest) return;
    neighborPages.value = { ...neighborPages.value, [node.id]: {
      nextOffset: result.nextOffset, total: result.total,
      loaded: (page?.loaded ?? 0) + result.edges.length,
    } };
    await fitGraph(target);
  } catch (reason) {
    if (request === graphRequest) message.error((reason as Error).message);
  } finally {
    expanding.value = false;
  }
}

function zoomIn() {
  void graph?.zoomBy(1.2);
}

function zoomOut() {
  void graph?.zoomBy(0.8);
}

function fitGraphView() {
  if (graph) void fitGraph(graph);
}

function downloadGraph() {
  const container = graphRef.value;
  const layers = container ? Array.from(container.querySelectorAll("canvas")) : [];
  if (!container || !layers.length) return;

  const width = Math.max(...layers.map((canvas) => canvas.width));
  const height = Math.max(...layers.map((canvas) => canvas.height));
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const canvasContext = output.getContext("2d");
  if (!canvasContext) return;

  const background = getComputedStyle(container.parentElement || container).backgroundColor;
  canvasContext.fillStyle = background;
  canvasContext.fillRect(0, 0, width, height);
  layers.forEach((canvas) => canvasContext.drawImage(canvas, 0, 0, width, height));

  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `instance-graph-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

async function refresh() {
  const request = ++graphRequest;
  clearTimeout(searchTimer);
  searchRequest++;
  summary.value = null;
  selectedClass.value = "";
  searchMore.value = false;
  searching.value = false;
  searchNodes.value = [];
  clearSelection();
  graph?.destroy();
  graph = null;
  rendering.value = false;
  layouting.value = false;
  nodes.value = [];
  edges.value = [];
  loading.value = true;
  error.value = "";
  try {
    const [result, ontology] = await Promise.all([loadInstanceGraphSummary(), loadOntology()]);
    if (request !== graphRequest) return;
    classLabels.value = Object.fromEntries(
      ontology.objects.map((object) => [object.className, object.showName])
    );
    status.value = result.status;
    if (result.status === "READY") {
      summary.value = result.summary;
      await showOverview(request);
    }
  } catch (reason) {
    if (request !== graphRequest) return;
    error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  } finally {
    if (request === graphRequest) loading.value = false;
  }
}

// Generation scans all star-chart data, so it is confirmed first; the empty state and the toolbar share this entry.
async function regenerate() {
  try {
    await confirm(ot("instanceGraphGenerateConfirm"), ot("generateInstanceGraph"));
  } catch {
    return;
  }
  regenerating.value = true;
  try {
    if ((await refreshStarChartData()) === "GENERATED") {
      message.success(ot("instanceGraphGenerated"));
      await refresh();
    } else {
      message.info(ot("instanceGraphGenerating"));
    }
  } catch (reason) {
    message.error((reason as Error).message);
  } finally {
    regenerating.value = false;
  }
}

const isEmpty = computed(() => !loading.value && !error.value && nodes.value.length === 0);

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!graph || !entry) return;
    const { width, height } = entry.contentRect;
    if (width && height) graph.resize(Math.round(width), Math.round(height));
  });
  if (graphRef.value) resizeObserver.observe(graphRef.value);
  void refresh();
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  searchRequest++;
  graphRequest += 1;
  nodeInfoRequest += 1;
  resizeObserver?.disconnect();
  graph?.destroy();
  graph = null;
});
</script>

<template>
  <section
    v-loading="loading || regenerating"
    :element-loading-text="rendering ? ot('instanceGraphRenderProgress', { completed: renderedElements, total: nodes.length + edges.length }) : undefined"
    class="instance-graph"
  >
    <div ref="graphRef" class="graph-canvas" />
    <div v-if="error" class="graph-empty" role="alert"><strong>{{ error }}</strong></div>

    <div v-if="isEmpty" class="graph-empty">
      <Unplug :size="30" />
      <template v-if="status === 'NOT_GENERATED'">
        <strong>{{ ot("instanceGraphNotGenerated") }}</strong>
        <el-button type="primary" :icon="DatabaseZap" @click="regenerate">
          {{ ot("generateInstanceGraph") }}
        </el-button>
      </template>
      <strong v-else-if="status === 'GENERATING'">{{ ot("instanceGraphGenerating") }}</strong>
      <template v-else>
        <strong>{{ ot("instanceGraphEmpty") }}</strong>
        <span>{{ ot("instanceGraphEmptyDesc") }}</span>
      </template>
    </div>

    <div class="graph-toolbar">
      <button :title="ot('zoomIn')" @click="zoomIn"><ZoomIn :size="17" /></button>
      <button :title="ot('zoomOut')" @click="zoomOut"><ZoomOut :size="17" /></button>
      <button :title="ot('fitCanvas')" @click="fitGraphView"><Maximize2 :size="17" /></button>
      <button :title="ot('relayout')" :disabled="loading || rendering || layouting || expanding" @click="relayoutGraph">
        <Focus :size="17" />
      </button>
      <button :title="ot('downloadPng')" @click="downloadGraph"><Download :size="17" /></button>
      <button :title="t('common.refresh')" :disabled="expanding" @click="refresh"><RefreshCw :size="17" /></button>
      <button :title="ot('regenerateInstanceGraph')" :disabled="regenerating" @click="regenerate">
        <DatabaseZap :size="17" />
      </button>
    </div>

    <div class="graph-hint">
      <span />
      {{ ot("instanceGraphHint") }}
    </div>

    <div v-if="summary" class="graph-summary">
      <strong>{{ ot('instanceGraphSummary', { nodes: summary.nodeCount, edges: summary.edgeCount, components: summary.componentCount }) }}</strong>
      <small>{{ ot('instanceGraphStructure', { isolated: summary.isolatedNodeCount, largest: summary.largestComponentSize, time: new Date(summary.generatedAt).toLocaleString(context.locale) }) }}</small>
      <small v-if="!overview">{{ ot('instanceGraphVisible', { nodes: nodes.length, edges: edges.length }) }}</small>
      <el-button v-if="!overview" size="small" :disabled="rendering || expanding" @click="showOverview()">{{ ot('instanceGraphOverview') }}</el-button>
    </div>

    <aside class="inspector-panel">
      <div class="node-search">
        <el-select-v2
          :model-value="selectedNode?.id"
          :options="searchOptions"
          :placeholder="ot('searchInstanceNodes')"
          :aria-label="ot('searchInstanceNodes')"
          :no-match-text="ot('noMatchingResources')"
          :disabled="loading || regenerating || layouting || rendering || expanding || !summary"
          :loading="searching"
          remote
          :debounce="0"
          :remote-method="scheduleSearch"
          :item-height="52"
          filterable
          clearable
          @change="focusNode"
          @clear="clearSelection"
        >
          <template #prefix><Search :size="15" /></template>
          <template #label="{ value }">
            {{ selectedNode?.name || value }}
          </template>
          <template #default="{ item }">
            <div class="node-search-option">
              <strong :title="item.name">{{ item.name }}</strong>
              <small :title="item.description">{{ item.description }}</small>
            </div>
          </template>
        </el-select-v2>
        <small v-if="selectedClass">{{ classLabels[selectedClass] || selectedClass }} <button @click="selectedClass = ''; scheduleSearch('')">×</button></small>
        <small v-if="searchMore">{{ ot('instanceGraphSearchMore') }}</small>
        <div v-if="overview && searchNodes.length" class="instance-candidates">
          <button v-for="node in searchNodes" :key="node.id" :disabled="rendering || expanding" @click="focusNode(node.id)">{{ node.name || node.id }} <small>{{ node.id }}</small></button>
        </div>
      </div>
      <div class="panel-heading">
        <div>
          <strong>{{ ot("instanceInspector") }}</strong>
          <small>{{ ot("instanceInspectorDesc") }}</small>
        </div>
      </div>
      <div v-if="selectedNode" class="detail-content">
        <el-button :loading="expanding" :disabled="rendering || currentPage?.nextOffset === null" @click="expandNeighbors">{{ ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand') }}</el-button>
        <p v-if="currentPage" class="empty-hint">{{ ot('instanceGraphConnections', { loaded: currentPage.loaded, total: currentPage.total }) }}</p>
        <div class="detail-title">
          <span class="resource-icon"><Box :size="16" /></span>
          <div class="detail-title-copy">
            <h2>{{ selectedNode.name || selectedNode.id }}</h2>
            <code>{{ selectedNode.id }}</code>
          </div>
        </div>
        <div class="detail-section">
          <div class="section-label">
            <span>{{ ot("instanceClass") }}</span>
          </div>
          <p class="class-label">{{ selectedClassLabel }}</p>
        </div>
        <div class="detail-section">
          <div class="section-label">
            <span>{{ ot("attributes") }}</span>
            <small>{{ selectedAttributes.length }}</small>
          </div>
          <div v-if="selectedAttributes.length" class="attribute-list">
            <div
              v-for="attribute in selectedAttributes"
              :key="attribute.name"
              class="attribute-row"
            >
              <span>{{ attribute.showName }}</span>
              <code>{{ attribute.value == null ? "-" : String(attribute.value) }}</code>
            </div>
          </div>
          <p v-else class="empty-hint">{{ ot("noAttributes") }}</p>
        </div>
      </div>
      <div v-else class="inspector-empty">
        <div class="empty-mark"><MousePointerClick :size="24" /></div>
        <strong>{{ ot("selectGraphElement") }}</strong>
        <span>{{ ot("instanceGraphChoose") }}</span>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.instance-graph {
  --el-font-size-base: var(--text-sm);
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color-dark) 1px, transparent 1px);
  background-size: 18px 18px;
}
.ontology-manager.is-dark .instance-graph {
  background-color: #0a0b16;
  background-image: radial-gradient(#3a4265 1px, transparent 1px);
}
.graph-canvas {
  position: absolute;
  inset: 0;
  right: 280px;
}
.graph-toolbar {
  position: absolute;
  bottom: 18px;
  left: 18px;
  display: flex;
  padding: 4px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.graph-toolbar button {
  display: grid;
  width: 34px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--el-text-color-secondary);
  background: transparent;
}
.graph-toolbar button:hover {
  color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}
.graph-hint {
  position: absolute;
  right: 298px;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
}
.graph-hint span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
}
.graph-empty {
  position: absolute;
  inset: 0;
  right: 280px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  pointer-events: none;
}
.graph-empty strong {
  color: var(--el-text-color-primary);
}
.graph-empty span {
  font-size: var(--text-sm);
}
.graph-empty .el-button {
  margin-top: 8px;
  pointer-events: auto;
}
.inspector-panel {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 0;
  width: 280px;
  flex: 0 0 280px;
  flex-direction: column;
  margin-left: auto;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  overflow: auto;
}
.panel-heading {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-secondary);
}
.node-search {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
}
.node-search :deep(.el-select-v2) {
  width: 100%;
}
.graph-summary {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 298px;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.graph-summary .el-button { pointer-events: auto; }
.instance-candidates { display: grid; gap: 4px; max-height: 260px; overflow: auto; margin-top: 8px; }
.instance-candidates button {
  text-align: left; padding: 8px; border: 1px solid var(--el-border-color-light);
  border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-primary);
}
.instance-candidates small, .node-search > small { display: block; color: var(--el-text-color-secondary); }
.node-search-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  height: 52px;
  line-height: 20px;
}
.node-search-option strong,
.node-search-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-search-option strong {
  font-size: var(--text-sm);
}
.node-search-option small {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.panel-heading strong,
.panel-heading small {
  display: block;
}
.panel-heading strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.panel-heading small {
  margin-top: 1px;
  font-size: var(--text-xs);
}
.detail-content {
  padding: var(--spacing-md);
}
.detail-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.resource-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.detail-title-copy {
  min-width: 0;
  flex: 1;
}
.detail-title h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  overflow: hidden;
  font-size: var(--text-sm);
  line-height: 20px;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
code {
  display: block;
  overflow: hidden;
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-section {
  margin-top: var(--spacing-md);
}
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.section-label small {
  color: var(--el-text-color-tertiary);
}
.class-label {
  margin: 8px 0 0;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.attribute-list {
  margin-top: 4px;
}
.attribute-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.attribute-row span {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.attribute-row code {
  max-width: 60%;
  color: var(--el-text-color-secondary);
  text-align: right;
}
.empty-hint {
  margin: 8px 0 0;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
}
.inspector-empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 7px;
  padding: var(--spacing-xl);
  color: var(--el-text-color-secondary);
  text-align: center;
}
.inspector-empty strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.inspector-empty span {
  max-width: 220px;
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
  white-space: normal;
}
.empty-mark {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 50%;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
@container ontology-manager (max-width: 768px) {
  .graph-canvas,
  .graph-empty {
    right: 0;
  }
  .inspector-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 240px;
  }
  .graph-hint {
    display: none;
  }
}
</style>
