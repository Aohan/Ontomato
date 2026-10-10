<script setup lang="ts">
import { Graph } from "@antv/g6";
import {
  Box,
  Download,
  Crosshair,
  Scan,
  Network,
  MousePointerClick,
  RefreshCw,
  Search,
  Unplug,
  ZoomIn,
  ZoomOut,
  GitFork,
  CircleMinus,
  SlidersHorizontal,
  X,
  Info,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElPopover, ElSelect, ElOption, ElCheckbox, ElSelectV2, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { InstanceGraphEdge, InstanceGraphNode, InstanceGraphResult, InstanceGraphSummary } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import {
  drawInstanceGraphBatches,
  GRAPH_BATCH_SIZE,
  instanceNodePosition,
  isLargeInstanceGraph,
  neighborNodePosition,
  instanceEdgeGeometry,
  overviewPositions,
} from "./instance-graph-rendering";

const context = useManagerContext();
const { message } = useManagerFeedback();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { loadInstanceGraphSummary, loadInstanceGraphStatistics, searchInstanceGraph, loadInstanceNeighborhood, queryInstanceInfo, loadOntology } =
  useManagerClient();

const graphRef = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const error = ref("");
const statisticsError = ref("");
const status = ref<InstanceGraphResult["status"]>("READY");
const nodes = shallowRef<InstanceGraphNode[]>([]);
const edges = shallowRef<InstanceGraphEdge[]>([]);
const selectedNode = ref<InstanceGraphNode | null>(null);
const selectedClassLabel = ref("");
const selectedAttributes = ref<Array<{ name: string; showName: string; value: unknown }>>([]);
const detailsLoading = ref(false);
const detailsError = ref("");
const nodeActionPosition = ref<{ x: number; y: number } | null>(null);
const neighborClass = ref("");
const relationType = ref("");
const direction = ref("both");
const fitAfterExpand = ref(false);
const appliedNeighborFilters = shallowRef<{ neighborClass?: string; relationType?: string; direction?: string }>({});
const filtersDirty = computed(() => (appliedNeighborFilters.value.neighborClass || "") !== neighborClass.value
  || (appliedNeighborFilters.value.relationType || "") !== relationType.value
  || (appliedNeighborFilters.value.direction || "both") !== direction.value);
const versionChanged = ref(false);
const relationLabels = ref<Record<string, string>>({});
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
const neighborPages = shallowRef<Record<string, { nextOffset: number | null; total: number | null; loaded: number }>>({});
const currentPage = computed(() => selectedNode.value ? neighborPages.value[selectedNode.value.id] : undefined);
let searchRequest = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

let graph: Graph | null = null;
let selectedId = "";
let nodeInfoRequest = 0;
let graphRequest = 0;
let resizeObserver: ResizeObserver | null = null;
let generationTimer: ReturnType<typeof setTimeout> | undefined;

function saveOverviewLayout() {
  if (!overview.value || !graph || !summary.value || rendering.value) return;
  const positions = Object.fromEntries(graph.getNodeData().map((node) => [node.id, {
    x: Number(node.style?.x), y: Number(node.style?.y),
  }]).filter(([, position]) => {
    const point = position as { x: number; y: number };
    return Number.isFinite(point.x) && Number.isFinite(point.y);
  }));
  try {
    localStorage.setItem(`ontology-instance-overview:${context.apiBase}`, JSON.stringify({ version: summary.value.version, positions }));
  } catch { /* Storage may be unavailable in embedded browsers. */ }
}

function readOverviewLayout(): Record<string, { x: number; y: number }> | null {
  if (!overview.value || !summary.value) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(`ontology-instance-overview:${context.apiBase}`) || "null");
    if (!saved?.positions) return null;
    const valid = Object.fromEntries(nodes.value.filter((node) => Number.isFinite(saved.positions[node.id]?.x)
      && Number.isFinite(saved.positions[node.id]?.y)).map((node) => [node.id, saved.positions[node.id]]));
    return Object.keys(valid).length ? valid : null;
  } catch { return null; }
}


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
      size: 32,
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
      labelText: (datum: any) => {
        return relationLabels.value[datum.data?.type] || datum.data?.type || "";
      },
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
      void selectNode(event.target.id);
    }
  });
  target.on("canvas:click", clearSelection);
  target.on("aftertransform", updateNodeActionPosition);
  target.on("afterdraw", updateNodeActionPosition);
  target.on("node:dragend", updateNodeActionPosition);
  target.on("node:dragend", saveOverviewLayout);
  target.on("node:dblclick", (event: any) => {
    if (!rendering.value && !expanding.value) {
      void selectNode(event.target.id).then(expandNeighbors);
    }
  });
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
      positions: overview.value ? overviewPositions(nodes.value) : undefined,
    });
    if (!complete) return;
    const savedLayout = readOverviewLayout();
    if (savedLayout) {
      const defaults = overviewPositions(nodes.value);
      target.updateNodeData(nodes.value.map((node, index) => ({ id: node.id, style: savedLayout[node.id] || defaults[node.id] || instanceNodePosition(index, nodes.value.length) })));
      await target.draw();
    } else if (!overview.value && !largeGraph.value && nodes.value.length) await target.layout(graphLayout());
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
    if (overview.value) {
      const positions = overviewPositions(nodes.value);
      target.updateNodeData(nodes.value.map((node) => ({ id: node.id, style: positions[node.id] })));
      await target.draw();
    } else if (largeGraph.value) {
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
    if (isCurrent()) saveOverviewLayout();
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
  nodeActionPosition.value = null;
  nodeInfoRequest += 1;
  if (graph && selectedId) {
    void graph.setElementState({ [selectedId]: [] }, false);
  }
  selectedId = "";
  selectedNode.value = null;
  selectedClassLabel.value = "";
  selectedAttributes.value = [];
  detailsLoading.value = false;
  detailsError.value = "";
}

