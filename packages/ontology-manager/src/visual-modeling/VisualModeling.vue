<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { ElButton, ElTag, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import { ArrowLeft, Box, Link2, Maximize2, Minus, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { Graph, Node, Edge } from "@antv/x6";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import VisualModelingDialogs from "./VisualModelingDialogs.vue";
import VisualModelingRightPanel from "./VisualModelingRightPanel.vue";
import VisualModelingAttributeDialog, {
  type NewAttributeInput,
} from "./VisualModelingAttributeDialog.vue";

const { t } = useSharedText();
const { message, confirm } = useManagerFeedback();
const { ot } = useOntologyText();
/** Location parameters come from the host view's focus/id/back; back only returns to the Manager graph. */
const props = defineProps<{ focus: string; focusId: string; backToPlayground: boolean }>();
const emit = defineEmits<{ back: [] }>();
const context = useManagerContext();
const {
  createOntologyAttribute,
  createOntologyObject,
  createOntologyRelation,
  deleteOntologyObject,
  deleteOntologyRelation,
  getBusinessConfig,
  getMetas,
  listDataAdapters,
  updateOntologyAttribute,
  updateOntologyObject,
} = useManagerClient();

interface ClassDef {
  className: string;
  showName: string;
  classDesc: string;
  attrs: AttrDef[];
  isNew?: boolean;
}

interface AttrDef {
  name: string;
  type: string;
  showName: string;
  attrDesc: string;
  enable: boolean;
  bizzkey: string;
  bizzkeyBool: boolean;
  primaryKey: boolean;
  isNew?: boolean;
}

interface RelationDef {
  relationship: string;
  fromclass: string;
  toclass: string;
  desc: string;
  isNew?: boolean;
  fromField?: string;
  toField?: string;
}

interface NodePosition {
  x: number;
  y: number;
}

const LAYOUT_STORAGE_KEY = "visual-modeling-layout-v2";
const NODE_SIZE = 70;
const NODE_CENTER = NODE_SIZE / 2;
const NODE_LABEL_OFFSET = 12;
// The node palette comes from the host, the same input as the ontology graph.
function nodeColor(className: string) {
  const palette = context.presentation.nodePalette;
  let hash = 5381;
  for (const character of className) {
    hash = (hash * 33) ^ character.charCodeAt(0);
  }
  return palette[(hash >>> 0) % palette.length];
}

function getGraphColors() {
  const style = getComputedStyle(graphRef.value!);
  const primary = style.getPropertyValue("--el-color-primary").trim();
  const textPrimary = style.getPropertyValue("--el-text-color-primary").trim();
  const textSecondary = style.getPropertyValue("--el-text-color-secondary").trim();
  const bgColor = style.getPropertyValue("--el-bg-color").trim();
  const borderColor = style.getPropertyValue("--el-border-color").trim();
  const borderDark = style.getPropertyValue("--el-border-color-dark").trim();
  const success = style.getPropertyValue("--el-color-success").trim();
  const successLight = style.getPropertyValue("--el-color-success-light-9").trim();
  const dark = context.theme === "dark";
  const highlight = "#ffb547";

  return {
    nodeFill: bgColor,
    nodeStroke: dark ? "#303858" : bgColor,
    nodeText: textPrimary,
    selectedStroke: highlight,
    selectedHalo: "rgba(255, 181, 71, 0.28)",
    edgeStroke: dark ? "#7180a8" : borderDark || borderColor,
    edgeLabelFill: textSecondary,
    edgeLabelBg: bgColor,
    edgeLabelStroke: bgColor,
    portStroke: primary,
    portFill: bgColor,
    newFill: successLight,
    newStroke: success,
  };
}

function withAlpha(color: string, alpha: number) {
  const hex = color.trim().replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(hex)) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;

  return color;
}

function nodeHaloColor(cls: ClassDef | undefined, colors: ReturnType<typeof getGraphColors>) {
  const baseColor = cls?.isNew ? colors.newStroke : nodeColor(cls?.className || "");
  return withAlpha(baseColor, 0.28);
}

function toBoolean(value: unknown, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") return value !== 0;
  return defaultValue;
}

const graphRef = ref<HTMLElement | null>(null);
let graph: Graph | null = null;

const classList = ref<ClassDef[]>([]);
const relationList = ref<RelationDef[]>([]);
// When the current data adapter is SQL-based (the sql flag in the backend adapter list), relations can take join fields.
const showJoinFields = ref(false);

const selectedNode = ref<ClassDef | null>(null);
const selectedEdge = ref<RelationDef | null>(null);

async function loadAdapterConfig() {
  try {
    const [config, adapters] = await Promise.all([getBusinessConfig(), listDataAdapters()]);
    const current: string = config.data.dataAdapter;
    showJoinFields.value = (adapters.data as { type: string; sql: boolean }[]).some(
      ({ type, sql }) => type === current && sql
    );
  } catch {
    showJoinFields.value = false;
  }
}
const loading = ref(false);

const originalAttrShowNameMap = ref<Record<string, string>>({});
const originalClassShowName = ref("");

const nodeDialogVisible = ref(false);
const edgeDialogVisible = ref(false);
const attrDialogVisible = ref(false);
const attrSaving = ref(false);
const attrOwner = ref<ClassDef | null>(null);
const editingNode = ref<ClassDef | null>(null);
const editingEdge = ref<RelationDef | null>(null);
const rightPanelVisible = ref(false);

const newNodeName = ref("");
const newNodeShowName = ref("");
const newNodeDesc = ref("");
const newNodePrimaryKey = ref("");
const apiNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const newEdgeDesc = ref("");
const newEdgeFromField = ref("");
const newEdgeToField = ref("");
const pendingEdge = ref<any>(null);
const isFirstLoad = ref(true);

function nodeCenter(node: Node): NodePosition {
  const pos = node.getPosition();
  return { x: pos.x + NODE_CENTER, y: pos.y + NODE_CENTER };
}

function applyEdgeGeometry(edge: Edge, sourceNode: Node, targetNode: Node) {
  const sourceCenter = nodeCenter(sourceNode);
  if (sourceNode.id === targetNode.id) {
    const loopOffset = 64;
    edge.setConnector({ name: "smooth" });
    edge.setSource({
      cell: sourceNode.id,
      anchor: { name: "top" },
      connectionPoint: { name: "boundary" },
    });
    edge.setTarget({
      cell: targetNode.id,
      anchor: { name: "right" },
      connectionPoint: { name: "boundary" },
    });
    edge.setVertices([
      { x: sourceCenter.x, y: sourceCenter.y - loopOffset },
      { x: sourceCenter.x + loopOffset, y: sourceCenter.y - loopOffset },
      { x: sourceCenter.x + loopOffset, y: sourceCenter.y },
    ]);
    return;
  }

  edge.setConnector({ name: "normal" });
  edge.setVertices([]);
  edge.setSource({
    cell: sourceNode.id,
    anchor: { name: "center" },
    connectionPoint: { name: "boundary" },
  });
  edge.setTarget({
    cell: targetNode.id,
    anchor: { name: "center" },
    connectionPoint: { name: "boundary" },
  });
}

function saveLayout() {
  if (!graph) return;

  const positions: Record<string, NodePosition> = {};
  graph.getNodes().forEach((node) => {
    const pos = node.getPosition();
    positions[node.id] = { x: pos.x, y: pos.y };
  });

  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(positions));
}

