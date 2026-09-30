<script setup lang="ts">
import { Graph } from "@antv/g6";
import {
  Box,
  ChevronRight,
  Download,
  Focus,
  Maximize2,
  MousePointerClick,
  RefreshCw,
  Route,
  Search,
  Unplug,
  Waypoints,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElInput,
  ElOption,
  ElSegmented,
  ElSelect,
  ElTag,
  vLoading,
} from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyObject, OntologyRelation } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";

const emit = defineEmits<{ "open-modeling": [focus: "object" | "relation", id: string] }>();
const context = useManagerContext();
const { t } = useSharedText();
const { message } = useManagerFeedback();
const { ot } = useOntologyText();
const { loadOntology } = useManagerClient();

type Selection =
  | { type: "object"; value: OntologyObject }
  | { type: "relation"; value: OntologyRelation }
  | null;

const graphRef = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const error = ref("");
const objects = ref<OntologyObject[]>([]);
const relations = ref<OntologyRelation[]>([]);
const selection = ref<Selection>(null);
const keyword = ref("");
const resourceFilter = ref<"all" | "objects" | "relations">("all");
const pathFrom = ref("");
const pathTo = ref("");
const highlightedIds = ref<string[]>([]);
const layouting = ref(false);
const LAYOUT_STORAGE_KEY = "ontology-graph-layout-v1";
let graph: Graph | null = null;
let graphStateVersion = 0;
let graphStateTask = Promise.resolve();
let graphResizeObserver: ResizeObserver | null = null;

const filteredObjects = computed(() => {
  if (resourceFilter.value === "relations") return [];
  const query = keyword.value.trim().toLowerCase();
  return objects.value.filter((object) => {
    if (!query) return true;
    return [
      object.className,
      object.showName,
      object.classDesc,
      ...object.attrs.flatMap((a) => [a.name, a.showName]),
    ].some((value) => value?.toLowerCase().includes(query));
  });
});

const filteredRelations = computed(() => {
  if (resourceFilter.value === "objects") return [];
  const query = keyword.value.trim().toLowerCase();
  return relations.value.filter((relation) => {
    if (!query) return true;
    return [relation.relationship, relation.desc, relation.fromclass, relation.toclass].some(
      (value) => value?.toLowerCase().includes(query)
    );
  });
});

const selectedObject = computed(() =>
  selection.value?.type === "object" ? selection.value.value : null
);
const selectedRelation = computed(() =>
  selection.value?.type === "relation" ? selection.value.value : null
);
const objectMap = computed(() => new Map(objects.value.map((item) => [item.className, item])));
const selectedConnections = computed(() => {
  if (!selectedObject.value) return [];
  return relations.value.filter(
    (relation) =>
      relation.fromclass === selectedObject.value?.className ||
      relation.toclass === selectedObject.value?.className
  );
});
const attributeCount = computed(() =>
  objects.value.reduce((total, object) => total + object.attrs.length, 0)
);

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

function graphData() {
  const palette = context.presentation.nodePalette;
  const colorForClass = (className: string) => {
    let hash = 5381;
    for (const character of className) {
      hash = (hash * 33) ^ character.charCodeAt(0);
    }
    return palette[(hash >>> 0) % palette.length];
  };
  const savedPositions = loadLayout();
  return {
    nodes: objects.value.map((object, index) => ({
      id: object.className,
      data: { object, color: colorForClass(object.className) },
      style:
        savedPositions.get(object.className) || initialNodePosition(index, objects.value.length),
    })),
    edges: relations.value
      .filter(
        (relation) =>
          objectMap.value.has(relation.fromclass) && objectMap.value.has(relation.toclass)
      )
      .map((relation) => ({
        id: `relation:${relation.relationship}`,
        source: relation.fromclass,
        target: relation.toclass,
        data: { relation },
      })),
  };
}

function loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    const positions = saved ? JSON.parse(saved) : {};
    return new Map<string, { x: number; y: number }>(Object.entries(positions));
  } catch {
    return new Map<string, { x: number; y: number }>();
  }
}

