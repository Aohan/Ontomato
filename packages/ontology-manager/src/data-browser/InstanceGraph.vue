<script setup lang="ts">
import { Graph } from "@antv/g6";
import {
  Box,
  Download,
  Focus,
  Maximize2,
  MousePointerClick,
  RefreshCw,
  Unplug,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { InstanceGraphEdge, InstanceGraphNode } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";

const context = useManagerContext();
const { message } = useManagerFeedback();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { loadInstanceGraph, queryInstanceInfo, loadOntology } = useManagerClient();

const graphRef = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const error = ref("");
const nodes = ref<InstanceGraphNode[]>([]);
const edges = ref<InstanceGraphEdge[]>([]);
const selectedNode = ref<InstanceGraphNode | null>(null);
const selectedClassLabel = ref("");
const selectedAttributes = ref<Array<{ name: string; showName: string; value: unknown }>>([]);
const classLabels = ref<Record<string, string>>({});
const layouting = ref(false);

let graph: Graph | null = null;
let selectedId = "";
let resizeObserver: ResizeObserver | null = null;

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
      size: 46,
      fill: (datum: any) => datum.data.color,
      stroke: colors.nodeStroke,
      lineWidth: 4,
      shadowColor: colors.shadow,
      shadowBlur: 10,
      labelText: (datum: any) => datum.data.node.name || datum.id,
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
      endArrow: true,
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

async function renderGraph() {
  if (!graphRef.value) return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  graph?.destroy();
  graph = null;
  selectedId = "";
  const colors = graphColors();
  graph = new Graph({
    container: graphRef.value,
    width: Math.round(width),
    height: Math.round(height),
    autoResize: false,
    padding: 48,
    animation: false,
    data: {
      nodes: nodes.value.map((node) => ({
        id: node.id,
        data: { node, color: colorForClass(node.class) },
      })),
      edges: edges.value.map((edge, index) => ({
        id: `edge:${index}:${edge.source}:${edge.target}`,
        source: edge.source,
        target: edge.target,
      })),
    },
    layout: graphLayout(),
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    node: nodeOptions(colors),
    edge: edgeOptions(colors),
  });
  graph.on("node:click", (event: any) => void selectNode(event.target.id));
  graph.on("canvas:click", clearSelection);
  await graph.render();
  await fitGraph(graph);
}

async function relayoutGraph() {
  if (!graph || layouting.value) return;
  layouting.value = true;
  try {
    await graph.layout(graphLayout());
    await fitGraph(graph);
  } finally {
    layouting.value = false;
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
  if (graph && selectedId) {
    void graph.setElementState({ [selectedId]: [] }, false);
  }
  selectedId = "";
  selectedNode.value = null;
  selectedClassLabel.value = "";
  selectedAttributes.value = [];
}

async function loadNodeInfo(node: InstanceGraphNode) {
  selectedClassLabel.value = classLabels.value[node.class] || node.class;
  try {
    const info = await queryInstanceInfo(node.id, node.class);
    const classDef = (info.classDef ?? {}) as Record<string, unknown>;
    const attrs = Array.isArray(classDef.attrs) ? (classDef.attrs as Array<Record<string, unknown>>) : [];
    const row = (info.data ?? {}) as Record<string, unknown>;
    selectedAttributes.value = attrs
      .filter((attr) => typeof attr.name === "string")
      .map((attr) => ({
        name: attr.name as string,
        showName: (attr.showName as string) || (attr.name as string),
        value: row[attr.name as string],
      }));
  } catch (reason) {
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
  loading.value = true;
  error.value = "";
  try {
    const [graphData, ontology] = await Promise.all([loadInstanceGraph(), loadOntology()]);
    classLabels.value = Object.fromEntries(
      ontology.objects.map((object) => [object.className, object.showName])
    );
    nodes.value = graphData.nodes;
    edges.value = graphData.edges;
    clearSelection();
    await renderGraph();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  } finally {
    loading.value = false;
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
  resizeObserver?.disconnect();
  graph?.destroy();
});
</script>

<template>
  <section v-loading="loading" class="instance-graph">
    <div ref="graphRef" class="graph-canvas" />

    <div v-if="isEmpty" class="graph-empty">
      <Unplug :size="30" />
      <strong>{{ ot("instanceGraphEmpty") }}</strong>
      <span>{{ ot("instanceGraphEmptyDesc") }}</span>
    </div>

    <div class="graph-toolbar">
      <button :title="ot('zoomIn')" @click="zoomIn"><ZoomIn :size="17" /></button>
      <button :title="ot('zoomOut')" @click="zoomOut"><ZoomOut :size="17" /></button>
      <button :title="ot('fitCanvas')" @click="fitGraphView"><Maximize2 :size="17" /></button>
      <button :title="ot('relayout')" :disabled="layouting" @click="relayoutGraph">
        <Focus :size="17" />
      </button>
      <button :title="ot('downloadPng')" @click="downloadGraph"><Download :size="17" /></button>
      <button :title="t('common.refresh')" @click="refresh"><RefreshCw :size="17" /></button>
    </div>

    <div class="graph-hint">
      <span />
      {{ ot("instanceGraphHint") }}
    </div>

    <aside class="inspector-panel">
      <div class="panel-heading">
        <div>
          <strong>{{ ot("instanceInspector") }}</strong>
          <small>{{ ot("instanceInspectorDesc") }}</small>
        </div>
      </div>
      <div v-if="selectedNode" class="detail-content">
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
        <span>{{ ot("inspectorEmptyDesc") }}</span>
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