function loadLayout(): Map<string, NodePosition> {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (!saved) return new Map();

  try {
    const positions: Record<string, NodePosition> = JSON.parse(saved);
    return new Map(Object.entries(positions));
  } catch {
    return new Map();
  }
}

function calculateDefaultLayout(): Map<string, NodePosition> {
  const nodeSpacingX = 180;
  const nodeSpacingY = 140;
  const startX = 50;
  const startY = 50;

  const positions = new Map<string, NodePosition>();

  const columns = Math.max(1, Math.ceil(Math.sqrt(classList.value.length)));
  classList.value.forEach((cls, index) => {
    positions.set(cls.className, {
      x: startX + (index % columns) * nodeSpacingX,
      y: startY + Math.floor(index / columns) * nodeSpacingY,
    });
  });

  return positions;
}

function clearSelection() {
  if (!graph) return;

  const colors = getGraphColors();

  graph.getNodes().forEach((node) => {
    const cls = classList.value.find((c) => c.className === node.id);
    node.setAttrs({
      body: {
        stroke: cls?.isNew ? colors.newStroke : colors.nodeStroke,
        strokeWidth: 5,
      },
      halo: {
        fill: "transparent",
        stroke: "transparent",
      },
    });
  });

  graph.getEdges().forEach((edge) => {
    const rel = relationList.value.find((r) => r.relationship === edge.id);
    edge.setAttrs({
      line: {
        stroke: rel?.isNew ? colors.newStroke : colors.edgeStroke,
        strokeWidth: 2,
      },
    });
  });

  selectedNode.value = null;
  selectedEdge.value = null;
}

function selectNodeByClassName(className: string) {
  if (!graph) return false;
  const node = graph.getCellById(className) as Node | null;
  const cls = classList.value.find((item) => item.className === className);
  if (!node || !cls) return false;

  clearSelection();
  const colors = getGraphColors();
  selectedNode.value = cls;
  selectedEdge.value = null;
  rightPanelVisible.value = true;
  node.setAttrs({
    body: {
      stroke: colors.selectedStroke,
      strokeWidth: 6,
    },
    halo: {
      fill: "transparent",
      stroke: nodeHaloColor(cls, colors),
    },
  });
  graph.centerCell(node);
  return true;
}

function selectEdgeByRelationship(relationship: string) {
  if (!graph) return false;
  const edge = graph.getCellById(relationship) as Edge | null;
  const rel = relationList.value.find((item) => item.relationship === relationship);
  if (!edge || !rel) return false;

  clearSelection();
  const colors = getGraphColors();
  selectedEdge.value = rel;
  selectedNode.value = null;
  rightPanelVisible.value = false;
  edge.setAttrs({
    line: {
      stroke: colors.selectedStroke,
      strokeWidth: 4,
    },
  });
  graph.centerCell(edge);
  return true;
}

function applyRouteFocus() {
  const { focus, focusId: id } = props;
  if (!focus || !id) return;

  const matched = focus === "object" ? selectNodeByClassName(id) : selectEdgeByRelationship(id);
  if (!matched) {
    message.warning(focus === "object" ? ot("focusObjectNotFound") : ot("focusRelationNotFound"));
  }
}

function updateEdgeAnchors() {
  if (!graph) return;

  graph.getEdges().forEach((edge) => {
    const sourceId = edge.getSourceCellId();
    const targetId = edge.getTargetCellId();
    if (!sourceId || !targetId) return;

    const sourceNode = graph!.getCellById(sourceId) as Node;
    const targetNode = graph!.getCellById(targetId) as Node;
    if (!sourceNode || !targetNode) return;

    applyEdgeGeometry(edge, sourceNode, targetNode);
  });
}