async function loadNodeInfo(node: InstanceGraphNode) {
  const request = ++nodeInfoRequest;
  selectedClassLabel.value = classLabels.value[node.class] || node.class;
  selectedAttributes.value = [];
  detailsLoading.value = true;
  detailsError.value = "";
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
    detailsError.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
    message.error(reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed"));
  } finally {
    if (request === nodeInfoRequest) detailsLoading.value = false;
  }
}

async function selectNode(id: string) {
  const node = nodes.value.find((item) => item.id === id);
  if (!node) return;
  selectedNode.value = node;
  applySelection(id);
  updateNodeActionPosition();
  void loadNodeInfo(node);
}

function updateNodeActionPosition() {
  if (!graph || !graphRef.value || !selectedNode.value) {
    nodeActionPosition.value = null;
    return;
  }
  const style = graph.getNodeData().find((node) => node.id === selectedNode.value?.id)?.style;
  if (!style) return;
  const point = graph.getViewportByCanvas([Number(style.x || 0), Number(style.y || 0)]);
  const { width, height } = graphRef.value.getBoundingClientRect();
  nodeActionPosition.value = {
    x: Math.max(90, Math.min(width - 90, point[0])),
    y: graphRef.value.offsetTop + Math.max(42, Math.min(height - 60, point[1] + 42)),
  };
}

async function centerOnSelection() {
  if (!selectedNode.value || rendering.value || expanding.value) return;
  const node = selectedNode.value;
  overview.value = false;
  nodes.value = [node];
  edges.value = [];
  neighborPages.value = {};
  await renderGraph(++graphRequest);
  await selectNode(node.id);
}

async function focusSelection() {
  if (!graph || !selectedNode.value || rendering.value || expanding.value) return;
  await graph.focusElement(selectedNode.value.id, false);
  updateNodeActionPosition();
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
    if (request === searchRequest) reportGraphError(reason);
  } finally {
    if (request === searchRequest) searching.value = false;
  }
}

