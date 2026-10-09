<script setup lang="ts">
import { Graph } from "@antv/g6";
import { ArrowLeft, Box, Download, Focus, Maximize2, RefreshCw, Search, ZoomIn, ZoomOut } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { ElButton, ElInput, ElOption, ElSelect, vLoading } from "element-plus";
import type { InstanceGraphData, InstanceGraphNode, OntologyRelation } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import {
  INSTANCE_EDGE_LIMIT, INSTANCE_MAX_DEPTH, INSTANCE_NODE_LIMIT,
  localNodePosition, mergeInstanceSubgraph,
} from "./instance-graph-lod";

const context = useManagerContext();
const { ot } = useOntologyText();
const { t } = useSharedText();
const client = useManagerClient();
const graphRef = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const error = ref("");
const mode = ref<"overview" | "instances" | "neighbors">("overview");
const classes = shallowRef<Array<{ className: string; showName: string; count: number }>>([]);
const relations = shallowRef<OntologyRelation[]>([]);
const classPage = ref(0);
const className = ref("");
const keyword = ref("");
const instanceOffset = ref(0);
const nextOffset = ref<number | null>(null);
const data = shallowRef<InstanceGraphData>({ nodes: [], edges: [] });
const results = shallowRef<InstanceGraphNode[]>([]);
const center = shallowRef<InstanceGraphNode | null>(null);
const selectedNode = shallowRef<InstanceGraphNode | null>(null);
const attributes = ref<Array<{ name: string; value: unknown }>>([]);
const direction = ref("both");
const depth = reactive(new Map<string, number>());
const cursors = reactive(new Map<string, string | null>());
const loaded = reactive(new Set<string>());
const continuation = shallowRef<InstanceGraphNode | null>(null);
const budgetReached = ref(false);
const classLabels = computed(() => Object.fromEntries(classes.value.map((item) => [item.className, item.showName])));
const visibleClasses = computed(() => classes.value.slice(classPage.value * 100, (classPage.value + 1) * 100));
const hasMoreNeighbors = computed(() => continuation.value !== null);
let graph: Graph | null = null;
let request = 0;
let detailRequest = 0;
let controller: AbortController | null = null;
let resizeObserver: ResizeObserver | null = null;
let fitting = false;
let disposed = false;
let hoveredId = "";

function begin() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  const version = ++request;
  return { version, signal: controller.signal, current: () => !disposed && version === request };
}

function report(reason: unknown, current: () => boolean) {
  if (current() && !(reason instanceof DOMException && reason.name === "AbortError")) {
    error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  }
}

function colorForClass(name: string) {
  let hash = 5381;
  for (const character of name) hash = (hash * 33) ^ character.charCodeAt(0);
  const palette = context.presentation.nodePalette;
  return palette[(hash >>> 0) % palette.length];
}

function clearSelection() {
  detailRequest++;
  if (graph && selectedNode.value) void graph.setElementState({ [selectedNode.value.id]: [] }, false);
  selectedNode.value = null;
  attributes.value = [];
}

async function fitGraph() {
  const target = graph;
  if (!target) return;
  fitting = true;
  try {
    await target.fitView({ when: "always", direction: "both" });
    if (graph !== target) return;
    const max = context.presentation.maxFitZoom ?? 1;
    if (target.getZoom() > max) await target.zoomTo(max, false);
    if (graph === target) await target.fitCenter();
  } finally {
    fitting = false;
  }
}