function initGraph() {
  if (!graphRef.value) return;

  const colors = getGraphColors();

  const g = new Graph({
    container: graphRef.value,
    width: graphRef.value.clientWidth,
    height: graphRef.value.parentElement?.clientHeight || 600,
    grid: false,
    panning: true,
    mousewheel: true,
    autoResize: true,
    background: { color: "transparent" },
    interacting: {
      nodeMovable: true,
      edgeMovable: true,
      arrowheadMovable: true,
    },
    connecting: {
      snap: true,
      allowBlank: false,
      allowLoop: true,
      highlight: true,
      allowMulti: true,
      createEdge() {
        return this.createEdge({
          attrs: {
            line: {
              stroke: colors.edgeStroke,
              strokeWidth: 2,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              targetMarker: {
                name: "block",
                width: 8,
                height: 6,
              },
            },
          },
          connector: { name: "normal" },
        });
      },
    },
  });

  g.on("node:click", ({ node }: { node: Node }) => {
    clearSelection();
    const cls = classList.value.find((c) => c.className === node.id);
    selectedNode.value = cls || null;
    selectedEdge.value = null;
    rightPanelVisible.value = selectedNode.value !== null;
    node.setAttrs({
      body: {
        stroke: colors.selectedStroke,
        strokeWidth: 6,
      },
      halo: {
        fill: "transparent",
        stroke: nodeHaloColor(cls, colors),
      },
    });
  });

  g.on("edge:click", ({ edge }: { edge: Edge }) => {
    clearSelection();
    selectedEdge.value = relationList.value.find((r) => r.relationship === edge.id) || null;
    selectedNode.value = null;
    rightPanelVisible.value = false;
    edge.setAttrs({
      line: {
        stroke: colors.selectedStroke,
        strokeWidth: 4,
      },
    });
  });

  g.on("blank:click", () => {
    clearSelection();
    rightPanelVisible.value = false;
  });

  g.on("node:dblclick", ({ node }: { node: Node }) => {
    const cls = classList.value.find((c) => c.className === node.id);
    if (cls) openPencilNodeDialog(cls);
  });

  g.on("edge:dblclick", ({ edge }: { edge: Edge }) => {
    const rel = relationList.value.find((r) => r.relationship === edge.id);
    if (rel) openPencilEdgeDialog(rel);
  });

  g.on("node:mouseenter", ({ node }: { node: Node }) => {
    node.setAttrs({
      body: {
        strokeWidth: 6,
      },
    });
    const ports = node.getPorts();
    ports.forEach((port: { id?: string }) => {
      if (port.id) {
        node.setPortProp(port.id, "attrs/circle/r", 6);
        node.setPortProp(port.id, "attrs/circle/visibility", "visible");
      }
    });
  });

  g.on("node:mouseleave", ({ node }: { node: Node }) => {
    const isSelected = selectedNode.value?.className === node.id;
    const cls = classList.value.find((c) => c.className === node.id);
    node.setAttrs({
      body: {
        strokeWidth: isSelected ? 6 : 5,
      },
      halo: {
        fill: "transparent",
        stroke: isSelected ? nodeHaloColor(cls, colors) : "transparent",
      },
    });
    const ports = node.getPorts();
    ports.forEach((port: { id?: string }) => {
      if (port.id) {
        node.setPortProp(port.id, "attrs/circle/r", 4);
        node.setPortProp(port.id, "attrs/circle/visibility", "hidden");
      }
    });
  });

  g.on("node:moved", () => {
    updateEdgeAnchors();
    saveLayout();
  });

  g.on("edge:mouseenter", ({ edge }: { edge: Edge }) => {
    edge.setAttrs({
      line: {
        strokeWidth: 4,
      },
    });
  });

  g.on("edge:mouseleave", ({ edge }: { edge: Edge }) => {
    const isSelected = selectedEdge.value?.relationship === edge.id;
    edge.setAttrs({
      line: {
        strokeWidth: isSelected ? 4 : 2,
      },
    });
  });

  g.on("edge:connected", ({ edge, isNew }: { edge: Edge; isNew: boolean }) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return;

    if (!isNew) {
      const existingRel = relationList.value.find((r) => r.relationship === edge.id);
      if (existingRel) {
        existingRel.fromclass = source;
        existingRel.toclass = target;
        updateEdgeAnchors();
        saveLayout();
        message.warning(t("hotData.relationReconnected"));
      }
      return;
    }

    const sourceClass = classList.value.find((c) => c.className === source);
    const targetClass = classList.value.find((c) => c.className === target);
    if (!sourceClass || !targetClass) return;

    const edgeId = `rel_${Date.now()}`;
    const newRel: RelationDef = {
      relationship: edgeId,
      fromclass: source,
      toclass: target,
      desc: "",
      isNew: true,
      fromField: "",
      toField: "",
    };

    relationList.value.push(newRel);
    selectedEdge.value = newRel;
    pendingEdge.value = edge;

    const sourceNode = g.getCellById(source) as Node;
    const targetNode = g.getCellById(target) as Node;
    if (sourceNode && targetNode) {
      applyEdgeGeometry(edge, sourceNode, targetNode);
    }

    editingEdge.value = newRel;
    newEdgeDesc.value = "";
    newEdgeFromField.value = "";
    newEdgeToField.value = "";
    edgeDialogVisible.value = true;
  });

  graph = g;
  refreshGraphTheme();
}

