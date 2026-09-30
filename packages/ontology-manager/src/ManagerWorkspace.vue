<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ManagerAuthFailureStatus } from "./api";
import { provideManagerContext, type ManagerHostContext } from "./context";
import { sharedText, type SharedKey } from "./i18n";
import { provideManagerFeedback } from "./feedback";
import ManagerConfirmDialog from "./ManagerConfirmDialog.vue";
import BusinessKnowledge from "./components/BusinessKnowledge.vue";
import DataBrowser from "./data-browser/DataBrowser.vue";
import VisualModeling from "./visual-modeling/VisualModeling.vue";
import OntologyAssetCatalog from "./components/OntologyAssetCatalog.vue";
import OntologyAssetDetail from "./components/OntologyAssetDetail.vue";
import OntologyContentHeader from "./components/OntologyContentHeader.vue";
import OntologyModelCatalog from "./components/OntologyModelCatalog.vue";
import OntologyPlayground from "./components/OntologyPlayground.vue";
import OntologyObjectCreateDialog from "./components/OntologyObjectCreateDialog.vue";
import OntologyObjectDetail from "./components/OntologyObjectDetail.vue";
import OntologyAttributeDetail from "./components/OntologyAttributeDetail.vue";
import OntologyRelationDetail from "./components/OntologyRelationDetail.vue";
import OntologyResourceSidebar from "./components/OntologyResourceSidebar.vue";
import OntologyWorkspaceHeader from "./components/OntologyWorkspaceHeader.vue";
import {
  emptyOntologyResourceCounts,
  type AssetTab,
  type ModelResource,
  type OntologyResourceCounts,
  type Workspace,
} from "./workspace";
import type { SmartAsset } from "./api";

const props = defineProps<{ context: Readonly<ManagerHostContext> }>();
const emit = defineEmits<{
  navigate: [view: string];
  "auth-failure": [status: ManagerAuthFailureStatus];
}>();
/*
 * This workspace instance owns the request client and messages/confirmations. The root component rebuilds the workspace
 * when the host changes API entry or credential; on unmount the client stops sending, confirmations end as cancelled and messages close.
 */
const context = props.context;
const { loadOntology, loadSmartAssets } = provideManagerContext(context, (status) =>
  emit("auth-failure", status)
);
const shell = ref<HTMLElement>();
provideManagerFeedback(shell);
const t = (key: SharedKey) => sharedText(context.messages, key);
/** The host-supplied view replaces the original hash routing: the path locates the workspace and resource, the query carries from/focus/id/back. */
const route = computed(() => {
  const [path, query = ""] = context.view.split("?");
  return { path, query: new URLSearchParams(query) };
});
const activeWorkspace = ref<Workspace>("playground");
const activeAssetTab = ref<AssetTab>("metrics");
const activeModelResource = ref<ModelResource>("objects");
const resourceCounts = ref<OntologyResourceCounts>(emptyOntologyResourceCounts());
const selectedAsset = ref<SmartAsset | null>(null);
const isAssetCreating = ref(false);
const selectedObjectClass = ref("");
const selectedAttribute = ref<{ className: string; attributeName: string } | null>(null);
const selectedRelation = ref("");
const objectCreateVisible = ref(false);
const browserObjectClass = ref("");
const objectLabels = ref<Record<string, string>>({});

function queryString(params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return query.toString() ? `?${query.toString()}` : "";
}

function resourcePath(resource: ModelResource) {
  if (resource === "attributes") return "/attributes";
  if (resource === "relations") return "/relations";
  return "/objects";
}

function navigate(path: string) {
  emit("navigate", path);
}

function changeWorkspace(workspace: Workspace) {
  if (workspace === "browser") {
    navigate(
      browserObjectClass.value ? `/data/${encodeURIComponent(browserObjectClass.value)}` : "/data"
    );
    return;
  }
  if (workspace === "assets") {
    navigate(`/assets/${activeAssetTab.value}`);
    return;
  }
  if (workspace === "playground") {
    navigate("/playground");
    return;
  }
  if (workspace === "visual-modeling") {
    navigate("/visual-modeling");
    return;
  }
  navigate(resourcePath(activeModelResource.value));
}