function saveLayout() {
  if (!graph) return;
  const positions: Record<string, { x: number; y: number }> = {};
  graph.getNodeData().forEach((node: any) => {
    const position = graph?.getElementPosition(node.id);
    if (position && Number.isFinite(position[0]) && Number.isFinite(position[1])) {
      positions[node.id] = { x: position[0], y: position[1] };
    }
  });
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(positions));
}

function initialNodePosition(index: number, count: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return {
    x: (index % columns) * 180,
    y: Math.floor(index / columns) * 140,
  };
}

function seededRandom(seed = 20260915) {
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
    linkDistance: 180,
    nodeStrength: -420,
    randomSource: seededRandom(),
  };
}

function nodeOptions(colors: ReturnType<typeof graphColors>) {
  return {
    type: "circle" as const,
    style: {
      size: 62,
      fill: (datum: any) => datum.data.color,
      stroke: colors.nodeStroke,
      lineWidth: 5,
      shadowColor: colors.shadow,
      shadowBlur: 12,
      labelText: (datum: any) => datum.data.object.showName || datum.id,
      labelFill: colors.text,
      labelFontSize: 13,
      labelFontWeight: 600,
      labelPlacement: "bottom" as const,
      labelOffsetY: 8,
      cursor: "pointer" as const,
    },
    state: {
      selected: { stroke: colors.primary, lineWidth: 6 },
      highlighted: { stroke: "#ffb547", lineWidth: 7 },
    },
  };
}

function edgeOptions(colors: ReturnType<typeof graphColors>) {
  return {
    type: "line" as const,
    style: {
      stroke: colors.edge,
      lineWidth: 2,
      endArrow: true,
      labelText: (datum: any) => datum.data.relation.showName,
      labelFill: colors.muted,
      labelFontSize: 11,
      labelBackground: true,
      labelBackgroundFill: colors.surface,
      labelBackgroundPadding: [2, 4] as [number, number],
      ...context.presentation.edgeLabel,
      cursor: "pointer" as const,
    },
    state: {
      selected: { stroke: colors.primary, lineWidth: 4 },
      highlighted: { stroke: "#ffb547", lineWidth: 4 },
    },
  };
}

async function renderGraph() {
  if (!graphRef.value) return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  graph?.destroy();
  graph = null;
  graphStateVersion += 1;
  const colors = graphColors();
  graph = new Graph({
    container: graphRef.value,
    width: Math.round(width),
    height: Math.round(height),
    autoResize: false,
    padding: 48,
    animation: false,
    data: graphData(),
    layout: loadLayout().size ? undefined : graphLayout(),
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    node: nodeOptions(colors),
    edge: edgeOptions(colors),
  });
  graph.on("node:click", (event: any) => selectObject(event.target.id));
  graph.on("edge:click", (event: any) =>
    selectRelation(String(event.target.id).replace(/^relation:/, ""))
  );
  graph.on("canvas:click", clearSelection);
  graph.on("node:dragend", saveLayout);
  await graph.render();
  await fitGraphToContainer(graph);
}

async function fitGraphToContainer(target: Graph) {
  if (!graphRef.value) return;
  const { width, height } = graphRef.value.getBoundingClientRect();
  if (!width || !height) return;
  target.resize(Math.round(width), Math.round(height));
  await target.fitView({ when: "always", direction: "both" });
  // Host-supplied fit limit (null for none): with few nodes the graph is not zoomed beyond it.
  const { maxFitZoom } = context.presentation;
  if (maxFitZoom !== null && target.getZoom() > maxFitZoom) {
    await target.zoomTo(maxFitZoom, false);
  }
  await target.fitCenter();
}