function renderNodes() {
  if (!graph) return;

  const colors = getGraphColors();

  graph.clearCells();

  const savedLayout = loadLayout();
  const defaultLayout = calculateDefaultLayout();

  const finalPositions = new Map<string, NodePosition>();
  classList.value.forEach((cls) => {
    const savedPos = savedLayout.get(cls.className);
    if (savedPos) {
      finalPositions.set(cls.className, savedPos);
    } else {
      const defaultPos = defaultLayout.get(cls.className);
      if (defaultPos) {
        finalPositions.set(cls.className, defaultPos);
      } else {
        finalPositions.set(cls.className, { x: 50, y: 50 });
      }
    }
  });

  classList.value.forEach((cls) => {
    const pos = finalPositions.get(cls.className) || { x: 50, y: 50 };

    graph!.addNode({
      id: cls.className,
      shape: "circle",
      markup: [
        { tagName: "circle", selector: "halo" },
        { tagName: "circle", selector: "body" },
        { tagName: "text", selector: "text" },
      ],
      x: pos.x,
      y: pos.y,
      width: NODE_SIZE,
      height: NODE_SIZE,
      attrs: {
        halo: {
          refCx: "50%",
          refCy: "50%",
          refR: "58%",
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 10,
          pointerEvents: "none",
        },
        body: {
          refCx: "50%",
          refCy: "50%",
          refR: "50%",
          fill: cls.isNew ? colors.newFill : nodeColor(cls.className),
          stroke: cls.isNew ? colors.newStroke : colors.nodeStroke,
          strokeWidth: 5,
          cursor: "pointer",
          magnet: false,
        },
        text: {
          text: cls.showName || cls.className,
          fill: colors.nodeText,
          fontSize: 13,
          fontWeight: 600,
          refX: "50%",
          refY: NODE_SIZE + NODE_LABEL_OFFSET,
          textAnchor: "middle",
          textVerticalAnchor: "top",
          cursor: "pointer",
        },
      },
      ports: {
        groups: {
          port: {
            position: {
              name: "absolute",
            },
            attrs: {
              circle: {
                r: 4,
                magnet: true,
                stroke: colors.portStroke,
                fill: colors.portFill,
                strokeWidth: 2,
                visibility: "hidden",
              },
            },
          },
        },
        items: [
          { id: "top", group: "port", args: { x: "50%", y: 0 } },
          { id: "bottom", group: "port", args: { x: "50%", y: NODE_SIZE } },
          { id: "left", group: "port", args: { x: 0, y: "50%" } },
          { id: "right", group: "port", args: { x: NODE_SIZE, y: "50%" } },
        ],
      },
    });
  });

  relationList.value.forEach((rel) => {
    const sourceNode = graph!.getCellById(rel.fromclass) as Node;
    const targetNode = graph!.getCellById(rel.toclass) as Node;

    if (sourceNode && targetNode) {
      const edge = graph!.addEdge({
        id: rel.relationship,
        source: { cell: rel.fromclass },
        target: { cell: rel.toclass },
        attrs: {
          line: {
            stroke: rel.isNew ? colors.newStroke : colors.edgeStroke,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            targetMarker: {
              name: "block",
              width: 8,
              height: 6,
            },
            cursor: "pointer",
          },
        },
        labels: rel.desc
          ? [
              {
                attrs: {
                  text: {
                    text: rel.desc,
                    fill: colors.edgeLabelFill,
                    fontSize: 11,
                  },
                  rect: {
                    fill: colors.edgeLabelBg,
                    stroke: rel.isNew ? colors.newStroke : colors.edgeLabelStroke,
                    strokeWidth: 1,
                    rx: 4,
                    ry: 4,
                  },
                },
                position: 0.5,
              },
            ]
          : [],
        connector: { name: "normal" },
      });
      applyEdgeGeometry(edge, sourceNode, targetNode);
    } else {
      console.warn(`Node not found: ${rel.fromclass} -> ${rel.toclass}`);
    }
  });

  if (isFirstLoad.value) {
    isFirstLoad.value = false;
    graph!.centerContent();
    graph!.zoomToFit({ padding: 50, maxScale: 1 });
  }
}

async function loadData() {
  loading.value = true;
  try {
    const res = await getMetas();
    classList.value = (res.data?.classDef || []).map((cls: any) => ({
      className: cls.className,
      showName: cls.showName || cls.classDesc || cls.className,
      classDesc: cls.classDesc || "",
      attrs: (cls.attrs || []).map((a: any) => {
        const raw = a.bizzkeyBool ?? a.bizzkey;
        return {
          name: a.name,
          type: a.type || "string",
          showName: a.showName || a.name,
          attrDesc: a.attrDesc || "",
          enable: toBoolean(a.enable, true),
          bizzkey: a.bizzkey ?? "",
          bizzkeyBool: toBoolean(raw),
          primaryKey: toBoolean(a.primaryKey),
        };
      }),
      isNew: false,
    }));
    relationList.value = Object.entries(res.data?.relationship_rule || {}).map(
      ([key, rel]: [string, any]) => ({
        relationship: key,
        fromclass: rel.fromclass,
        toclass: rel.toclass,
        desc: rel.desc || "",
        isNew: false,
      })
    );

    if (graph) {
      graph.dispose();
      graph = null;
    }
    initGraph();
    renderNodes();
    applyRouteFocus();
  } catch (e: any) {
    message.error(e.message || t("dataBrowser.loadDataFailed"));
  } finally {
    loading.value = false;
  }
}

function openAddNodeDialog() {
  newNodeName.value = "";
  newNodeShowName.value = "";
  newNodeDesc.value = "";
  newNodePrimaryKey.value = "";
  editingNode.value = null;
  nodeDialogVisible.value = true;
}

function openPencilNodeDialog(cls: ClassDef) {
  editingNode.value = { ...cls };
  newNodeName.value = cls.className;
  newNodeShowName.value = cls.showName;
  newNodeDesc.value = cls.classDesc;
  nodeDialogVisible.value = true;
}

function openAddAttrDialog(cls: ClassDef) {
  attrOwner.value = cls;
  attrDialogVisible.value = true;
}