function reportGraphError(reason: unknown) {
  if ((reason as { code?: string })?.code === "GRAPH_VERSION_CHANGED") versionChanged.value = true;
  else message.error(reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed"));
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
  neighborClass.value = "";
  relationType.value = "";
  direction.value = "both";
  appliedNeighborFilters.value = {};
  overview.value = true;
  nodes.value = summary.value.overviewNodes || [];
  edges.value = summary.value.overviewEdges || [];
  await renderGraph(request);
}

async function expandNeighbors() {
  const node = selectedNode.value;
  const version = summary.value?.version;
  const target = graph;
  if (!node || !version || !target || expanding.value || rendering.value || filtersDirty.value || versionChanged.value) return;
  const page = neighborPages.value[node.id];
  if (page?.nextOffset === null) return;
  if (nodes.value.length >= 1000 || edges.value.length >= 2000) {
    message.info(ot("instanceGraphBudget"));
    return;
  }
  const request = graphRequest;
  expanding.value = true;
  try {
    const result = await loadInstanceNeighborhood(node.id, version, page?.nextOffset ?? 0, appliedNeighborFilters.value);
    if (request !== graphRequest || graph !== target) return;
    overview.value = false;
    const knownNodes = new Set(nodes.value.map((item) => item.id));
    const knownEdges = new Set(edges.value.map((item) => JSON.stringify([item.source, item.target, item.type])));
    const addedNodes = result.nodes.filter((item) => !knownNodes.has(item.id));
    const addedEdges = result.edges.filter((item) => !knownEdges.has(JSON.stringify([item.source, item.target, item.type])));
    if (nodes.value.length + addedNodes.length > 1000 || edges.value.length + addedEdges.length > 2000) {
      message.info(ot("instanceGraphBudget"));
      return;
    }
    const center = target.getNodeData(node.id).style ?? { x: 0, y: 0 };
    nodes.value = [...nodes.value, ...addedNodes];
    edges.value = [...edges.value, ...addedEdges];
    target.addData({
      nodes: addedNodes.map((item, index) => ({ id: item.id, data: { node: item, color: colorForClass(item.class) },
        style: neighborNodePosition((page?.loaded ?? 0) + index, { x: Number(center.x || 0), y: Number(center.y || 0) }),
      })),
      edges: addedEdges.map((item) => ({ ...item, id: `connection:${JSON.stringify([item.source, item.target, item.type])}`,
        data: { type: item.type, label: item.label } })),
    });
    const geometry = instanceEdgeGeometry(edges.value);
    target.updateEdgeData(target.getEdgeData().map((item) => {
      const index = edges.value.findIndex((edge) => edge.source === item.source && edge.target === item.target && edge.type === item.data?.type);
      return { id: item.id, ...geometry[index] };
    }));
    await target.draw();
    if (request !== graphRequest) return;
    neighborPages.value = { ...neighborPages.value, [node.id]: {
      nextOffset: result.nextOffset, total: result.total,
      loaded: (page?.loaded ?? 0) + result.edges.length,
    } };
    if (fitAfterExpand.value) await fitGraph(target);
  } catch (reason) {
    if (request === graphRequest) reportGraphError(reason);
  } finally {
    expanding.value = false;
  }
}

async function applyNeighborhoodFilters() {
  if (!selectedNode.value || expanding.value || rendering.value) return;
  const node = selectedNode.value;
  appliedNeighborFilters.value = {
    ...(neighborClass.value ? { neighborClass: neighborClass.value } : {}),
    ...(relationType.value ? { relationType: relationType.value } : {}),
    ...(direction.value !== 'both' ? { direction: direction.value } : {}),
  };
  overview.value = false;
  nodes.value = [node];
  edges.value = [];
  neighborPages.value = {};
  await renderGraph(++graphRequest);
  await selectNode(node.id);
  await expandNeighbors();
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
  clearTimeout(generationTimer);
  versionChanged.value = false;
  statisticsError.value = "";
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
    relationLabels.value = Object.fromEntries(ontology.relations.map((relation) => [relation.relationship, relation.showName || relation.relationship]));
    status.value = result.status;
    if (result.status === "READY") {
      summary.value = result.summary;
      await showOverview(request);
      const statisticsSummary = summary.value;
      void loadInstanceGraphStatistics().then((statistics) => {
        if (summary.value !== statisticsSummary) return;
        summary.value = { ...summary.value, nodeCount: statistics.nodeCount,
          classes: summary.value.classes.map((item) => ({ ...item, instanceCount: statistics.classes.find((entry) => entry.class === item.class)?.instanceCount ?? item.instanceCount })) };
      }).catch(() => { if (summary.value === statisticsSummary) statisticsError.value = ot('instanceGraphStatisticsUnavailable'); });
    } else if (result.status === "GENERATING") {
      generationTimer = setTimeout(() => { void refresh(); }, 2000);
    }
  } catch (reason) {
    if (request !== graphRequest) return;
    error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  } finally {
    if (request === graphRequest) loading.value = false;
  }
}