async function draw(current: () => boolean, preservePositions = false) {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  if (!current() || !graphRef.value) return;
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  if (!graph) {
    const dark = context.theme === "dark";
    const styles = getComputedStyle(graphRef.value);
    const primary = styles.getPropertyValue("--el-color-primary").trim() || "#5b3fff";
    graph = new Graph({
      container: graphRef.value, width, height, autoResize: false, padding: 48, animation: false,
      data: { nodes: [], edges: [] }, behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
      node: {
        type: "circle",
        style: {
          size: 46, fill: (datum: any) => colorForClass(datum.data.node.class),
          stroke: dark ? "#303858" : "#fff", lineWidth: 3,
          labelText: (datum: any) => datum.data.node.name || datum.id,
          labelFill: dark ? "#f4f6ff" : "#1b2559", labelFontSize: 12,
          labelPlacement: "bottom", labelOffsetY: 6, cursor: "pointer",
        },
        state: { selected: { stroke: primary, lineWidth: 5 } },
      },
      edge: { type: "line", style: { stroke: dark ? "#7180a8" : "#dce3f4", endArrow: true, lineWidth: 1.5 } },
    });
    graph.on("node:click", (event: any) => {
      if (loading.value) return;
      if (event.target.id === "lod:more") { void loadMore(); return; }
      const node = data.value.nodes.find((item) => item.id === event.target.id);
      if (!node) return;
      if (mode.value === "overview") void openClass(node.class);
      else void selectNode(node);
    });
    graph.on("node:dblclick", (event: any) => {
      const node = data.value.nodes.find((item) => item.id === event.target.id);
      if (node && mode.value !== "overview" && !loading.value) void openNeighborhood(node);
    });
    graph.on("canvas:click", clearSelection);
    graph.on("node:pointerenter", (event: any) => { hoveredId = event.target.id; });
    graph.on("node:pointerleave", () => { hoveredId = ""; });
    graph.on("aftertransform", () => {
      if (loading.value || fitting || !graph) return;
      // Different thresholds prevent repeated level changes near a zoom boundary.
      if (mode.value !== "overview" && graph.getZoom() < 0.35) void showOverview();
      else if (graph.getZoom() > 1.6 && hoveredId) {
        const node = data.value.nodes.find((item) => item.id === hoveredId);
        if (node && mode.value === "overview") void openClass(node.class);
        else if (node && mode.value === "instances") void openNeighborhood(node);
      }
    });
    await graph.render();
  }
  if (!current() || !graph) return;
  const target = graph;
  hoveredId = "";
  const previous = preservePositions ? new Map(target.getNodeData().map((node) => [node.id, node.style])) : new Map();
  const more = mode.value === "neighbors" ? hasMoreNeighbors.value : mode.value === "instances" ? nextOffset.value !== null : classes.value.length > (classPage.value + 1) * 100;
  const nodes = data.value.nodes.map((node, index) => ({
    id: node.id, data: { node },
    style: previous.get(node.id) || localNodePosition(node, index, data.value.nodes.length, center.value?.id || ""),
  }));
  if (more && nodes.length < INSTANCE_NODE_LIMIT) nodes.push({
    id: "lod:more", data: { node: { id: "lod:more", name: ot("instanceGraphMore"), class: "" } },
    style: { x: 0, y: -Math.max(240, Math.sqrt(nodes.length + 1) * 100) },
  });
  target.setData({
    nodes,
    edges: data.value.edges.map((edge, index) => ({ ...edge, id: `edge:${index}:${edge.source}:${edge.target}` })),
  });
  await target.draw();
  if (!current() || graph !== target) return;
  if (selectedNode.value && data.value.nodes.some((node) => node.id === selectedNode.value?.id)) {
    await target.setElementState({ [selectedNode.value.id]: ["selected"] }, false);
  }
  if (!preservePositions) await fitGraph();
}

async function refresh() {
  const task = begin();
  clearSelection();
  try {
    const [counts, ontology] = await Promise.all([client.loadInstanceClasses(), client.loadOntology()]);
    if (!task.current()) return;
    const enabled = new Set(ontology.objects.filter((item) => item.inStarChart).map((item) => item.className));
    classes.value = counts.filter((item) => enabled.has(item.className));
    relations.value = ontology.relations;
    classPage.value = 0;
    await overviewData(task.current);
  } catch (reason) { report(reason, task.current); }
  finally { if (task.current()) loading.value = false; }
}