async function handleAddAttr(input: NewAttributeInput) {
  attrSaving.value = true;
  try {
    await createOntologyAttribute({ ...input, name: input.attrName });
    attrDialogVisible.value = false;
    await loadData();
    selectNodeByClassName(input.className);
    message.success(t("hotData.attrCreated"));
  } catch (e: any) {
    message.error(e.message || t("hotData.attrCreateFailed"));
  } finally {
    attrSaving.value = false;
  }
}

function openAddEdgeDialog() {
  if (classList.value.length < 2) {
    message.warning(t("hotData.needAtLeastTwoClasses"));
    return;
  }
  pendingEdge.value = null;
  editingEdge.value = {
    relationship: `rel_${Date.now()}`,
    fromclass: selectedNode.value?.className || classList.value[0].className,
    toclass:
      classList.value.find(
        (c) => c.className !== (selectedNode.value?.className || classList.value[0].className)
      )?.className || classList.value[1].className,
    desc: "",
    isNew: true,
    fromField: "",
    toField: "",
  };
  newEdgeDesc.value = "";
  newEdgeFromField.value = "";
  newEdgeToField.value = "";
  edgeDialogVisible.value = true;
}

function openPencilEdgeDialog(rel: RelationDef) {
  editingEdge.value = { ...rel };
  newEdgeDesc.value = rel.desc;
  newEdgeFromField.value = rel.fromField || "";
  newEdgeToField.value = rel.toField || "";
  edgeDialogVisible.value = true;
}

async function handleAddNode() {
  if (!newNodeName.value.trim()) {
    message.warning(t("hotData.enterClassName"));
    return;
  }
  if (!newNodeShowName.value.trim()) {
    message.warning(t("admin.enterDisplayName"));
    return;
  }
  if (!newNodeDesc.value.trim()) {
    message.warning(t("hotData.enterClassDesc"));
    return;
  }
  const primaryKeyName = newNodePrimaryKey.value.trim();
  if (!primaryKeyName) {
    message.warning(ot("fillPrimaryKeyName"));
    return;
  }
  if (!apiNamePattern.test(primaryKeyName)) {
    message.warning(ot("invalidAttributeName"));
    return;
  }
  if (classList.value.some((c) => c.className === newNodeName.value.trim())) {
    message.warning(t("hotData.classNameExists"));
    return;
  }

  try {
    const className = newNodeName.value.trim();
    await createOntologyObject({
      className,
      primaryKeyName,
      showName: newNodeShowName.value.trim() || className,
      classDesc: newNodeDesc.value.trim(),
      classToCard: false,
      instanceToCard: false,
      inStarChart: false,
    });
    nodeDialogVisible.value = false;
    // The backend's saved result (including the primary key attribute) is the source of truth: re-read, then select the new class.
    await loadData();
    selectNodeByClassName(className);
    message.success(t("hotData.classCreated"));
  } catch (e: any) {
    message.error(e.message || t("hotData.classCreateFailed"));
  }
}

async function handlePencilNode() {
  if (!editingNode.value) return;

  if (!newNodeShowName.value.trim()) {
    message.warning(t("admin.enterDisplayName"));
    return;
  }
  if (!newNodeDesc.value.trim()) {
    message.warning(t("hotData.enterClassDesc"));
    return;
  }

  const editing = editingNode.value;
  const idx = classList.value.findIndex((c) => c.className === editing.className);
  if (idx >= 0) {
    const newShowName = newNodeShowName.value.trim();
    const newDesc = newNodeDesc.value.trim();

    try {
      if (newShowName !== classList.value[idx].showName) {
        await updateOntologyObject(editing.className, { showName: newShowName });
      }
      if (newDesc !== classList.value[idx].classDesc) {
        await updateOntologyObject(editing.className, { classDesc: newDesc });
      }

      classList.value[idx].showName = newShowName;
      classList.value[idx].classDesc = newDesc;
      selectedNode.value = classList.value[idx];
      renderNodes();
      message.success(t("hotData.classCreated"));
    } catch (e: any) {
      message.error(e.message || t("hotData.classCreateFailed"));
    }
  }
  nodeDialogVisible.value = false;
}

function handleTrash2Node() {
  if (!selectedNode.value) return;

  const nodeToTrash2 = selectedNode.value;
  const relatedEdges = relationList.value.filter(
    (r) => r.fromclass === nodeToTrash2.className || r.toclass === nodeToTrash2.className
  );

  confirm(
    t("hotData.deleteClassConfirm", { name: nodeToTrash2.showName }),
    t("common.deleteConfirm")
  )
    .then(async () => {
      try {
        for (const rel of relatedEdges) {
          await deleteOntologyRelation(rel.relationship);
        }
        await deleteOntologyObject(nodeToTrash2.className);

        relationList.value = relationList.value.filter(
          (r) => r.fromclass !== nodeToTrash2.className && r.toclass !== nodeToTrash2.className
        );
        classList.value = classList.value.filter((c) => c.className !== nodeToTrash2.className);
        selectedNode.value = null;

        const savedLayout = loadLayout();
        savedLayout.delete(nodeToTrash2.className);
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(Object.fromEntries(savedLayout)));

        renderNodes();
        message.success(t("admin.deletedSuccess"));
      } catch (e: any) {
        message.error(e.message || t("admin.deleteFailed"));
      }
    })
    .catch(() => {});
}

