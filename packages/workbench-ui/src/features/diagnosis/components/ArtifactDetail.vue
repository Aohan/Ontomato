<script setup lang="ts">
import type {
  WorkspaceManifest as ArtifactManifest,
  ArtifactFileTreeNode as FileTreeNode,
  ArtifactFilePreview as FilePreviewPayload,
  WorkspaceBackendSessionEvidence,
} from "@ontomato/contracts/observe";
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { authHost } from "../../../utils/auth";
import { ArtifactNotFoundError, diagnosisApi } from "../api";
import { formatRelativeTime } from "../../../utils/relative-time";
import FilePreview from "./FilePreview.vue";
import ArtifactRetentionButton from "./ArtifactRetentionButton.vue";
import { FileText, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

const props = defineProps<{
  /** API endpoint prefix for manifest / tree / files / download requests */
  apiPrefix: string;
  /** Optional title displayed in the header */
  title?: string;
  /** POST body for the on-demand build request */
  triggerBuildBody?: Record<string, unknown>;
  /** POST endpoint for the on-demand workspace build request */
  triggerBuildUrl?: string;
  /** Optional user question to display as main title (overrides manifest.question) */
  question?: string;
  /** Optional subtitle text (e.g. sessionId info) */
  subtitle?: string;
  kept?: boolean;
  retentionLoading?: boolean;
}>();

const emit = defineEmits<{
  loaded: [];
  "toggle-retention": [];
}>();

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const recollecting = ref(false);
const loading = ref(false);
const notFound = ref(false);
const manifest = ref<ArtifactManifest | null>(null);
const fileTree = ref<FileTreeNode[]>([]);
const selectedFile = ref<FileTreeNode | null>(null);
const filePreview = ref<FilePreviewPayload | null>(null);
const filePreviewComponent = ref<InstanceType<typeof FilePreview> | null>(null);
const fileError = ref("");
const fileLoading = ref(false);
const lastPostProcessMessageKey = ref("");

/* ------------------------------------------------------------------ */
/*  Computed display values                                            */
/* ------------------------------------------------------------------ */

/** Main display title: question prop > manifest.question > title prop */
const displayTitle = computed(() => {
  const question = props.question || manifest.value?.question;
  return question ? compactText(question, 24) : props.title || undefined;
});

/**
 * When a session is cancelled on one or more nodes, the earliest cancellation time is used; cancellation only comes
 * from routing rows, not from a separate diagnostic event (backend session location and cancellation, design 9).
 * Old workspace manifests are not migrated (design "not doing"), so old rows without nodes show the session but no cancellation.
 */
const { largeFilePreview } = workbenchContent().text.observe;

function earliestCancelledAt(session: WorkspaceBackendSessionEvidence): number | undefined {
  const times = (session.nodes ?? [])
    .map((node) => node.cancelledAt)
    .filter((value): value is number => value !== undefined);
  return times.length > 0 ? Math.min(...times) : undefined;
}

/** Subtitle items: turnKey and one badge per backend session, shown as small monospace badges */
const subtitleParts = computed(() => {
  const parts: Array<{ label: string; value: string }> = [];
  const turnKey = manifest.value?.turnKey || props.title;
  if (turnKey) {
    parts.push({ label: manifest.value?.turnKey ? "turnKey" : "id", value: turnKey });
  }
  if (manifest.value?.requestSeq !== undefined) {
    parts.push({ label: "seq", value: String(manifest.value.requestSeq) });
  }
  for (const session of manifest.value?.backendSessions ?? []) {
    parts.push({ label: session.branch, value: session.sessionId });
    const cancelledAt = earliestCancelledAt(session);
    if (cancelledAt !== undefined) {
      parts.push({ label: workbenchContent().text.observe.cancelled, value: formatRelativeTime(cancelledAt) });
    }
  }
  if (props.subtitle) {
    parts.push({ label: "", value: props.subtitle });
  }
  return parts;
});

const postProcessAlert = computed(() => {
  const status = manifest.value?.postProcess;
  if (!status || status.severity === "info" || status.status === "ok") return null;
  return {
    type: status.severity === "error" || status.status === "error" ? "error" : "warning",
    message: status.message || t("diagnosis.evidenceMissingFallback"),
  } as const;
});

const selectedFileSize = computed(() => filePreview.value?.size ?? selectedFile.value?.size);

const previewSupportsSearch = computed(() => {
  const filename = selectedFile.value?.name.toLowerCase();
  return Boolean(filename && !filename.endsWith(".csv") && !filename.endsWith(".tsv"));
});

/* ------------------------------------------------------------------ */
/*  Resizable Split                                                    */
/* ------------------------------------------------------------------ */

const splitContainer = ref<HTMLElement | null>(null);
const leftWidth = ref(260);
const isDragging = ref(false);

function onDragStart(e: MouseEvent) {
  e.preventDefault();
  isDragging.value = true;
  const startX = e.clientX;
  const startW = leftWidth.value;

  function onMove(ev: MouseEvent) {
    const containerW = splitContainer.value?.clientWidth || 800;
    const newW = Math.max(200, Math.min(containerW - 300, startW + ev.clientX - startX));
    leftWidth.value = newW;
  }

  function onUp() {
    isDragging.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ------------------------------------------------------------------ */
/*  Loaders                                                            */
/* ------------------------------------------------------------------ */

async function loadAll(prefix: string) {
  loading.value = true;
  notFound.value = false;
  selectedFile.value = null;
  filePreview.value = null;
  fileError.value = "";
  try {
    // Load manifest and file tree in parallel
    const [manifestData, treeData] = await Promise.all([
      diagnosisApi.getArtifactManifest(prefix).catch((e) => {
        if (e instanceof ArtifactNotFoundError) return null;
        throw e;
      }),
      diagnosisApi.getArtifactTree(prefix).catch((e) => {
        if (e instanceof ArtifactNotFoundError) return null;
        throw e;
      }),
    ]);

    // If both manifest and tree are empty, treat as not found
    if (!manifestData && !treeData) {
      notFound.value = true;
      manifest.value = null;
      fileTree.value = [];
      return;
    }

    manifest.value = normalizeManifest(manifestData);
    emit("loaded");
    showPostProcessMessage();

    // tree API returns either a root node (with children) or array
    if (treeData) {
      if (Array.isArray(treeData)) {
        fileTree.value = treeData;
      } else if (treeData.children) {
        fileTree.value = treeData.children;
      } else {
        fileTree.value = [treeData];
      }
    } else {
      fileTree.value = [];
    }
  } catch {
    notFound.value = true;
    manifest.value = null;
    fileTree.value = [];
  } finally {
    loading.value = false;
  }
}

async function previewFile(node: FileTreeNode) {
  if (node.type !== "file") return;
  selectedFile.value = node;
  filePreview.value = null;
  fileError.value = "";
  fileLoading.value = true;
  try {
    filePreview.value = await fetchFilePreview(node.path);
  } catch {
    fileError.value = workbenchContent().text.observe.fileLoadFailed;
  } finally {
    fileLoading.value = false;
  }
}

function fetchFilePreview(filePath: string): Promise<FilePreviewPayload> {
  return diagnosisApi.getArtifactFile(props.apiPrefix, encodeArtifactRelativePath(filePath));
}

function openPreviewSearch() {
  filePreviewComponent.value?.openSearch();
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusTagType(s?: string) {
  if (s === "completed" || s === "success") return "success" as const;
  if (s === "failed" || s === "error") return "danger" as const;
  return "info" as const;
}

function normalizeManifest(data: unknown): ArtifactManifest | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as { manifest?: ArtifactManifest };
  return obj.manifest && typeof obj.manifest === "object"
    ? obj.manifest
    : (data as ArtifactManifest);
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength) + "...";
}

function formatDuration(ms?: number) {
  if (ms == null) return "";
  return (ms / 1000).toFixed(1) + "s";
}

function formatBytes(bytes?: number) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function encodeArtifactRelativePath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function downloadArtifact() {
  const tk = authHost().getToken() || "";
  window.open(diagnosisApi.artifactDownloadUrl(props.apiPrefix, tk), "_blank");
}

function showPostProcessMessage() {
  const alert = postProcessAlert.value;
  if (!alert) return;

  const key = `${props.apiPrefix}:${alert.type}:${alert.message}`;
  if (key === lastPostProcessMessageKey.value) return;
  lastPostProcessMessageKey.value = key;

  ElMessage({
    type: alert.type,
    message: alert.message,
    showClose: true,
    duration: 4000,
  });
}

async function recollect() {
  if (!props.triggerBuildUrl || recollecting.value) return;
  recollecting.value = true;
  lastPostProcessMessageKey.value = "";
  try {
    await diagnosisApi.rebuildArtifact(props.triggerBuildUrl, {
      ...props.triggerBuildBody,
      force: true,
    });
    await loadAll(props.apiPrefix);
  } catch (e: any) {
    ElMessage.error(e?.message || t("diagnosis.workspaceBuildFailed"));
  } finally {
    recollecting.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

watch(
  () => props.apiPrefix,
  (prefix) => {
    lastPostProcessMessageKey.value = "";
    if (prefix) loadAll(prefix);
  },
  { immediate: true }
);
</script>

<template>
  <div
    ref="splitContainer"
    v-loading="loading"
    class="artifact-detail"
    :class="{ dragging: isDragging }"
  >
    <!-- Not Found / Empty State -->
    <div v-if="notFound && !loading" class="artifact-empty-state">
      <div class="empty-icon">
        <FileText :size="48" :stroke-width="1.5" />
      </div>
      <p class="empty-title">No artifacts found</p>
      <p class="empty-hint">
        Artifacts have not been generated yet or the specified resource does not exist.
      </p>
    </div>

    <!-- Artifact Content -->
    <template v-else-if="!loading">
      <!-- Header -->
      <div class="artifact-detail-header">
        <div class="artifact-detail-header-info">
          <div class="artifact-detail-header-title-row">
            <span v-if="displayTitle" class="artifact-detail-title artifact-detail-title--question">
              {{ displayTitle }}
            </span>
            <span v-else-if="title" class="artifact-detail-title">{{ title }}</span>
            <el-tag v-if="manifest?.status" :type="statusTagType(manifest.status)" size="small">
              {{ manifest.status }}
            </el-tag>
            <span v-if="manifest?.createdAt" class="artifact-detail-meta">
              {{ formatRelativeTime(manifest.createdAt) }}
            </span>
            <span v-if="manifest?.durationMs" class="artifact-detail-meta">
              {{ formatDuration(manifest.durationMs) }}
            </span>
          </div>
          <div
            v-if="displayTitle && subtitleParts.length > 0"
            class="artifact-detail-header-subtitle"
          >
            <template v-for="(part, idx) in subtitleParts" :key="idx">
              <span class="artifact-detail-subtitle-item">
                <span v-if="part.label" class="artifact-detail-subtitle-label">
                  {{ part.label }}:
                </span>
                {{ part.value }}
              </span>
            </template>
          </div>
        </div>
        <div class="artifact-detail-header-spacer" />
        <ArtifactRetentionButton
          :kept="kept"
          :loading="retentionLoading"
          @toggle="emit('toggle-retention')"
        />
        <el-button
          v-if="triggerBuildUrl"
          type="warning"
          size="small"
          :loading="recollecting"
          @click="recollect"
        >
          {{ t("common.recollect") }}
        </el-button>
        <el-button type="primary" size="small" @click="downloadArtifact">
          {{ t("common.download") }}
        </el-button>
      </div>
      <!-- Body: split -->
      <div class="artifact-detail-body">
        <!-- Left: file tree -->
        <div class="artifact-detail-tree-panel" :style="{ width: leftWidth + 'px' }">
          <div v-if="fileTree.length === 0 && !loading" class="artifact-detail-tree-empty">
            <span class="artifact-detail-tree-empty-text">No files</span>
          </div>
          <el-tree
            v-else
            :data="fileTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="path"
            default-expand-all
            highlight-current
            @node-click="(data: FileTreeNode) => previewFile(data)"
          />
        </div>

        <!-- Drag handle -->
        <div class="artifact-detail-drag-handle" @mousedown="onDragStart" />

        <!-- Right: file preview -->
        <div v-loading="fileLoading" class="artifact-detail-preview-panel">
          <div v-if="selectedFile" class="artifact-detail-preview-header">
            <span class="artifact-detail-preview-filename">{{ selectedFile.name }}</span>
            <span v-if="selectedFileSize != null" class="artifact-detail-preview-size">
              {{ formatBytes(selectedFileSize) }}
            </span>
            <el-button
              v-if="filePreview && previewSupportsSearch"
              class="artifact-detail-preview-search"
              size="small"
              text
              :icon="Search"
              @click="openPreviewSearch"
            >
              {{ t("common.search") }}
            </el-button>
            <el-button-group
              v-if="filePreview && filePreviewComponent?.isPromptMarkdown"
              class="artifact-detail-preview-view-switch"
              role="group"
              :aria-label="t('diagnosis.promptTranscript.viewMode')"
            >
              <el-button
                size="small"
                :type="filePreviewComponent.promptViewMode === 'reading' ? 'primary' : 'default'"
                :disabled="!filePreviewComponent.readingAvailable"
                :aria-pressed="filePreviewComponent.promptViewMode === 'reading'"
                @click="filePreviewComponent.setPromptViewMode('reading')"
              >
                {{ t("diagnosis.promptTranscript.readingView") }}
              </el-button>
              <el-button
                size="small"
                :type="filePreviewComponent.promptViewMode === 'raw' ? 'primary' : 'default'"
                :aria-pressed="filePreviewComponent.promptViewMode === 'raw'"
                @click="filePreviewComponent.setPromptViewMode('raw')"
              >
                {{ t("diagnosis.promptTranscript.rawView") }}
              </el-button>
            </el-button-group>
          </div>
          <div v-if="selectedFile && filePreview?.truncated" class="artifact-detail-preview-notice">
            {{ largeFilePreview(formatBytes(filePreview.loadedBytes)) }}
          </div>
          <div v-if="selectedFile && filePreview" class="artifact-detail-preview-body">
            <FilePreview
              ref="filePreviewComponent"
              :content="filePreview.content"
              :filename="selectedFile.name"
              :file-path="selectedFile.path"
              :truncated="filePreview.truncated"
            />
          </div>
          <div v-else-if="selectedFile && fileError" class="artifact-detail-preview-empty">
            <span class="artifact-detail-preview-empty-text">{{ fileError }}</span>
          </div>
          <div v-else-if="!selectedFile" class="artifact-detail-preview-empty">
            <span class="artifact-detail-preview-empty-text">Select a file to preview</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.artifact-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-height: 0;
}

.artifact-detail.dragging {
  cursor: col-resize;
  user-select: none;
}

/* ---- Empty State ---- */

.artifact-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
}

.empty-icon {
  color: var(--el-text-color-placeholder);
  opacity: 0.5;
}

.empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.empty-hint {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  max-width: 360px;
  line-height: 1.5;
}

/* ---- Header ---- */

.artifact-detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-lighter));
}