async function overviewData(current: () => boolean) {
  mode.value = "overview";
  center.value = null;
  continuation.value = null;
  budgetReached.value = false;
  depth.clear(); cursors.clear(); loaded.clear();
  clearSelection();
  results.value = [];
  const page = visibleClasses.value;
  const available = new Set(page.map((item) => item.className));
  data.value = {
    nodes: page.map((item) => ({ id: `class:${item.className}`, class: item.className, name: `${item.showName} (${item.count})` })),
    edges: relations.value.filter((item) => available.has(item.fromclass) && available.has(item.toclass))
      .slice(0, INSTANCE_EDGE_LIMIT).map((item) => ({ source: `class:${item.fromclass}`, target: `class:${item.toclass}` })),
  };
  await draw(current);
}

async function showOverview() {
  const task = begin();
  try { await overviewData(task.current); }
  catch (reason) { report(reason, task.current); }
  finally { if (task.current()) loading.value = false; }
}

async function openClass(name: string, offset = 0) {
  if (!name) return;
  const task = begin();
  clearSelection();
  try {
    const page = await client.loadInstanceNodes(name, offset, keyword.value, task.signal);
    if (!task.current()) return;
    className.value = name;
    mode.value = "instances";
    center.value = null;
    continuation.value = null;
    budgetReached.value = false;
    depth.clear(); cursors.clear(); loaded.clear();
    instanceOffset.value = offset;
    nextOffset.value = page.nextOffset;
    results.value = page.nodes;
    data.value = { nodes: page.nodes, edges: [] };
    await draw(task.current);
  } catch (reason) { report(reason, task.current); }
  finally { if (task.current()) loading.value = false; }
}

async function selectNode(node: InstanceGraphNode) {
  clearSelection();
  selectedNode.value = node;
  const version = ++detailRequest;
  const target = graph;
  if (target) {
    await target.setElementState({ [node.id]: ["selected"] }, false);
    if (disposed || version !== detailRequest || graph !== target) return;
    fitting = true;
    try {
      await target.zoomTo(Math.max(1, target.getZoom()), false);
      if (graph === target) await target.focusElement(node.id, false);
    } finally { fitting = false; }
  }
  try {
    const info = await client.queryInstanceInfo(node.id, node.class);
    if (disposed || version !== detailRequest) return;
    const definition = info.classDef as { attrs?: Array<{ name: string; showName?: string }> } | undefined;
    const row = (info.data || {}) as Record<string, unknown>;
    attributes.value = (definition?.attrs || []).filter((attr) => !Array.isArray(row[attr.name]))
      .map((attr) => ({ name: attr.showName || attr.name, value: row[attr.name] }));
  } catch (reason) {
    if (!disposed && version === detailRequest) error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  }
}

async function openNeighborhood(node: InstanceGraphNode) {
  const task = begin();
  clearSelection();
  try {
    const page = await client.loadInstanceNeighbors(node, null, direction.value, task.signal);
    if (!task.current()) return;
    mode.value = "neighbors";
    className.value = node.class;
    center.value = node;
    depth.clear(); cursors.clear(); loaded.clear();
    depth.set(node.id, 0);
    page.nodes.forEach((item) => depth.set(item.id, 1));
    loaded.add(node.id);
    cursors.set(node.id, page.nextCursor);
    continuation.value = page.hasMore ? node : null;
    budgetReached.value = false;
    data.value = mergeInstanceSubgraph({ nodes: [node], edges: [] }, page)!;
    await draw(task.current);
    if (task.current()) void selectNode(node);
  } catch (reason) { report(reason, task.current); }
  finally { if (task.current()) loading.value = false; }
}