// Generation scans all star-chart data, so it is confirmed first; the empty state and the toolbar share this entry.
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
  clearTimeout(generationTimer);
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
    v-loading="loading"
    :element-loading-text="rendering ? ot('instanceGraphRenderProgress', { completed: renderedElements, total: nodes.length + edges.length }) : undefined"
    class="instance-graph"
  >
    <div ref="graphRef" class="graph-canvas" />
    <div v-if="selectedNode && nodeActionPosition" class="node-actions"
      :style="{ left: `${nodeActionPosition.x}px`, top: `${nodeActionPosition.y}px` }"
      role="toolbar" :aria-label="selectedNode.name || selectedNode.id">
      <button :title="ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand')"
        :aria-label="ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand')"
        :disabled="expanding || rendering || filtersDirty || versionChanged || currentPage?.nextOffset === null" @click="expandNeighbors"><GitFork :size="17" /></button>
      <button :title="ot('instanceGraphCenter')" :aria-label="ot('instanceGraphCenter')"
        :disabled="expanding || rendering" @click="focusSelection"><Crosshair :size="17" /></button>
      <button :title="ot('instanceGraphCollapse')" :aria-label="ot('instanceGraphCollapse')"
        :disabled="expanding || rendering || nodes.length <= 1" @click="centerOnSelection"><CircleMinus :size="17" /></button>
    </div>
    <div v-if="error" class="graph-empty" role="alert"><strong>{{ error }}</strong></div>

    <div v-if="isEmpty" class="graph-empty">
      <Unplug :size="30" />
      <template v-if="status === 'NOT_GENERATED'">
        <strong>{{ ot("instanceGraphNotGenerated") }}</strong>
        <el-button type="primary" :icon="RefreshCw" @click="refresh">
          {{ t("common.refresh") }}
        </el-button>
      </template>
      <strong v-else-if="status === 'GENERATING'">{{ ot("instanceGraphGenerating") }}</strong>
      <template v-else>
        <strong>{{ ot("instanceGraphEmpty") }}</strong>
        <span>{{ ot("instanceGraphEmptyDesc") }}</span>
      </template>
    </div>

    <div class="graph-toolbar" role="toolbar" :aria-label="ot('instanceGraphTitle')">
      <button :title="ot('zoomIn')" :aria-label="ot('zoomIn')" @click="zoomIn"><ZoomIn :size="17" /></button>
      <button :title="ot('zoomOut')" :aria-label="ot('zoomOut')" @click="zoomOut"><ZoomOut :size="17" /></button>
      <button :title="ot('fitCanvas')" :aria-label="ot('fitCanvas')" @click="fitGraphView"><Scan :size="17" /></button>
      <button :title="ot('relayout')" :aria-label="ot('relayout')" :disabled="loading || rendering || layouting || expanding" @click="relayoutGraph">
        <Network :size="17" />
      </button>
      <span class="toolbar-separator" aria-hidden="true" />
      <button :title="ot('downloadPng')" :aria-label="ot('downloadPng')" @click="downloadGraph"><Download :size="17" /></button>
      <button :title="t('common.refresh')" :aria-label="t('common.refresh')" :disabled="expanding" @click="refresh"><RefreshCw :size="17" /></button>
    </div>

    <div class="graph-hint">
      <span />
      {{ ot("instanceGraphHint") }}
    </div>

    <div v-if="summary" class="graph-summary">
      <div class="summary-row">
        <strong class="summary-title">{{ overview ? ot('instanceGraphOverview') : selectedNode?.name }}</strong>
        <span class="summary-counts">{{ ot('instanceGraphLiveCount', { nodes: nodes.length.toLocaleString(context.locale), totalNodes: summary.nodeCount == null ? '…' : summary.nodeCount.toLocaleString(context.locale), edges: edges.length.toLocaleString(context.locale) }) }}</span>
        <el-popover trigger="click" :width="300" :teleported="false" placement="bottom-start">
          <template #reference>
            <button class="summary-info" :title="ot('instanceGraphStatistics')" :aria-label="ot('instanceGraphStatistics')"><Info :size="15" /></button>
          </template>
          <div class="summary-details">
            <strong>{{ ot('instanceGraphStatistics') }}</strong>
            <span>{{ ot('instanceGraphLiveDescription') }}</span>
            <span v-if="statisticsError">{{ statisticsError }}</span>
            <span v-if="overview">{{ ot('instanceGraphSample', { shown: nodes.length, total: summary.nodeCount == null ? '…' : summary.nodeCount, edges: edges.length }) }}</span>
            <span v-if="overview && summary.overviewEdgesTruncated" class="graph-warning">{{ ot('instanceGraphSampleEdgesLimited') }}</span>
          </div>
        </el-popover>
        <el-button v-if="!overview" size="small" :disabled="rendering || expanding" @click="showOverview()">{{ ot('instanceGraphOverview') }}</el-button>
      </div>
      <div v-if="overview" class="sample-legend">
        <button v-for="item in summary.classes" :key="item.class" :class="{ 'is-selected': selectedClass === item.class }" @click="chooseClass(item.class)"><span :style="{ background: colorForClass(item.class) }" />{{ classLabels[item.class] || item.class }}</button>
      </div>
      <small v-if="summary.complete === false" role="alert" class="graph-warning">{{ ot('instanceGraphPartial', { failures: (summary.failures || []).join(', ') }) }}</small>
      <el-button v-if="versionChanged" size="small" :icon="RefreshCw" @click="refresh">{{ ot('instanceGraphVersionChanged') }}</el-button>
    </div>

    <aside class="inspector-panel">
      <div class="node-search">
        <el-select-v2
          :model-value="selectedNode?.id"
          :options="searchOptions"
          :placeholder="ot('searchInstanceNodes')"
          :aria-label="ot('searchInstanceNodes')"
          :no-match-text="ot('noMatchingResources')"
          :disabled="loading || layouting || rendering || expanding || !summary"
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
        <div v-if="selectedClass" class="search-scope">
          <Box :size="13" aria-hidden="true" />
          <span :title="classLabels[selectedClass] || selectedClass">{{ classLabels[selectedClass] || selectedClass }}</span>
          <button :title="ot('instanceGraphClearScope')" :aria-label="ot('instanceGraphClearScope')" @click="selectedClass = ''; scheduleSearch('')"><X :size="13" /></button>
        </div>
        <p v-if="searchMore" class="search-status" role="status">{{ ot('instanceGraphSearchMore') }}</p>
        <div v-if="overview && searchNodes.length" class="instance-candidates">
          <button v-for="node in searchNodes" :key="node.id" :disabled="rendering || expanding" @click="focusNode(node.id)">
            <span class="candidate-copy">
              <span class="candidate-name" :title="node.name || node.id">{{ node.name || node.id }}</span>
              <span class="candidate-meta" :title="`${classLabels[node.class] || node.class} · ${node.id}`">{{ classLabels[node.class] || node.class }} · {{ node.id }}</span>
            </span>
          </button>
        </div>
      </div>
      <div class="panel-heading">
        <div>
          <strong>{{ ot("instanceInspector") }}</strong>
          <small>{{ ot("instanceInspectorDesc") }}</small>
        </div>
      </div>
      <div v-if="selectedNode" class="detail-content">
        <div class="neighbor-filters">
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphNeighbor') }}</span>
          <el-select v-model="neighborClass" clearable :placeholder="ot('allObjectTypes')" :aria-label="ot('instanceGraphNeighbor')" :disabled="expanding || rendering">
            <el-option v-for="item in summary?.classes" :key="item.class" :value="item.class" :label="classLabels[item.class] || item.class" />
          </el-select>
          </div>
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphRelation') }}</span>
          <el-select v-model="relationType" clearable :placeholder="ot('instanceGraphAllRelations')" :aria-label="ot('instanceGraphRelation')" :disabled="expanding || rendering">
            <el-option v-for="type in summary?.relationTypes" :key="type" :value="type" :label="relationLabels[type] || type" />
          </el-select>
          </div>
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphDirection') }}</span>
          <el-select v-model="direction" :aria-label="ot('instanceGraphDirection')" :disabled="expanding || rendering">
            <el-option value="both" :label="ot('instanceGraphBoth')" />
            <el-option value="incoming" :label="ot('instanceGraphIncoming')" />
            <el-option value="outgoing" :label="ot('instanceGraphOutgoing')" />
          </el-select>
          </div>
          <div class="neighbor-filter-actions">
            <p v-if="filtersDirty" class="neighbor-progress" role="status">{{ ot('instanceGraphFiltersPending') }}</p>
            <el-checkbox v-model="fitAfterExpand">{{ ot('instanceGraphKeepView') }}</el-checkbox>
            <el-button :icon="SlidersHorizontal" type="primary" :loading="expanding" :disabled="expanding || rendering" @click="applyNeighborhoodFilters">{{ ot('instanceGraphApply') }}</el-button>
            <el-button :icon="GitFork" :loading="expanding" :disabled="rendering || filtersDirty || versionChanged || currentPage?.nextOffset === null" @click="expandNeighbors">{{ ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand') }}</el-button>
            <p v-if="currentPage" class="neighbor-progress" role="status">{{ currentPage.total == null ? ot('instanceGraphConnectionsMore', { loaded: currentPage.loaded }) : ot('instanceGraphConnections', { loaded: currentPage.loaded, total: currentPage.total }) }}</p>
          </div>
        </div>
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
          <p v-else class="empty-hint" :role="detailsError ? 'alert' : 'status'">{{ detailsLoading ? ot('instanceGraphDetailsLoading') : detailsError || ot("noAttributes") }}</p>
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
  --inspector-width: 320px;
  --el-font-size-base: var(--text-sm);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--inspector-width);
  grid-template-rows: auto minmax(0, 1fr);
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
  position: relative;
  grid-column: 1;
  grid-row: 2;
  min-width: 0;
  overflow: hidden;
}
.neighbor-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--spacing-md) var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: var(--text-sm);
}
.neighbor-field { display: grid; min-width: 0; gap: var(--spacing-xs); }
.neighbor-field-wide { grid-column: 1 / -1; }
.neighbor-label { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 16px; font-weight: var(--font-medium); }
.neighbor-filters :deep(.el-select) { min-width: 0; width: 100%; }
.neighbor-filters :deep(.el-select__wrapper) { min-height: 32px; padding: 4px var(--spacing-sm); }
.neighbor-filters :deep(.el-select__placeholder),
.neighbor-filters :deep(.el-select__selected-item),
.neighbor-filters :deep(.el-select__input),
.neighbor-filters :deep(.el-button) { font-size: var(--text-sm); line-height: 20px; }
.neighbor-filter-actions { display: grid; grid-column: 1 / -1; gap: var(--spacing-sm); padding-top: var(--spacing-xs); }
.neighbor-filter-actions .el-checkbox { height: 24px; margin: 0; }
.neighbor-filter-actions :deep(.el-checkbox__label) { padding-left: var(--spacing-sm); font-size: var(--text-xs); line-height: 16px; }
.neighbor-filter-actions .el-button { width: 100%; min-height: 32px; margin: 0; padding: 6px var(--spacing-md); }
.neighbor-filter-actions :deep(.el-button .el-icon) { font-size: 15px; }
.neighbor-progress { margin: 0; font-size: var(--text-xs); line-height: var(--leading-relaxed); color: var(--el-text-color-secondary); }
.node-actions { position: absolute; z-index: 3; display: flex; transform: translateX(-50%); padding: 4px; gap: 2px; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-bg-color); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12); }
.node-actions button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-regular); cursor: pointer; }
.node-actions button:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.node-actions button:disabled { opacity: 0.4; cursor: default; }
.node-actions button:focus-visible { outline: 2px solid var(--el-color-primary); }
.graph-warning { color: var(--el-color-warning); }
.graph-toolbar button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.graph-toolbar button:disabled { opacity: 0.45; cursor: default; }
.graph-toolbar {
  position: absolute;
  bottom: 18px;
  left: 18px;
  display: flex;
  align-items: center;
  padding: 4px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.toolbar-separator { width: 1px; height: 18px; margin: 0 4px; background: var(--el-border-color-light); }
.graph-toolbar button[aria-expanded="true"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
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
  right: calc(var(--inspector-width) + 18px);
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
  right: var(--inspector-width);
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
  width: var(--inspector-width);
  flex: 0 0 var(--inspector-width);
  flex-direction: column;
  margin-left: auto;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  overflow: auto;
  grid-column: 2;
  grid-row: 1 / 3;
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
  display: grid;
  min-width: 0;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.node-search :deep(.el-select-v2) {
  width: 100%;
  min-width: 0;
  --el-font-size-base: var(--text-sm);
}
.node-search :deep(.el-select__wrapper) {
  min-height: 32px;
  padding: 4px var(--spacing-md);
  gap: var(--spacing-sm);
}
.node-search :deep(.el-select__input),
.node-search :deep(.el-select__placeholder),
.node-search :deep(.el-select__selected-item) {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 20px;
}
.node-search :deep(.el-select__prefix) {
  color: var(--el-text-color-secondary);
}
.search-scope {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px var(--spacing-sm);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.search-scope > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-scope > svg { flex-shrink: 0; }
.search-scope button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--el-text-color-secondary);
}
.search-scope button:hover { color: var(--el-color-primary); background: var(--el-fill-color); }
.search-status {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
}
.graph-summary {
  position: relative;
  grid-column: 1;
  grid-row: 1;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  display: grid;
  min-width: 0;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.graph-summary .el-button { pointer-events: auto; }
.summary-row { display: flex; align-items: center; min-width: 0; gap: var(--spacing-sm); min-height: 24px; }
.summary-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--el-text-color-primary); }
.summary-counts { flex-shrink: 0; font-size: var(--text-xs); }
.summary-row > .el-button { margin-left: auto; flex-shrink: 0; }
.summary-info { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-secondary); }
.summary-info:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.summary-details { display: grid; gap: var(--spacing-sm); font-size: var(--text-xs); line-height: var(--leading-relaxed); }
.summary-details strong { font-size: var(--text-sm); }
.sample-legend { display: flex; min-width: 0; overflow-x: auto; gap: 12px; }
.sample-legend button { pointer-events: auto; display: inline-flex; flex-shrink: 0; align-items: center; gap: 5px; padding: 2px 0; border: 0; background: transparent; color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 18px; }
.sample-legend button:hover, .sample-legend button.is-selected { color: var(--el-color-primary); }
.sample-legend button > span { width: 8px; height: 8px; border-radius: 50%; }
.instance-candidates { display: grid; gap: 2px; min-width: 0; max-height: 260px; overflow: auto; }
.instance-candidates button {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 6px var(--spacing-sm);
  text-align: left;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 18px;
}
.instance-candidates button:hover { background: var(--el-fill-color-light); }
.instance-candidates button:disabled { opacity: 0.5; }
.candidate-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.candidate-name, .candidate-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.candidate-name { font-size: var(--text-sm); font-weight: var(--font-medium); }
.candidate-meta { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 16px; }
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
  font-weight: var(--font-medium);
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
  white-space: normal;
  overflow-wrap: anywhere;
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
  white-space: normal;
  overflow-wrap: anywhere;
  user-select: text;
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
  .instance-graph { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 320px auto; overflow: auto; }
  .graph-canvas,
  .graph-empty {
    right: 0;
    bottom: auto;
    height: 320px;
  }
  .inspector-panel {
    position: relative;
    width: 100%;
    flex: 0 0 auto;
    margin-top: 0;
    grid-column: 1;
    grid-row: 3;
    border-left: 0;
    border-top: 1px solid var(--el-border-color);
    overflow: visible;
  }
  .graph-hint {
    display: none;
  }
  .graph-toolbar { position: relative; grid-column: 1; grid-row: 2; align-self: end; justify-self: start; z-index: 2; top: auto; bottom: 10px; left: 10px; }
}
</style>