async function relayoutGraph() {
  if (!graph || layouting.value) return;
  layouting.value = true;
  try {
    const target = graph;
    if (graphRef.value) {
      const { width, height } = graphRef.value.getBoundingClientRect();
      target.resize(Math.round(width), Math.round(height));
    }
    target.updateNodeData(
      objects.value.map((object, index) => ({
        id: object.className,
        style: initialNodePosition(index, objects.value.length),
      }))
    );
    await target.draw();
    await target.layout(graphLayout());
    await fitGraphToContainer(target);
    saveLayout();
  } finally {
    layouting.value = false;
  }
}

async function applyGraphState(ids: string[], selectedId = "") {
  if (!graph) return;
  const version = ++graphStateVersion;
  const targetGraph = graph;
  const allIds = [
    ...objects.value.map((object) => object.className),
    ...relations.value.map((relation) => `relation:${relation.relationship}`),
  ];
  const active = new Set(ids);
  const states: Record<string, string[]> = {};
  allIds.forEach((id) => {
    const next: string[] = [];
    if (selectedId === id) next.push("selected");
    if (active.size && active.has(id)) next.push("highlighted");
    states[id] = next;
  });
  graphStateTask = graphStateTask
    .catch(() => undefined)
    .then(async () => {
      if (version !== graphStateVersion || graph !== targetGraph) return;
      targetGraph.updateNodeData(
        objects.value.map((object) => ({
          id: object.className,
          style: { opacity: active.size && !active.has(object.className) ? 0.16 : 1 },
        }))
      );
      targetGraph.updateEdgeData(
        relations.value.map((relation) => ({
          id: `relation:${relation.relationship}`,
          style: {
            opacity: active.size && !active.has(`relation:${relation.relationship}`) ? 0.12 : 1,
          },
        }))
      );
      await targetGraph.draw();
      await targetGraph.setElementState(states, false);
    });
  await graphStateTask;
}

function selectObject(className: string) {
  const object = objectMap.value.get(className);
  if (!object) return;
  selection.value = { type: "object", value: object };
  const connected = relations.value.filter(
    (relation) => relation.fromclass === className || relation.toclass === className
  );
  const ids = [className];
  connected.forEach((relation) => {
    ids.push(`relation:${relation.relationship}`, relation.fromclass, relation.toclass);
  });
  highlightedIds.value = [...new Set(ids)];
  void applyGraphState(highlightedIds.value, className);
}

function selectRelation(name: string) {
  const relation = relations.value.find((item) => item.relationship === name);
  if (!relation) return;
  selection.value = { type: "relation", value: relation };
  highlightedIds.value = [
    `relation:${relation.relationship}`,
    relation.fromclass,
    relation.toclass,
  ];
  void applyGraphState(highlightedIds.value, `relation:${relation.relationship}`);
}

function clearSelection() {
  selection.value = null;
  highlightedIds.value = [];
  void applyGraphState([]);
}

function findPath() {
  if (!pathFrom.value || !pathTo.value) return;
  const queue: Array<{ node: string; nodes: string[]; edges: string[] }> = [
    { node: pathFrom.value, nodes: [pathFrom.value], edges: [] },
  ];
  const visited = new Set([pathFrom.value]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.node === pathTo.value) {
      highlightedIds.value = [...current.nodes, ...current.edges];
      selection.value = null;
      void applyGraphState(highlightedIds.value);
      message.success(ot("pathFound", { count: current.edges.length }));
      return;
    }
    relations.value
      .filter((relation) => relation.fromclass === current.node)
      .forEach((relation) => {
        if (visited.has(relation.toclass)) return;
        visited.add(relation.toclass);
        queue.push({
          node: relation.toclass,
          nodes: [...current.nodes, relation.toclass],
          edges: [...current.edges, `relation:${relation.relationship}`],
        });
      });
  }
  message.warning(ot("pathNotFound"));
}

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    const ontology = await loadOntology();
    objects.value = ontology.objects;
    relations.value = ontology.relations;
    clearSelection();
    await nextTick();
    await renderGraph();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : ot("loadOntologyFailed");
  } finally {
    loading.value = false;
  }
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
  const context = output.getContext("2d");
  if (!context) return;

  const background = getComputedStyle(container.parentElement || container).backgroundColor;
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  layers.forEach((canvas) => context.drawImage(canvas, 0, 0, width, height));

  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ontology-graph-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function zoomIn() {
  void graph?.zoomBy(1.2);
}