async function expand(node: InstanceGraphNode, next = false, replace = false) {
  if (loading.value || mode.value !== "neighbors") return;
  const level = depth.get(node.id) ?? INSTANCE_MAX_DEPTH;
  if (level >= INSTANCE_MAX_DEPTH || (!next && loaded.has(node.id))) return;
  const task = begin();
  try {
    const page = await client.loadInstanceNeighbors(node, next ? cursors.get(node.id) || null : null, direction.value, task.signal);
    if (!task.current()) return;
    const base = replace ? { nodes: [node], edges: [] } : data.value;
    const merged = mergeInstanceSubgraph(base, page);
    if (!merged) {
      budgetReached.value = true;
      continuation.value = node;
      return;
    }
    data.value = merged;
    if (replace) {
      center.value = node;
      clearSelection();
      depth.clear(); cursors.clear(); loaded.clear();
      depth.set(node.id, 0);
    }
    page.nodes.forEach((item) => depth.set(item.id, Math.min(depth.get(item.id) ?? Infinity, replace ? 1 : level + 1)));
    loaded.add(node.id);
    cursors.set(node.id, page.nextCursor);
    continuation.value = page.hasMore ? node : data.value.nodes.find((item) => cursors.get(item.id)) || null;
    budgetReached.value = false;
    await draw(task.current, !replace);
  } catch (reason) { report(reason, task.current); }
  finally { if (task.current()) loading.value = false; }
}

async function loadMore() {
  if (mode.value === "overview") { classPage.value++; await showOverview(); }
  else if (mode.value === "instances" && nextOffset.value !== null) await openClass(className.value, nextOffset.value);
  else if (continuation.value && !budgetReached.value) await expand(continuation.value, true);
}

function back() {
  if (mode.value === "neighbors") void openClass(className.value);
  else void showOverview();
}

function zoomIn() { void graph?.zoomBy(1.2); }
function zoomOut() { void graph?.zoomBy(0.8); }

watch(() => ot("instanceGraphMore"), (label) => {
  const target = graph;
  if (!target || loading.value || !target.getNodeData().some((node) => node.id === "lod:more")) return;
  target.updateNodeData([{ id: "lod:more", data: { node: { id: "lod:more", name: label, class: "" } } }]);
  void target.draw();
});

function downloadGraph() {
  const layers = Array.from(graphRef.value?.querySelectorAll("canvas") || []);
  if (!layers.length) return;
  const output = document.createElement("canvas");
  output.width = Math.max(...layers.map((canvas) => canvas.width));
  output.height = Math.max(...layers.map((canvas) => canvas.height));
  const drawing = output.getContext("2d");
  if (!drawing) return;
  drawing.fillStyle = context.theme === "dark" ? "#181a2e" : "#fff";
  drawing.fillRect(0, 0, output.width, output.height);
  layers.forEach((canvas) => drawing.drawImage(canvas, 0, 0));
  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "instance-graph.png"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (graph && entry?.contentRect.width && entry.contentRect.height) graph.resize(entry.contentRect.width, entry.contentRect.height);
  });
  if (graphRef.value) resizeObserver.observe(graphRef.value);
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true; request++; detailRequest++; controller?.abort();
  resizeObserver?.disconnect(); graph?.destroy(); graph = null;
});
</script>