async function handleAddEdge() {
  if (!editingEdge.value) return;

  if (!newEdgeDesc.value.trim()) {
    message.warning(t("hotData.enterRelDesc"));
    return;
  }
  if (showJoinFields.value) {
    if (!newEdgeFromField.value.trim()) {
      message.warning(t("hotData.enterSrcField"));
      return;
    }
    if (!newEdgeToField.value.trim()) {
      message.warning(t("hotData.enterTgtField"));
      return;
    }
  }

  const edge = editingEdge.value;
  const existingRel = relationList.value.find(
    (r) =>
      r.fromclass === edge.fromclass &&
      r.toclass === edge.toclass &&
      r.relationship !== edge.relationship &&
      !r.isNew
  );
  if (existingRel) {
    message.warning(t("hotData.relationExists"));
    if (pendingEdge.value) {
      handleCancelEdge();
    } else {
      edgeDialogVisible.value = false;
    }
    return;
  }

  try {
    await createOntologyRelation({
      relationship: edge.relationship,
      fromclass: edge.fromclass,
      toclass: edge.toclass,
      desc: newEdgeDesc.value.trim(),
      fromField: newEdgeFromField.value,
      toField: newEdgeToField.value,
    });

    const idx = relationList.value.findIndex((r) => r.relationship === edge.relationship);
    if (idx >= 0) {
      relationList.value[idx].desc = newEdgeDesc.value.trim();
      relationList.value[idx].isNew = false;
      selectedEdge.value = relationList.value[idx];
    } else {
      relationList.value.push({
        relationship: edge.relationship,
        fromclass: edge.fromclass,
        toclass: edge.toclass,
        desc: newEdgeDesc.value.trim(),
        isNew: false,
        fromField: newEdgeFromField.value,
        toField: newEdgeToField.value,
      });
      selectedEdge.value = relationList.value[relationList.value.length - 1];
    }

    pendingEdge.value = null;
    edgeDialogVisible.value = false;
    renderNodes();
    message.success(t("hotData.relationCreated"));
  } catch (e: any) {
    message.error(e.message || t("hotData.relationCreateFailed"));
    if (pendingEdge.value) {
      handleCancelEdge();
    }
  }
}

function handleCancelEdge() {
  if (pendingEdge.value && graph) {
    graph.removeCell(pendingEdge.value);
    pendingEdge.value = null;
    if (editingEdge.value?.isNew) {
      relationList.value = relationList.value.filter(
        (r) => r.relationship !== editingEdge.value?.relationship
      );
    }
  }
  edgeDialogVisible.value = false;
}

function handlePencilEdge() {
  if (!editingEdge.value) return;

  const edge = editingEdge.value;
  const idx = relationList.value.findIndex((r) => r.relationship === edge.relationship);
  if (idx >= 0) {
    relationList.value[idx].desc = newEdgeDesc.value.trim();
    relationList.value[idx].fromField = newEdgeFromField.value;
    relationList.value[idx].toField = newEdgeToField.value;
    selectedEdge.value = relationList.value[idx];
    renderNodes();
    message.warning(t("hotData.relDescSaved"));
  }
  edgeDialogVisible.value = false;
}

function handleTrash2Edge() {
  if (!selectedEdge.value) return;

  const edgeToTrash2 = selectedEdge.value;
  confirm(
    t("hotData.deleteRelationConfirm", { name: edgeToTrash2.desc || edgeToTrash2.relationship }),
    t("common.deleteConfirm")
  )
    .then(async () => {
      try {
        await deleteOntologyRelation(edgeToTrash2.relationship);
        relationList.value = relationList.value.filter(
          (r) => r.relationship !== edgeToTrash2.relationship
        );
        selectedEdge.value = null;
        renderNodes();
        message.success(t("admin.deletedSuccess"));
      } catch (e: any) {
        message.error(e.message || t("admin.deleteFailed"));
      }
    })
    .catch(() => {});
}

function onZoomIn() {
  if (!graph) return;
  graph.zoom(0.2);
}

function onZoomOut() {
  if (!graph) return;
  graph.zoom(-0.2);
}

function onZoomFit() {
  if (!graph) return;
  graph.centerContent();
  graph.zoomToFit({ padding: 50, maxScale: 1 });
}

onMounted(() => {
  loadAdapterConfig();
  loadData();
});

onUnmounted(() => {
  if (graph) {
    graph.dispose();
    graph = null;
  }
});

function refreshGraphTheme() {
  if (graph) {
    const colors = getGraphColors();
    const dark = context.theme === "dark";
    graph.container.style.backgroundColor = dark ? "#0a0b16" : "var(--el-bg-color-page)";
    graph.container.style.backgroundImage = dark
      ? "radial-gradient(#3a4265 1px, transparent 1px)"
      : "radial-gradient(var(--el-border-color-dark) 1px, transparent 1px)";
    graph.container.style.backgroundSize = "18px 18px";

    graph.getNodes().forEach((node) => {
      const cls = classList.value.find((c) => c.className === node.id);
      const isSelected = selectedNode.value?.className === node.id;
      node.setAttrs({
        body: {
          fill: cls?.isNew ? colors.newFill : nodeColor(node.id),
          stroke: isSelected
            ? colors.selectedStroke
            : cls?.isNew
              ? colors.newStroke
              : colors.nodeStroke,
          strokeWidth: isSelected ? 6 : 5,
        },
        halo: {
          fill: "transparent",
          stroke: isSelected ? nodeHaloColor(cls, colors) : "transparent",
        },
        text: {
          fill: colors.nodeText,
        },
      });
      const ports = node.getPorts();
      ports.forEach((port: { id?: string }) => {
        if (port.id) {
          node.setPortProp(port.id, "attrs/circle/stroke", colors.portStroke);
          node.setPortProp(port.id, "attrs/circle/fill", colors.portFill);
        }
      });
    });

    graph.getEdges().forEach((edge) => {
      const rel = relationList.value.find((r) => r.relationship === edge.id);
      edge.setAttrs({
        line: {
          stroke: rel?.isNew ? colors.newStroke : colors.edgeStroke,
        },
      });
      const labels = edge.getLabels();
      if (labels.length > 0) {
        edge.setLabels(
          labels.map((label: any) => ({
            ...label,
            attrs: {
              text: {
                fill: colors.edgeLabelFill,
              },
              rect: {
                fill: colors.edgeLabelBg,
                stroke: rel?.isNew ? colors.newStroke : colors.edgeLabelStroke,
              },
            },
          }))
        );
      }
    });
  }
}