function applyRouteState() {
  const segments = route.value.path.split("/").filter(Boolean).map(decodeURIComponent);
  const [section, first, second] = segments;

  selectedObjectClass.value = "";
  selectedAttribute.value = null;
  selectedRelation.value = "";
  selectedAsset.value = null;
  isAssetCreating.value = false;

  if (section === "objects") {
    activeWorkspace.value = "model";
    activeModelResource.value = "objects";
    selectedObjectClass.value = first || "";
    return;
  }
  if (section === "attributes") {
    activeWorkspace.value = "model";
    activeModelResource.value = "attributes";
    if (first && second) selectedAttribute.value = { className: first, attributeName: second };
    return;
  }
  if (section === "relations") {
    activeWorkspace.value = "model";
    activeModelResource.value = "relations";
    selectedRelation.value = first || "";
    return;
  }
  if (
    section === "assets" &&
    first &&
    ["metrics", "actions", "functions", "tasks"].includes(first)
  ) {
    activeWorkspace.value = "assets";
    activeAssetTab.value = first as AssetTab;
    if (second === "new") {
      isAssetCreating.value = true;
    } else if (second) {
      selectedAsset.value = { id: second, name: second };
    }
    return;
  }
  if (section === "data") {
    activeWorkspace.value = "browser";
    browserObjectClass.value = first || "";
    return;
  }
  if (section === "playground") {
    activeWorkspace.value = "playground";
    return;
  }
  if (section === "visual-modeling") {
    activeWorkspace.value = "visual-modeling";
    return;
  }
  if (section === "knowledge") {
    activeWorkspace.value = "knowledge";
    return;
  }
  if (section === "admin" && first === "ontology" && second === "visual-modeling") {
    activeWorkspace.value = "visual-modeling";
    navigate("/visual-modeling");
    return;
  }
  activeWorkspace.value = "playground";
  if (route.value.path !== "/playground") navigate("/playground");
}

function openModelResource(resource: ModelResource) {
  navigate(resourcePath(resource));
}

function createObjectType() {
  objectCreateVisible.value = true;
}

function editObjectType(className: string) {
  navigate(`/objects/${encodeURIComponent(className)}`);
}

function editAttribute(
  className: string,
  attributeName: string,
  source: "catalog" | "object" = "catalog"
) {
  navigate(
    `/attributes/${encodeURIComponent(className)}/${encodeURIComponent(attributeName)}${queryString(
      { from: source }
    )}`
  );
}

function editRelation(relationship: string, source: "catalog" | "object" = "catalog") {
  navigate(`/relations/${encodeURIComponent(relationship)}${queryString({ from: source })}`);
}

function openObjectDetail(className: string) {
  navigate(`/objects/${encodeURIComponent(className)}`);
}

function openObjectData(className: string) {
  navigate(`/data/${encodeURIComponent(className)}`);
}

function returnToModelCatalog() {
  if (route.value.query.get("from") === "object" && selectedAttribute.value) {
    navigate(`/objects/${encodeURIComponent(selectedAttribute.value.className)}`);
    void loadResourceCounts();
    return;
  }
  if (route.value.query.get("from") === "object" && selectedRelation.value) {
    void loadOntology().then((ontology) => {
      const relation = ontology.relations.find(
        (item) => item.relationship === selectedRelation.value
      );
      if (relation) navigate(`/objects/${encodeURIComponent(relation.fromclass)}`);
      else navigate(resourcePath(activeModelResource.value));
      void loadResourceCounts();
    });
    return;
  }
  navigate(resourcePath(activeModelResource.value));
  void loadResourceCounts();
}

function editObjectAttribute(className: string, attributeName: string) {
  editAttribute(className, attributeName, "object");
}

function editObjectRelation(relationship: string) {
  editRelation(relationship, "object");
}

function handleObjectCreated(className: string) {
  void loadResourceCounts();
  navigate(`/objects/${encodeURIComponent(className)}`);
}

function openAsset(kind: AssetTab) {
  navigate(`/assets/${kind}`);
}