<template>
  <section v-loading="loading" class="instance-graph">
    <div ref="graphRef" class="graph-canvas" />
    <div class="graph-level">
      <el-button v-if="mode !== 'overview' || classPage > 0" :icon="ArrowLeft" size="small" @click="classPage > 0 && mode === 'overview' ? (classPage--, showOverview()) : back()">{{ ot('instanceGraphBack') }}</el-button>
      <strong>{{ ot(mode === 'overview' ? 'instanceGraphOverview' : mode === 'instances' ? 'instanceGraphInstances' : 'instanceGraphNeighborhood') }}</strong>
      <small>{{ ot('instanceGraphVisibleCount', { nodes: data.nodes.length, nodeLimit: INSTANCE_NODE_LIMIT, edges: data.edges.length, edgeLimit: INSTANCE_EDGE_LIMIT }) }}</small>
    </div>
    <div v-if="!loading && !data.nodes.length" class="graph-empty">{{ ot('instanceGraphEmpty') }}</div>
    <div class="graph-toolbar">
      <button :title="ot('zoomIn')" :disabled="loading" @click="zoomIn"><ZoomIn :size="17" /></button>
      <button :title="ot('zoomOut')" :disabled="loading" @click="zoomOut"><ZoomOut :size="17" /></button>
      <button :title="ot('fitCanvas')" :disabled="loading" @click="fitGraph"><Maximize2 :size="17" /></button>
      <button :title="ot('relayout')" :disabled="loading" @click="draw(() => !disposed)"><Focus :size="17" /></button>
      <button :title="ot('downloadPng')" :disabled="loading" @click="downloadGraph"><Download :size="17" /></button>
      <button :title="t('common.refresh')" @click="refresh"><RefreshCw :size="17" /></button>
    </div>
    <aside class="inspector-panel">
      <div class="node-search">
        <el-select v-model="className" :placeholder="ot('instanceClass')" :disabled="loading" @change="openClass($event)">
          <el-option v-for="item in classes" :key="item.className" :value="item.className" :label="`${item.showName} (${item.count})`" />
        </el-select>
        <el-input v-model="keyword" :placeholder="ot('searchInstanceNodes')" :disabled="loading || !className" clearable @keyup.enter="openClass(className)" @clear="openClass(className)">
          <template #prefix><Search :size="15" /></template>
          <template #append><el-button :icon="Search" :disabled="loading || !className" @click="openClass(className)" /></template>
        </el-input>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="mode === 'instances'" class="results">
        <button v-for="node in results" :key="node.id" class="node-result" @click="openNeighborhood(node)">
          <strong>{{ node.name || node.id }}</strong><small>{{ node.id }}</small>
        </button>
        <div class="page-actions">
          <el-button v-if="instanceOffset > 0" size="small" :disabled="loading" @click="openClass(className, Math.max(0, instanceOffset - 50))">{{ ot('instanceGraphPrevious') }}</el-button>
          <el-button v-if="nextOffset !== null" size="small" :disabled="loading" @click="loadMore">{{ ot('instanceGraphMore') }}</el-button>
        </div>
      </div>
      <div v-if="mode === 'neighbors'" class="explore-controls">
        <el-select v-model="direction" :disabled="loading" @change="center && openNeighborhood(center)">
          <el-option :label="ot('instanceGraphBoth')" value="both" /><el-option :label="ot('instanceGraphIncoming')" value="in" /><el-option :label="ot('instanceGraphOutgoing')" value="out" />
        </el-select>
        <el-button v-if="continuation && !budgetReached" :disabled="loading" @click="loadMore">{{ ot('instanceGraphMore') }}</el-button>
        <p v-if="budgetReached">{{ ot('instanceGraphBudgetReached') }}</p>
        <el-button v-if="budgetReached && continuation" :disabled="loading" @click="expand(continuation, loaded.has(continuation.id), true)">{{ ot('instanceGraphReplacePage') }}</el-button>
        <el-button v-if="center" :disabled="loading" @click="openNeighborhood(center)">{{ ot('instanceGraphCollapse') }}</el-button>
      </div>
      <div class="panel-heading"><strong>{{ ot('instanceInspector') }}</strong><small>{{ ot('instanceGraphLodHint') }}</small></div>
      <div v-if="selectedNode" class="detail-content">
        <div class="detail-title"><Box :size="18" /><h2>{{ selectedNode.name || selectedNode.id }}</h2></div>
        <code>{{ selectedNode.id }}</code><p>{{ classLabels[selectedNode.class] || selectedNode.class }}</p>
        <div class="page-actions">
          <el-button size="small" :disabled="loading" @click="openNeighborhood(selectedNode)">{{ ot('instanceGraphRecenter') }}</el-button>
          <el-button v-if="mode === 'neighbors'" size="small" :disabled="loading || (depth.get(selectedNode.id) ?? 2) >= INSTANCE_MAX_DEPTH || loaded.has(selectedNode.id)" @click="expand(selectedNode)">{{ ot('instanceGraphExpand') }}</el-button>
          <el-button v-if="mode === 'neighbors' && cursors.get(selectedNode.id)" size="small" :disabled="loading || budgetReached" @click="expand(selectedNode, true)">{{ ot('instanceGraphMore') }}</el-button>
        </div>
        <div v-for="attribute in attributes" :key="attribute.name" class="attribute-row"><span>{{ attribute.name }}</span><code>{{ attribute.value == null ? '-' : String(attribute.value) }}</code></div>
      </div>
      <div v-else class="inspector-empty">{{ ot('selectGraphElement') }}</div>
    </aside>
  </section>