watch(() => context.theme, refreshGraphTheme);

watch(
  () => [props.focus, props.focusId],
  () => applyRouteFocus()
);

async function saveAttrDesc(cls: ClassDef, prop: AttrDef) {
  try {
    await updateOntologyAttribute(cls.className, prop, {
      attrDesc: prop.attrDesc,
      enable: prop.enable,
    });
    message.success(t("hotData.attrDescSaved"));
  } catch {
    message.error(t("hotData.attrDescSaveFailed"));
  }
}

function onAttrShowNameFocus(cls: ClassDef, prop: AttrDef) {
  const key = `${cls.className}_${prop.name}`;
  originalAttrShowNameMap.value[key] = prop.showName || "";
}

function onAttrShowNameBlur(cls: ClassDef, prop: AttrDef) {
  const key = `${cls.className}_${prop.name}`;
  const prev = (originalAttrShowNameMap.value[key] || "").trim();
  const curr = (prop.showName || "").trim();
  if (curr === prev) return;
  saveAttrShowName(cls, prop);
}

async function saveAttrShowName(cls: ClassDef, prop: AttrDef) {
  try {
    await updateOntologyAttribute(cls.className, prop, { showName: prop.showName || "" });
    message.success(t("hotData.attrShowNameSaved"));
  } catch {
    message.error(t("hotData.attrShowNameSaveFailed"));
  }
}

async function onAttrEnableChange(cls: ClassDef, prop: AttrDef) {
  try {
    await updateOntologyAttribute(cls.className, prop, {
      attrDesc: prop.attrDesc,
      enable: prop.enable,
    });
    message.success(`${prop.name} ${prop.enable ? t("common.enabled") : t("common.disabled")}`);
  } catch {
    prop.enable = !prop.enable;
    message.error(t("hotData.enableSaveFailed"));
  }
}

async function onAttrBizKeyChange(cls: ClassDef, prop: AttrDef) {
  const shouldReturn = !!prop.bizzkeyBool;
  try {
    await updateOntologyAttribute(cls.className, prop, { bizzkeyBool: shouldReturn });
    prop.bizzkey = String(shouldReturn);
    message.success(shouldReturn ? t("hotData.mustReturnSet") : t("hotData.mustReturnUnset"));
  } catch {
    prop.bizzkeyBool = !prop.bizzkeyBool;
    message.error(t("hotData.bizzkeySaveFailed"));
  }
}

function onClassShowNameFocus(cls: ClassDef) {
  originalClassShowName.value = cls.showName || "";
}

function onClassShowNameBlur(cls: ClassDef) {
  const prev = (originalClassShowName.value || "").trim();
  const curr = (cls.showName || "").trim();
  if (curr === prev) return;
  saveClassShowName(cls);
}

async function saveClassShowName(cls: ClassDef) {
  try {
    await updateOntologyObject(cls.className, { showName: cls.showName || "" });
    message.success(t("hotData.classShowNameSaved"));
    if (graph) {
      const node = graph.getCellById(cls.className);
      if (node) {
        node.setAttrs({
          text: {
            text: cls.showName || cls.className,
          },
        });
      }
    }
  } catch {
    message.error(t("hotData.classShowNameSaveFailed"));
  }
}

function closeRightPanel() {
  rightPanelVisible.value = false;
  clearSelection();
}

function updateSelectedNodeField(cls: ClassDef, field: "showName" | "classDesc", value: string) {
  cls[field] = value;
}

function updateSelectedAttrField(
  attr: AttrDef,
  field: "showName" | "attrDesc" | "enable" | "bizzkeyBool",
  value: string | boolean
) {
  if (field === "enable" || field === "bizzkeyBool") {
    attr[field] = Boolean(value);
  } else {
    attr[field] = String(value);
  }
}

function updateEditingEdgeField(field: "fromclass" | "toclass", value: string) {
  if (!editingEdge.value) return;
  editingEdge.value[field] = value;
}

async function saveClassDesc(cls: ClassDef) {
  try {
    await updateOntologyObject(cls.className, { classDesc: cls.classDesc });
    message.success(t("hotData.classDescSaved"));
  } catch {
    message.error(t("hotData.classDescSaveFailed"));
  }
}
</script>