function openAssetDetail(asset: SmartAsset) {
  if (!asset.id) return;
  navigate(`/assets/${activeAssetTab.value}/${encodeURIComponent(asset.id)}`);
}

function createAsset() {
  navigate(`/assets/${activeAssetTab.value}/new`);
}

function returnToAssetCatalog() {
  navigate(`/assets/${activeAssetTab.value}`);
  void loadResourceCounts();
}

/*
 * The host's view is the only source of location: an embedding system can open a resource directly and decides whether to write the address bar and history.
 */
watch(
  () => context.view,
  () => applyRouteState(),
  { immediate: true }
);

function openVisualModeling() {
  changeWorkspace("visual-modeling");
}

function openPlayground() {
  changeWorkspace("playground");
}

function openKnowledge() {
  navigate("/knowledge");
}

function openModelingFocus(focus: "object" | "relation", id: string) {
  navigate(`/visual-modeling${queryString({ focus, id, back: "playground" })}`);
}

async function loadResourceCounts() {
  const [ontology, metrics, actions, functions, tasks] = await Promise.allSettled([
    loadOntology(),
    loadSmartAssets("metrics"),
    loadSmartAssets("actions"),
    loadSmartAssets("functions"),
    loadSmartAssets("tasks"),
  ]);

  if (ontology.status === "fulfilled") {
    objectLabels.value = Object.fromEntries(
      ontology.value.objects.map((object) => [object.className, object.showName])
    );
    resourceCounts.value.objects = ontology.value.objects.length;
    resourceCounts.value.attributes = ontology.value.objects.reduce(
      (total, object) => total + object.attrs.length,
      0
    );
    resourceCounts.value.relations = ontology.value.relations.length;
  }
  if (metrics.status === "fulfilled") resourceCounts.value.metrics = metrics.value.length;
  if (actions.status === "fulfilled") resourceCounts.value.actions = actions.value.length;
  if (functions.status === "fulfilled") resourceCounts.value.functions = functions.value.length;
  if (tasks.status === "fulfilled") resourceCounts.value.tasks = tasks.value.length;
}

const workspaceTitle = computed(() => {
  if (activeWorkspace.value === "browser") {
    const objectLabel = objectLabels.value[browserObjectClass.value];
    return {
      title: objectLabel ? `${t("nav.dataBrowser")} / ${objectLabel}` : t("nav.dataBrowser"),
      description: context.presentation.dataBrowserDescription(objectLabel),
    };
  }
  if (activeWorkspace.value === "assets") {
    return {
      title: t("nav.intelligenceAssets"),
      description: "",
    };
  }
  if (activeWorkspace.value === "playground") {
    return { title: t("nav.ontologyGraph"), description: "" };
  }
  if (activeWorkspace.value === "visual-modeling") {
    return { title: t("nav.visualModeling"), description: "" };
  }
  if (activeWorkspace.value === "knowledge") {
    return { title: t("nav.businessKnowledge"), description: "" };
  }
  return { title: t("nav.ontologyModeling"), description: "" };
});

onMounted(() => {
  void loadResourceCounts();
});
</script>