.artifact-detail-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.artifact-detail-header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.artifact-detail-title {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-lighter);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.artifact-detail-title--question {
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  background: none;
  padding: 0;
  border-radius: 0;
}

.artifact-detail-header-subtitle {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.artifact-detail-subtitle-item {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.artifact-detail-subtitle-label {
  color: var(--el-text-color-secondary);
  margin-right: 2px;
}

.artifact-detail-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.artifact-detail-header-spacer {
  flex: 1;
}

/* ---- Body split ---- */

.artifact-detail-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ---- Left: file tree ---- */

.artifact-detail-tree-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  border: 1px solid var(--observe-border, var(--el-border-color-lighter));
  border-radius: 8px;
  margin: 8px 0 8px 8px;
  padding: 6px;
  min-width: 180px;
  background: var(--observe-bg-card, transparent);
}

.artifact-detail-tree-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.artifact-detail-tree-empty-text {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.artifact-detail-tree-panel :deep(.el-tree-node__content) {
  height: 30px;
  border-radius: 4px;
}

.artifact-detail-tree-panel :deep(.el-tree-node__content:hover) {
  background: var(--el-fill-color-light);
}

.artifact-detail-tree-panel :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

/* ---- Drag handle ---- */

.artifact-detail-drag-handle {
  width: 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  flex-shrink: 0;
  margin: 8px 0;
  border-radius: 2px;
  transition: background 0.15s;
}

.artifact-detail-drag-handle:hover,
.dragging .artifact-detail-drag-handle {
  background: var(--el-color-primary-light-5);
}

/* ---- Right: preview ---- */

.artifact-detail-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--observe-border, var(--el-border-color-lighter));
  border-radius: 8px;
  margin: 8px 8px 8px 0;
  background: var(--observe-bg-main, transparent);
}

.artifact-detail-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
  background: var(--el-fill-color-lighter);
}

.artifact-detail-preview-filename {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-detail-preview-size {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-left: auto;
  flex-shrink: 0;
}

.artifact-detail-preview-search {
  flex-shrink: 0;
}

.artifact-detail-preview-view-switch {
  flex-shrink: 0;
}

.artifact-detail-preview-notice {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-bottom: 1px solid var(--el-color-warning-light-7);
}

.artifact-detail-preview-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.artifact-detail-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.artifact-detail-preview-empty-text {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}
</style>