<template>
  <div class="visual-modeling">
    <div class="toolbar">
      <div class="toolbar-group toolbar-group-primary">
        <el-button v-if="backToPlayground" :icon="ArrowLeft" @click="emit('back')">
          {{ ot("backToGraph") }}
        </el-button>
        <el-button type="primary" :icon="Box" @click="openAddNodeDialog">
          {{ t("hotData.addClass") }}
        </el-button>
        <el-button :icon="Link2" @click="openAddEdgeDialog">
          {{ t("hotData.addRelation") }}
        </el-button>
      </div>

      <div class="zoom-controls">
        <el-button :icon="Minus" :title="ot('zoomOut')" @click="onZoomOut" />
        <el-button :icon="Plus" :title="ot('zoomIn')" @click="onZoomIn" />
        <el-button :icon="Maximize2" :title="ot('fitCanvas')" @click="onZoomFit" />
      </div>

      <div class="selection-cluster">
        <div class="selection-info">
          <el-tag v-if="selectedNode" type="primary">
            {{ t("hotData.selected") }} {{ selectedNode.showName }}
          </el-tag>
          <el-tag v-else-if="selectedEdge" type="success">
            {{ t("hotData.selectedRel") }} {{ selectedEdge.desc || t("hotData.newRelation") }}
          </el-tag>
        </div>
        <div class="toolbar-group toolbar-group-selection">
          <el-button
            :icon="Pencil"
            :disabled="!selectedNode && !selectedEdge"
            @click="
              selectedNode
                ? openPencilNodeDialog(selectedNode)
                : selectedEdge
                  ? openPencilEdgeDialog(selectedEdge)
                  : undefined
            "
          >
            {{ t("common.edit") }}
          </el-button>
          <el-button
            type="danger"
            :icon="Trash2"
            :disabled="!selectedNode && !selectedEdge"
            @click="selectedNode ? handleTrash2Node() : handleTrash2Edge()"
          >
            {{ t("common.delete") }}
          </el-button>
        </div>
      </div>
    </div>

    <div class="main-content">
      <div v-loading="loading" class="graph-container">
        <div ref="graphRef" class="graph-canvas"></div>
      </div>

      <VisualModelingRightPanel
        v-if="rightPanelVisible && selectedNode"
        :selected-node="selectedNode"
        @close="closeRightPanel"
        @update-class-field="updateSelectedNodeField"
        @update-attr-field="updateSelectedAttrField"
        @class-show-name-focus="onClassShowNameFocus"
        @class-show-name-blur="onClassShowNameBlur"
        @save-class-desc="saveClassDesc"
        @attr-enable-change="onAttrEnableChange"
        @attr-biz-key-change="onAttrBizKeyChange"
        @attr-show-name-focus="onAttrShowNameFocus"
        @attr-show-name-blur="onAttrShowNameBlur"
        @save-attr-desc="saveAttrDesc"
        @create-attr="openAddAttrDialog"
      />
    </div>

    <VisualModelingDialogs
      v-model:node-visible="nodeDialogVisible"
      v-model:edge-visible="edgeDialogVisible"
      v-model:new-node-name="newNodeName"
      v-model:new-node-show-name="newNodeShowName"
      v-model:new-node-desc="newNodeDesc"
      v-model:new-node-primary-key="newNodePrimaryKey"
      v-model:new-edge-desc="newEdgeDesc"
      v-model:new-edge-from-field="newEdgeFromField"
      v-model:new-edge-to-field="newEdgeToField"
      :editing-node="editingNode"
      :editing-edge="editingEdge"
      :class-list="classList"
      :show-join-fields="showJoinFields"
      @update-edge-field="updateEditingEdgeField"
      @add-node="handleAddNode"
      @pencil-node="handlePencilNode"
      @add-edge="handleAddEdge"
      @pencil-edge="handlePencilEdge"
      @cancel-edge="handleCancelEdge"
    />

    <VisualModelingAttributeDialog
      v-model="attrDialogVisible"
      :owner="attrOwner"
      :saving="attrSaving"
      @create="handleAddAttr"
    />
  </div>
</template>

<style scoped>
.visual-modeling {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  flex-wrap: wrap;
}

.toolbar :deep(.el-button) {
  white-space: nowrap;
  flex-shrink: 0;
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.toolbar-group + .zoom-controls {
  margin-left: var(--spacing-sm);
  padding-left: var(--spacing-md);
  border-left: 1px solid var(--el-border-color);
}

.zoom-controls {
  display: flex;
  gap: var(--spacing-xs);
  margin-left: var(--spacing-sm);
  padding-left: var(--spacing-sm);
  border-left: 1px solid var(--el-border-color);
}

.selection-cluster {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.selection-info {
  display: flex;
  align-items: center;
}

.main-content {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.graph-container {
  flex: 1;
  min-width: 0;
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color-dark) 1px, transparent 1px);
  background-size: 18px 18px;
  position: relative;
}

.ontology-manager.is-dark .graph-container {
  background-color: #0a0b16;
  background-image: radial-gradient(#3a4265 1px, transparent 1px);
}

.graph-canvas {
  width: 100%;
  height: 100%;
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color-dark) 1px, transparent 1px);
  background-size: 18px 18px;
}

.ontology-manager.is-dark .graph-canvas {
  background-color: #0a0b16;
  background-image: radial-gradient(#3a4265 1px, transparent 1px);
}

.graph-canvas :deep(.x6-graph),
.graph-canvas :deep(.x6-graph-background),
.graph-canvas :deep(.x6-graph-grid),
.graph-canvas :deep(.x6-graph-svg),
.graph-canvas :deep(.x6-graph-scroller) {
  background-color: transparent !important;
  background-image: inherit !important;
  background-size: 18px 18px !important;
}

.graph-canvas :deep(.x6-graph-background rect) {
  fill: transparent !important;
}

@container ontology-manager (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-group,
  .zoom-controls,
  .selection-cluster {
    margin-left: 0 !important;
    padding-left: 0 !important;
    border-left: 0 !important;
  }

  .selection-cluster {
    justify-content: space-between;
  }

  .toolbar .el-input,
  .toolbar .el-select {
    width: 100%;
  }
}

@container ontology-manager (max-width: 900px) {
  .main-content {
    flex-direction: column;
    overflow: auto;
  }

  .graph-container {
    min-height: 360px;
    flex: 1 0 360px;
  }

  .right-panel {
    width: 100%;
    max-height: 46cqh;
    border-top: 1px solid var(--el-border-color);
    border-left: 0;
  }
}

@container ontology-manager (max-width: 768px) {
  .operation-cell .el-button + .el-button {
    margin-left: 0;
  }
}
</style>