<template>
  <main ref="shell" class="ontology-manager-shell">
    <OntologyWorkspaceHeader v-if="!context.embedded" @home="changeWorkspace('playground')" />

    <div class="workspace">
      <OntologyResourceSidebar
        :active-workspace="activeWorkspace"
        :active-asset-tab="activeAssetTab"
        :active-model-resource="activeModelResource"
        :counts="resourceCounts"
        @workspace="changeWorkspace"
        @model-resource="openModelResource"
        @asset="openAsset"
        @visual-modeling="openVisualModeling"
        @playground="openPlayground"
        @knowledge="openKnowledge"
      />

      <section class="content-area">
        <OntologyContentHeader
          v-if="activeWorkspace === 'browser'"
          :workspace="activeWorkspace"
          :title="workspaceTitle.title"
          :description="workspaceTitle.description"
          @browse="changeWorkspace('browser')"
        />
        <section v-if="activeWorkspace === 'model'" class="model-surface">
          <OntologyModelCatalog
            v-if="!selectedObjectClass && !selectedAttribute && !selectedRelation"
            :resource="activeModelResource"
            @create-object="createObjectType"
            @edit-object="editObjectType"
            @edit-attribute="editAttribute"
            @edit-relation="editRelation"
          />
          <OntologyObjectDetail
            v-else-if="selectedObjectClass"
            :class-name="selectedObjectClass"
            @back="returnToModelCatalog"
            @updated="loadResourceCounts"
            @browse="openObjectData"
            @attribute="editObjectAttribute"
            @relation="editObjectRelation"
          />
          <OntologyAttributeDetail
            v-else-if="selectedAttribute"
            :class-name="selectedAttribute.className"
            :attribute-name="selectedAttribute.attributeName"
            @back="returnToModelCatalog"
            @updated="loadResourceCounts"
            @object="openObjectDetail"
          />
          <OntologyRelationDetail
            v-else-if="selectedRelation"
            :relationship="selectedRelation"
            @back="returnToModelCatalog"
            @updated="loadResourceCounts"
            @object="openObjectDetail"
          />
        </section>
        <section v-else-if="activeWorkspace === 'browser'" class="legacy-surface">
          <DataBrowser :initial-class="browserObjectClass" />
        </section>
        <section v-else-if="activeWorkspace === 'assets'" class="asset-surface">
          <OntologyAssetCatalog
            v-if="!selectedAsset && !isAssetCreating"
            :kind="activeAssetTab"
            @select="openAssetDetail"
            @create="createAsset"
          />
          <OntologyAssetDetail
            v-else
            :kind="activeAssetTab"
            :asset="selectedAsset"
            :creating="isAssetCreating"
            @back="returnToAssetCatalog"
            @saved="loadResourceCounts"
            @created="loadResourceCounts"
          />
        </section>
        <section v-else-if="activeWorkspace === 'visual-modeling'" class="visual-content">
          <VisualModeling
            :focus="route.query.get('focus') || ''"
            :focus-id="route.query.get('id') || ''"
            :back-to-playground="route.query.get('back') === 'playground'"
            @back="openPlayground"
          />
        </section>
        <section v-else-if="activeWorkspace === 'knowledge'" class="knowledge-surface">
          <BusinessKnowledge />
        </section>
        <OntologyPlayground v-else class="playground-surface" @open-modeling="openModelingFocus" />
      </section>
    </div>
    <OntologyObjectCreateDialog v-model="objectCreateVisible" @created="handleObjectCreated" />
    <ManagerConfirmDialog />
  </main>
</template>

<style scoped>
.ontology-manager-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-bg-color);
}
.workspace {
  display: flex;
  min-height: 0;
  flex: 1;
}
.content-area {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-bg-color);
}
.model-surface {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
.asset-surface {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
.asset-surface {
  display: flex;
  flex-direction: column;
}
.legacy-surface {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.legacy-surface :deep(.model-designer) {
  min-height: 100%;
}
.legacy-surface :deep(.data-browser) {
  min-height: 100%;
}
.assets-content {
  display: flex;
  flex-direction: column;
}
.visual-content {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.knowledge-surface {
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
}
.visual-content :deep(.visual-modeling) {
  background: var(--el-bg-color);
}
.visual-content :deep(.toolbar) {
  min-height: 64px;
  height: auto;
  margin: 0 !important;
  padding: 0 var(--spacing-2xl) !important;
  border: 0 !important;
  border-bottom: 1px solid var(--el-border-color) !important;
  border-radius: 0 !important;
  background: var(--el-bg-color) !important;
}
.visual-content :deep(.zoom-controls) {
  margin-left: var(--spacing-xs);
  padding-left: var(--spacing-md);
}
.visual-content :deep(.selection-info) {
  min-height: 32px;
}
.visual-content :deep(.graph-container) {
  background: var(--el-bg-color);
}
.playground-surface {
  min-height: 0;
  flex: 1;
}
@container ontology-manager (max-width: 900px) {
  .legacy-surface {
    padding: var(--spacing-md);
  }
  .visual-content :deep(.toolbar) {
    align-items: stretch !important;
    padding: var(--spacing-md) !important;
  }
}
</style>