</template>

<style scoped>
.instance-graph { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); background: var(--el-bg-color-page); }
.graph-canvas { position: absolute; inset: 0 300px 0 0; }
.graph-level { position: absolute; top: 12px; left: 12px; right: 312px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--el-text-color-primary); font-size: var(--text-sm); pointer-events: none; }
.graph-level button { pointer-events: auto; }
.graph-level small { color: var(--el-text-color-secondary); }
.graph-empty { position: absolute; inset: 0 300px 0 0; display: grid; place-content: center; color: var(--el-text-color-secondary); pointer-events: none; }
.graph-toolbar { position: absolute; bottom: 18px; left: 18px; display: flex; padding: 4px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); background: var(--el-bg-color); }
.graph-toolbar button { display: grid; place-items: center; width: 34px; height: 32px; border: 0; border-radius: 5px; color: var(--el-text-color-secondary); background: transparent; cursor: pointer; }
.graph-toolbar button:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.graph-toolbar button:disabled { opacity: .5; cursor: default; }
.inspector-panel { position: relative; z-index: 1; flex: 0 0 300px; width: 300px; min-height: 0; margin-left: auto; border-left: 1px solid var(--el-border-color); background: var(--el-bg-color); overflow: auto; }
.node-search, .explore-controls, .detail-content, .panel-heading { padding: var(--spacing-md); }
.node-search, .panel-heading { border-bottom: 1px solid var(--el-border-color-light); }
.node-search, .explore-controls { display: flex; flex-direction: column; gap: 8px; }
.node-search :deep(.el-select), .explore-controls :deep(.el-select) { width: 100%; }
.panel-heading strong, .panel-heading small { display: block; }
.panel-heading strong { color: var(--el-text-color-primary); font-size: var(--text-sm); }
.panel-heading small, .explore-controls p { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 1.6; }
.results { max-height: 260px; overflow: auto; padding: 8px; }
.node-result { display: flex; flex-direction: column; width: 100%; padding: 8px; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--el-text-color-primary); }
.node-result:hover { background: var(--el-fill-color-light); }
.node-result strong, .node-result small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-result small, code { color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.page-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.page-actions :deep(.el-button + .el-button) { margin-left: 0; }
.detail-title { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-primary); }
.detail-title h2 { min-width: 0; margin: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
.detail-content p, .attribute-row { color: var(--el-text-color-regular); font-size: var(--text-sm); }
code { display: block; overflow-wrap: anywhere; }
.attribute-row { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-light); }
.attribute-row code { max-width: 60%; text-align: right; }
.inspector-empty { padding: 24px; color: var(--el-text-color-secondary); font-size: var(--text-sm); text-align: center; }
.error { margin: 8px 12px; color: var(--el-color-danger); font-size: var(--text-sm); }
@container ontology-manager (max-width: 768px) { .inspector-panel { flex-basis: 240px; width: 240px; } .graph-canvas, .graph-empty { right: 240px; } .graph-level { right: 252px; } }
</style>