function zoomOut() {
  void graph?.zoomBy(0.8);
}

function fitGraph() {
  if (graph) void fitGraphToContainer(graph);
}

function openVisualModeling(focus: "object" | "relation", id: string) {
  emit("open-modeling", focus, id);
}

function openSelectionInVisualModeling() {
  if (selectedObject.value) {
    openVisualModeling("object", selectedObject.value.className);
    return;
  }
  if (selectedRelation.value) {
    openVisualModeling("relation", selectedRelation.value.relationship);
  }
}

async function updateGraphTheme() {
  if (!graph) return;
  const colors = graphColors();
  graph.setNode(nodeOptions(colors));
  graph.setEdge(edgeOptions(colors));
  graph.updateNodeData(
    objects.value.map((object) => ({
      id: object.className,
      style: {
        stroke: colors.nodeStroke,
        shadowColor: colors.shadow,
        labelFill: colors.text,
      },
    }))
  );
  graph.updateEdgeData(
    relations.value.map((relation) => ({
      id: `relation:${relation.relationship}`,
      style: {
        stroke: colors.edge,
        labelFill: colors.muted,
        labelBackgroundFill: colors.surface,
      },
    }))
  );
  await graph.draw();
}

watch([keyword, resourceFilter], () => {
  const ids = [
    ...filteredObjects.value.map((object) => object.className),
    ...filteredRelations.value.map((relation) => `relation:${relation.relationship}`),
  ];
  highlightedIds.value = keyword.value || resourceFilter.value !== "all" ? ids : [];
  void applyGraphState(highlightedIds.value);
});

watch(
  () => context.theme,
  () => void updateGraphTheme()
);

onMounted(() => {
  graphResizeObserver = new ResizeObserver(([entry]) => {
    if (!graph || !entry) return;
    const { width, height } = entry.contentRect;
    if (width && height) graph.resize(Math.round(width), Math.round(height));
  });
  if (graphRef.value) graphResizeObserver.observe(graphRef.value);
  void refresh();
});
onBeforeUnmount(() => {
  graphResizeObserver?.disconnect();
  graph?.destroy();
});
</script>

<template>
  <section v-loading="loading" class="playground">
    <header class="playground-header">
      <div>
        <h1>{{ t("nav.ontologyGraph") }}</h1>
        <p>{{ ot("ontologyGraphDesc") }}</p>
      </div>
      <div class="summary-strip" :aria-label="ot('ontologyStats')">
        <span>
          <strong>{{ objects.length }}</strong>
          {{ t("nav.objectTypes") }}
        </span>
        <span>
          <strong>{{ attributeCount }}</strong>
          {{ t("nav.ontologyAttributes") }}
        </span>
        <span>
          <strong>{{ relations.length }}</strong>
          {{ t("nav.relationTypes") }}
        </span>
        <el-button :icon="RefreshCw" circle :title="t('common.refresh')" @click="refresh" />
      </div>
    </header>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

    <div v-else class="playground-grid">
      <aside class="explorer-panel">
        <div class="panel-heading">
          <div>
            <strong>{{ t("nav.ontologyResources") }}</strong>
            <small>{{ ot("locateGraphElements") }}</small>
          </div>
        </div>
        <div class="search-box">
          <el-input
            v-model="keyword"
            clearable
            :placeholder="`${t('common.search')} ${t('nav.ontologyResources')}`"
          >
            <template #prefix><Search :size="15" /></template>
          </el-input>
          <el-segmented
            v-model="resourceFilter"
            :options="[
              { label: t('common.all'), value: 'all' },
              { label: t('nav.objectTypes'), value: 'objects' },
              { label: t('nav.relationTypes'), value: 'relations' },
            ]"
            size="small"
          />
        </div>
        <div class="resource-list">
          <div v-if="filteredObjects.length" class="list-section">
            <p>{{ t("nav.objectTypes") }} · {{ filteredObjects.length }}</p>
            <button
              v-for="object in filteredObjects"
              :key="object.className"
              :class="['resource-row', { active: selectedObject?.className === object.className }]"
              @click="selectObject(object.className)"
            >
              <span class="resource-icon object-icon"><Box :size="14" /></span>
              <span>
                <strong>{{ object.showName }}</strong>
                <small>{{ object.className }}</small>
              </span>
              <ChevronRight :size="14" />
            </button>
          </div>
          <div v-if="filteredRelations.length" class="list-section">
            <p>{{ t("nav.relationTypes") }} · {{ filteredRelations.length }}</p>
            <button
              v-for="relation in filteredRelations"
              :key="relation.relationship"
              :class="[
                'resource-row',
                { active: selectedRelation?.relationship === relation.relationship },
              ]"
              @click="selectRelation(relation.relationship)"
            >
              <span class="resource-icon relation-icon"><Waypoints :size="14" /></span>
              <span>
                <strong>{{ relation.showName }}</strong>
              </span>
              <ChevronRight :size="14" />
            </button>
          </div>
          <el-empty
            v-if="!filteredObjects.length && !filteredRelations.length"
            :description="ot('noMatchingResources')"
            :image-size="54"
          />
        </div>
      </aside>

      <main class="graph-panel">
        <div ref="graphRef" class="graph-canvas" />
        <div v-if="!objects.length && !loading" class="graph-empty">
          <Unplug :size="30" />
          <strong>{{ ot("noObjects") }}</strong>
          <span>{{ ot("createObjectsFirst") }}</span>
        </div>
        <div class="graph-toolbar">
          <button :title="ot('zoomIn')" @click="zoomIn"><ZoomIn :size="17" /></button>
          <button :title="ot('zoomOut')" @click="zoomOut"><ZoomOut :size="17" /></button>
          <button :title="ot('fitCanvas')" @click="fitGraph"><Maximize2 :size="17" /></button>
          <button :title="ot('relayout')" :disabled="layouting" @click="relayoutGraph">
            <Focus :size="17" />
          </button>
          <button :title="ot('downloadPng')" @click="downloadGraph"><Download :size="17" /></button>
        </div>
        <div class="graph-hint">
          <span />
          {{ ot("graphHint") }}
        </div>
      </main>

      <aside class="inspector-panel">
        <section class="path-panel">
          <div class="panel-heading">
            <div>
              <strong>{{ ot("pathFinder") }}</strong>
              <small>{{ ot("pathFinderDesc") }}</small>
            </div>
            <Route :size="17" />
          </div>
          <div class="path-controls">
            <el-select v-model="pathFrom" filterable :placeholder="ot('sourceObject')">
              <el-option
                v-for="object in objects"
                :key="object.className"
                :label="object.showName"
                :value="object.className"
              />
            </el-select>
            <ChevronRight :size="16" />
            <el-select v-model="pathTo" filterable :placeholder="ot('targetObject')">
              <el-option
                v-for="object in objects"
                :key="object.className"
                :label="object.showName"
                :value="object.className"
              />
            </el-select>
          </div>
          <el-button type="primary" plain :disabled="!pathFrom || !pathTo" @click="findPath">
            {{ ot("findPath") }}
          </el-button>
        </section>

        <section class="detail-panel">
          <div class="panel-heading">
            <div>
              <strong>{{ ot("inspector") }}</strong>
              <small>{{ ot("inspectorDesc") }}</small>
            </div>
            <el-button
              v-if="selectedObject || selectedRelation"
              class="modeling-link"
              type="primary"
              plain
              size="small"
              :icon="Workflow"
              @click="openSelectionInVisualModeling"
            >
              {{ ot("goModeling") }}
            </el-button>
          </div>
          <div v-if="selectedObject" class="detail-content">
            <div class="detail-title">
              <span class="resource-icon object-icon"><Box :size="16" /></span>
              <div class="detail-title-copy">
                <h2>{{ selectedObject.showName }}</h2>
                <code>{{ selectedObject.className }}</code>
              </div>
              <span class="detail-title-count">
                {{ selectedObject.attrs.length }} {{ ot("attributes") }}
              </span>
            </div>
            <p class="description">{{ selectedObject.classDesc }}</p>
            <div class="detail-section">
              <div class="section-label">
                <span>{{ ot("attributes") }}</span>
                <small>{{ selectedObject.attrs.length }}</small>
              </div>
              <div v-if="selectedObject.attrs.length" class="attribute-list">
                <div
                  v-for="attribute in selectedObject.attrs"
                  :key="attribute.name"
                  class="attribute-row"
                >
                  <span>
                    <strong>{{ attribute.showName }}</strong>
                    <code>{{ attribute.name }}</code>
                  </span>
                  <el-tag size="small" effect="plain">{{ attribute.type }}</el-tag>
                </div>
              </div>
              <el-empty v-else :description="ot('noAttributes')" :image-size="42" />
            </div>
            <div class="detail-section">
              <div class="section-label">
                <span>{{ ot("relations") }}</span>
                <small>{{ selectedConnections.length }}</small>
              </div>
              <button
                v-for="relation in selectedConnections"
                :key="relation.relationship"
                class="connection-row"
                @click="selectRelation(relation.relationship)"
              >
                <span>{{ objectMap.get(relation.fromclass)?.showName || relation.fromclass }}</span>
                <span class="connection-name">{{ relation.showName }}</span>
                <span>{{ objectMap.get(relation.toclass)?.showName || relation.toclass }}</span>
              </button>
            </div>
          </div>
          <div v-else-if="selectedRelation" class="detail-content">
            <div class="detail-title">
              <span class="resource-icon relation-icon"><Waypoints :size="16" /></span>
              <div>
                <h2>{{ selectedRelation.showName }}</h2>
              </div>
            </div>
            <div class="relation-flow">
              <button @click="selectObject(selectedRelation.fromclass)">
                {{
                  objectMap.get(selectedRelation.fromclass)?.showName || selectedRelation.fromclass
                }}
              </button>
              <span>
                <Waypoints :size="15" />
                {{ selectedRelation.showName }}
              </span>
              <button @click="selectObject(selectedRelation.toclass)">
                {{ objectMap.get(selectedRelation.toclass)?.showName || selectedRelation.toclass }}
              </button>
            </div>
          </div>
          <div v-else class="inspector-empty">
            <div class="empty-mark"><MousePointerClick :size="24" /></div>
            <strong>{{ ot("selectGraphElement") }}</strong>
            <span>{{ ot("inspectorEmptyDesc") }}</span>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.playground {
  --el-font-size-base: var(--text-sm);
  --el-font-size-small: var(--text-xs);
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-bg-color-page);
}
.playground-header {
  display: flex;
  min-height: 84px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: var(--spacing-md) var(--spacing-xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.playground-header h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-xl);
  letter-spacing: 0;
}
.playground-header p {
  margin: 2px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.summary-strip {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.summary-strip span {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.summary-strip strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
}
.playground-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 240px minmax(320px, 1fr) 320px;
  overflow: hidden;
}
.explorer-panel,
.inspector-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--el-bg-color);
}
.explorer-panel {
  border-right: 1px solid var(--el-border-color);
}
.inspector-panel {
  border-left: 1px solid var(--el-border-color);
  overflow: auto;
}
.panel-heading {
  display: flex;
  height: 54px;
  min-height: 54px;
  flex: 0 0 54px;
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
.search-box {
  display: grid;
  min-width: 0;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
}
.search-box > * {
  min-width: 0;
}
.search-box :deep(.el-input) {
  width: 100%;
  min-width: 0;
}
.search-box :deep(.el-segmented) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.search-box :deep(.el-segmented__group) {
  width: 100%;
  min-width: 0;
}
.search-box :deep(.el-segmented__item) {
  flex: 1;
  min-width: 0 !important;
  padding-right: 6px;
  padding-left: 6px;
}
.search-box :deep(.el-segmented__item-label) {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-box :deep(.el-segmented__item-label),
.playground :deep(.el-input__inner),
.playground :deep(.el-select__placeholder),
.playground :deep(.el-select__selected-item),
.playground :deep(.el-button) {
  font-size: var(--text-sm);
}
.resource-list {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-sm);
}
.list-section + .list-section {
  margin-top: var(--spacing-md);
}
.list-section > p {
  margin: 0 6px 5px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.resource-row {
  display: flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  background: transparent;
  text-align: left;
}
.resource-row:hover {
  background: var(--el-fill-color-light);
}
.resource-row.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.resource-row > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.resource-row strong,
.resource-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-row strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.resource-row small {
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
}
.resource-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: var(--radius-sm);
}
.object-icon {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
/* Values come from the host's presentation.themeProperties. */
.relation-icon {
  color: var(--manager-relation-icon-color);
  background: var(--manager-relation-icon-background);
}
.graph-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color-dark) 1px, transparent 1px);
  background-size: 18px 18px;
}
.ontology-manager.is-dark .graph-panel {
  background-color: #0a0b16;
  background-image: radial-gradient(#3a4265 1px, transparent 1px);
}
.graph-canvas {
  position: absolute;
  inset: 0;
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
  right: 18px;
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
.path-panel {
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.path-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  padding: var(--spacing-md);
}
.path-panel > .el-button {
  width: calc(100% - 24px);
  margin: 0 var(--spacing-md);
}
.detail-panel {
  display: flex;
  min-height: 260px;
  flex: 1;
  flex-direction: column;
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
.detail-title .resource-icon {
  flex: none;
  margin-top: 1px;
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
.detail-title-count {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 11px;
  font-weight: var(--font-semibold);
  line-height: 16px;
}
.modeling-link {
  border-color: var(--el-border-color-dark);
  color: var(--el-text-color-primary);
  background: color-mix(in srgb, var(--el-bg-color), var(--el-color-primary-light-9) 44%);
  font-weight: var(--font-medium);
}
.modeling-link:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
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
.description {
  margin: 10px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
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
.attribute-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.attribute-row strong,
.attribute-row code {
  display: block;
}
.attribute-row strong {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.connection-row {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  color: var(--el-text-color-regular);
  background: transparent;
  font-size: var(--text-xs);
  text-align: left;
}
.connection-row span:last-child {
  text-align: right;
}
.connection-name {
  max-width: 94px;
  overflow: hidden;
  color: var(--el-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.relation-flow {
  display: grid;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
}
.relation-flow button {
  min-height: 42px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}
.relation-flow span {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--el-color-primary);
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
@container ontology-manager (max-width: 1200px) {
  .playground-grid {
    grid-template-columns: 210px minmax(300px, 1fr) 280px;
  }
}
@container ontology-manager (max-width: 900px) {
  .playground {
    overflow: auto;
  }
  .playground-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .summary-strip {
    width: 100%;
    justify-content: space-between;
  }
  .playground-grid {
    display: grid;
    flex: none;
    grid-template-columns: 1fr;
    overflow: visible;
  }
  .explorer-panel,
  .inspector-panel {
    border: 0;
    border-bottom: 1px solid var(--el-border-color);
  }
  .resource-list {
    max-height: 260px;
  }
  .graph-panel {
    min-height: 520px;
    order: -1;
  }
  .graph-hint {
    display: none;
  }
  .path-panel {
    margin-top: 0;
  }
}
@container ontology-manager (max-width: 560px) {
  .playground-header {
    padding: var(--spacing-md);
  }
  .summary-strip {
    flex-wrap: wrap;
    gap: var(--spacing-sm);
  }
  .graph-panel {
    min-height: 420px;
  }
}
</style>
