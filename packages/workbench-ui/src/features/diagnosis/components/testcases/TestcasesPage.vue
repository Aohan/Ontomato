<script setup lang="ts">
import type {
  CaseSet as CaseSetDetail,
  CaseSetListItem as CaseSetItem,
  TestCase,
} from "@ontomato/contracts/autotest";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { diagnosisApi } from "../../api";
import { useI18n } from "vue-i18n";
import CaseEditor from "./CaseEditor.vue";
import CaseSetList from "./CaseSetList.vue";
import CaseSetToolbar from "./CaseSetToolbar.vue";
import ImportCaseSetDialog from "./ImportCaseSetDialog.vue";
import JsonCasesPanel from "./JsonCasesPanel.vue";
import NewCaseSetDialog from "./NewCaseSetDialog.vue";
import { useTestcasePanelResize } from "../../composables/useTestcasePanelResize";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  API Helpers                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function getDraftKey(id: string) {
  return `draft:caseset:${id}`;
}

const DEFAULT_JUDGMENT = t("diagnosis.hasResultCounts");

function toEditableText(value: unknown): string {
  return value == null ? "" : String(value);
}

function normalizeJudgment(value?: string): string {
  return value?.trim() || DEFAULT_JUDGMENT;
}

function normalizeEditableCase(c: Partial<TestCase> | Record<string, unknown>): TestCase {
  return {
    caseId: toEditableText(c.caseId),
    question: toEditableText(c.question),
    expectedAnswer: toEditableText(c.expectedAnswer),
    expectedLogic: toEditableText(c.expectedLogic),
    judgment: normalizeJudgment(toEditableText(c.judgment)),
  };
}

function serializeCases(cases: TestCase[]): string {
  return JSON.stringify(
    cases.map((c) => {
      const obj: any = { caseId: c.caseId, question: c.question };
      if (c.expectedAnswer) obj.expectedAnswer = c.expectedAnswer;
      if (c.expectedLogic) obj.expectedLogic = c.expectedLogic;
      if (c.judgment) obj.judgment = c.judgment;
      return obj;
    }),
    null,
    2
  );
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const caseSets = ref<CaseSetItem[]>([]);
const loading = ref(false);
const selectedCaseSetId = ref("");

const caseSetDetail = ref<CaseSetDetail | null>(null);
const detailLoading = ref(false);

const editingCases = ref<TestCase[]>([]);
const selectedCaseIndex = ref(-1);
const saving = ref(false);

const savedCasesJson = ref("[]");

const importVisible = ref(false);
const importName = ref("");
const importText = ref("");
const importFile = ref<File | null>(null);
const importing = ref(false);

const newCaseSetVisible = ref(false);
const newCaseSetName = ref("");

const testcaseToolbarRef = ref<InstanceType<typeof CaseSetToolbar> | null>(null);
const jsonText = ref("[]");
const jsonError = ref("");
const isEditingJson = ref(false);
const {
  layoutRef,
  leftPanelWidth,
  rightPanelWidth,
  jsonCollapsed,
  activeResize,
  startResize,
  stopResize,
} = useTestcasePanelResize();

/* ------------------------------------------------------------------ */
/*  Computed                                                           */
/* ------------------------------------------------------------------ */

const selectedCase = computed(() => {
  if (selectedCaseIndex.value < 0 || selectedCaseIndex.value >= editingCases.value.length) {
    return null;
  }
  return editingCases.value[selectedCaseIndex.value];
});

const isDirty = computed(() => {
  if (!selectedCaseSetId.value) return false;
  return serializeCases(editingCases.value) !== savedCasesJson.value;
});

const draftCaseSetIds = computed(() => {
  return caseSets.value.filter((cs) => hasDraftForId(cs.id)).map((cs) => cs.id);
});

const saveDisabled = computed(() => {
  return !isDirty.value;
});

/* ------------------------------------------------------------------ */
/*  Draft Management                                                   */
/* ------------------------------------------------------------------ */

let draftTimeout: ReturnType<typeof setTimeout> | null = null;

function saveDraft() {
  if (!selectedCaseSetId.value || !isDirty.value) return;
  localStorage.setItem(
    getDraftKey(selectedCaseSetId.value),
    JSON.stringify({ cases: editingCases.value, timestamp: Date.now() })
  );
}

function clearDraft(id?: string) {
  const targetId = id || selectedCaseSetId.value;
  if (targetId) {
    localStorage.removeItem(getDraftKey(targetId));
  }
  if (draftTimeout) {
    clearTimeout(draftTimeout);
    draftTimeout = null;
  }
}

function hasDraftForId(id: string): boolean {
  if (id === selectedCaseSetId.value) return isDirty.value;
  return !!localStorage.getItem(getDraftKey(id));
}

/* ------------------------------------------------------------------ */
/*  JSON Editing                                                       */
/* ------------------------------------------------------------------ */

function syncJsonTextFromCases() {
  jsonText.value = serializeCases(editingCases.value);
  jsonError.value = "";
}

function parseJsonCases(value: string): TestCase[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(t("diagnosis.jsonMustBeArray"));
  }
  return parsed.map((item) => normalizeEditableCase(item && typeof item === "object" ? item : {}));
}

function handleJsonInput(value: string) {
  jsonText.value = value;
  try {
    const cases = parseJsonCases(value);
    jsonError.value = "";
    editingCases.value = cases;
    if (cases.length === 0) {
      selectedCaseIndex.value = -1;
    } else if (selectedCaseIndex.value < 0 || selectedCaseIndex.value >= cases.length) {
      selectedCaseIndex.value = 0;
    }
  } catch (e: any) {
    jsonError.value = e?.message || t("diagnosis.jsonFormatError");
  }
}

function handleJsonBlur() {
  isEditingJson.value = false;
  if (!jsonError.value) {
    syncJsonTextFromCases();
  }
}

/* ------------------------------------------------------------------ */
/*  Load Case Sets                                                     */
/* ------------------------------------------------------------------ */

async function loadCaseSets() {
  loading.value = true;
  try {
    caseSets.value = (await diagnosisApi.listCaseSets()) || [];
    if (!selectedCaseSetId.value && caseSets.value.length > 0) {
      selectedCaseSetId.value = caseSets.value[0].id;
    }
  } catch {
    caseSets.value = [];
  } finally {
    loading.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Load Case Set Detail                                               */
/* ------------------------------------------------------------------ */

async function loadCaseSetDetail(id: string) {
  detailLoading.value = true;
  try {
    const detail = await diagnosisApi.getCaseSet(id);
    caseSetDetail.value = detail;
    const cases = (detail?.cases || []).map(normalizeEditableCase);
    editingCases.value = cases;
    savedCasesJson.value = serializeCases(cases);

    selectedCaseIndex.value = editingCases.value.length > 0 ? 0 : -1;

    const draftData = localStorage.getItem(getDraftKey(id));
    if (draftData) {
      try {
        const draft = JSON.parse(draftData);
        if (draft.cases && Array.isArray(draft.cases)) {
          const draftCases = draft.cases.map(normalizeEditableCase);
          const draftJson = serializeCases(draftCases);
          if (draftJson !== savedCasesJson.value) {
            editingCases.value = draftCases;
            selectedCaseIndex.value = editingCases.value.length > 0 ? 0 : -1;
          } else {
            localStorage.removeItem(getDraftKey(id));
          }
        }
      } catch {
        localStorage.removeItem(getDraftKey(id));
      }
    }
  } catch {
    caseSetDetail.value = null;
    editingCases.value = [];
    selectedCaseIndex.value = -1;
    savedCasesJson.value = "[]";
  } finally {
    detailLoading.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Visual Mode: Case Operations                                       */
/* ------------------------------------------------------------------ */

function selectCase(index: number) {
  selectedCaseIndex.value = index;
}

function addCase() {
  const newCase: TestCase = {
    caseId: `case-${editingCases.value.length + 1}`,
    question: "",
    expectedAnswer: "",
    expectedLogic: "",
    judgment: DEFAULT_JUDGMENT,
  };
  editingCases.value.push(newCase);
  selectedCaseIndex.value = editingCases.value.length - 1;
}

function removeCase(index: number) {
  editingCases.value.splice(index, 1);
  if (editingCases.value.length === 0) {
    selectedCaseIndex.value = -1;
  } else if (selectedCaseIndex.value >= editingCases.value.length) {
    selectedCaseIndex.value = editingCases.value.length - 1;
  } else if (selectedCaseIndex.value === index) {
    selectedCaseIndex.value = Math.min(index, editingCases.value.length - 1);
  }
}

function updateCaseField(field: keyof TestCase, value: string) {
  const target = selectedCase.value;
  if (!target) return;
  target[field] = value;
}

/* ------------------------------------------------------------------ */
/*  Save                                                               */
/* ------------------------------------------------------------------ */

async function saveCases(targetId?: string): Promise<boolean> {
  const id = targetId || selectedCaseSetId.value;
  if (!id) return false;

  const casesToSave = editingCases.value;
  const valid = casesToSave
    .filter((c) => c.question.trim())
    .map((c) => ({ ...c, judgment: normalizeJudgment(c.judgment) }));
  if (valid.length === 0) {
    ElMessage.warning(t("diagnosis.needValidCases"));
    return false;
  }

  saving.value = true;
  try {
    await diagnosisApi.saveCaseSet(id, JSON.stringify({ cases: valid }));
    ElMessage.success(t("admin.saveSuccess"));
    editingCases.value = valid.map((c) => ({ ...c }));
    savedCasesJson.value = serializeCases(editingCases.value);
    clearDraft(id);
    await loadCaseSets();
    return true;
  } catch (e: any) {
    ElMessage.error(e?.message || t("admin.saveFailed"));
    return false;
  } finally {
    saving.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Revert                                                             */
/* ------------------------------------------------------------------ */

function revertChanges() {
  if (!isDirty.value) return;
  try {
    const saved = JSON.parse(savedCasesJson.value);
    editingCases.value = saved.map(normalizeEditableCase);
  } catch {
    editingCases.value = [];
  }
  if (selectedCaseIndex.value >= editingCases.value.length) {
    selectedCaseIndex.value = editingCases.value.length > 0 ? 0 : -1;
  }
  clearDraft();
  ElMessage.info(t("diagnosis.reverted"));
}

/* ------------------------------------------------------------------ */
/*  Delete Case Set                                                    */
/* ------------------------------------------------------------------ */

async function deleteCaseSet() {
  if (!selectedCaseSetId.value) return;
  const cs = caseSets.value.find((s) => s.id === selectedCaseSetId.value);
  if (!cs) return;

  const message = isDirty.value
    ? t("diagnosis.deleteCaseSetDirty", { name: cs.name })
    : t("diagnosis.deleteCaseSet", { name: cs.name });

  try {
    await ElMessageBox.confirm(message, t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.confirm"),
      cancelButtonText: t("common.cancel"),
    });
    clearDraft();
    await diagnosisApi.deleteCaseSet(cs.id);
    ElMessage.success(t("admin.deletedSuccess"));
    selectedCaseSetId.value = "";
    caseSetDetail.value = null;
    editingCases.value = [];
    selectedCaseIndex.value = -1;
    savedCasesJson.value = "[]";
    await loadCaseSets();
  } catch (e: any) {
    if (e !== "cancel" && e?.message !== "cancel") {
      ElMessage.error(e?.message || t("admin.deleteFailed"));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

function openImportDialog() {
  importName.value = "";
  importText.value = "";
  importFile.value = null;
  importVisible.value = true;
}

function handleFileSelect(rawFile: File) {
  importFile.value = rawFile;
  if (!importName.value) {
    importName.value = rawFile.name.replace(/\.json$/i, "");
  }
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = String(reader.result || "");
  };
  reader.readAsText(rawFile, "utf-8");
  return false;
}

async function doImport() {
  if (!importName.value.trim()) {
    ElMessage.warning(t("diagnosis.enterCaseSetName"));
    return;
  }
  let cases: any[];
  try {
    cases = JSON.parse(importText.value);
    if (!Array.isArray(cases)) {
      ElMessage.error(t("diagnosis.jsonMustBeArray"));
      return;
    }
  } catch {
    ElMessage.error(t("diagnosis.jsonFormatError"));
    return;
  }

  importing.value = true;
  try {
    await diagnosisApi.createCaseSet(JSON.stringify({ name: importName.value.trim(), cases }));
    ElMessage.success(t("diagnosis.importSuccess"));
    importVisible.value = false;
    await loadCaseSets();
  } catch (e: any) {
    ElMessage.error(e?.message || t("diagnosis.importFailed"));
  } finally {
    importing.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  New Case Set                                                       */
/* ------------------------------------------------------------------ */

function openNewCaseSetDialog() {
  newCaseSetName.value = "";
  newCaseSetVisible.value = true;
}

async function doCreateCaseSet() {
  if (!newCaseSetName.value.trim()) {
    ElMessage.warning(t("diagnosis.enterCaseSetName"));
    return;
  }

  importing.value = true;
  try {
    const result = await diagnosisApi.createCaseSet(
      JSON.stringify({
        name: newCaseSetName.value.trim(),
        cases: [],
      })
    );
    ElMessage.success(t("admin.createdSuccess"));
    newCaseSetVisible.value = false;
    await loadCaseSets();
    if (result?.id) {
      selectedCaseSetId.value = result.id;
    }
  } catch (e: any) {
    ElMessage.error(e?.message || t("diagnosis.createFailed"));
  } finally {
    importing.value = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Watchers                                                           */
/* ------------------------------------------------------------------ */

let prevLoadedId = "";

watch(selectedCaseSetId, async (newId) => {
  if (!newId) {
    caseSetDetail.value = null;
    editingCases.value = [];
    selectedCaseIndex.value = -1;
    savedCasesJson.value = "[]";
    prevLoadedId = "";
    return;
  }

  if (newId === prevLoadedId) return;

  if (prevLoadedId && isDirty.value) {
    try {
      await ElMessageBox.confirm(t("admin.unsavedChangesConfirm"), t("admin.switchConfirmTitle"), {
        distinguishCancelAndClose: true,
        confirmButtonText: t("admin.saveAndSwitch"),
        cancelButtonText: t("admin.discardChanges"),
        type: "warning",
      });
      const saved = await saveCases(prevLoadedId);
      if (!saved) {
        selectedCaseSetId.value = prevLoadedId;
        return;
      }
    } catch (action: any) {
      if (action === "cancel") {
        localStorage.removeItem(getDraftKey(prevLoadedId));
      } else {
        selectedCaseSetId.value = prevLoadedId;
        return;
      }
    }
  }

  await loadCaseSetDetail(newId);
  prevLoadedId = newId;
});

watch(
  editingCases,
  () => {
    if (!isEditingJson.value) {
      syncJsonTextFromCases();
    }
    if (draftTimeout) clearTimeout(draftTimeout);
    draftTimeout = setTimeout(saveDraft, 1000);
  },
  { deep: true }
);

/* ------------------------------------------------------------------ */
/*  Keyboard Shortcuts                                                 */
/* ------------------------------------------------------------------ */

function onKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "s") {
    e.preventDefault();
    if (!saveDisabled.value) saveCases();
  } else if (mod && e.key === "p") {
    e.preventDefault();
    testcaseToolbarRef.value?.focus();
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onMounted(() => {
  loadCaseSets();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", onBeforeUnload);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  if (draftTimeout) clearTimeout(draftTimeout);
  stopResize();
});
</script>

<template>
  <div class="testcases-page">
    <CaseSetToolbar
      ref="testcaseToolbarRef"
      :case-sets="caseSets"
      :loading="loading"
      :selected-case-set-id="selectedCaseSetId"
      :is-dirty="isDirty"
      :draft-case-set-ids="draftCaseSetIds"
      @update:selected-case-set-id="selectedCaseSetId = $event"
      @import="openImportDialog"
      @create="openNewCaseSetDialog"
      @delete="deleteCaseSet"
    />

    <main v-if="selectedCaseSetId" v-loading="detailLoading" class="page-body">
      <div ref="layoutRef" class="three-panel" :class="{ dragging: activeResize }">
        <CaseSetList
          :cases="editingCases"
          :selected-case-index="selectedCaseIndex"
          :width="leftPanelWidth"
          @select="selectCase"
          @remove="removeCase"
          @add="addCase"
        />

        <div class="panel-resizer" @mousedown="startResize('left', $event)" />

        <section class="panel-center">
          <CaseEditor
            :selected-case="selectedCase"
            :default-judgment="DEFAULT_JUDGMENT"
            @update-field="updateCaseField"
          />
        </section>

        <template v-if="!jsonCollapsed">
          <div class="panel-resizer" @mousedown="startResize('right', $event)" />
        </template>

        <JsonCasesPanel
          :collapsed="jsonCollapsed"
          :width="rightPanelWidth"
          :cases-count="editingCases.length"
          :json-text="jsonText"
          :json-error="jsonError"
          @update:collapsed="jsonCollapsed = $event"
          @json-focus="isEditingJson = true"
          @json-blur="handleJsonBlur"
          @json-input="handleJsonInput"
        />
      </div>
    </main>

    <main v-else-if="!loading" class="page-body empty-body">
      <el-empty :description="t('hotData.selectOrCreateCaseSet')" :image-size="60" />
    </main>

    <footer v-if="selectedCaseSetId" class="page-footer">
      <div class="footer-left">
        <span v-if="isDirty" class="status-unsaved">● {{ t("hotData.unsaved") }}</span>
        <span v-else class="status-saved">{{ t("hotData.saved") }}</span>
      </div>
      <div class="footer-right">
        <el-button :disabled="!isDirty" @click="revertChanges">{{ t("hotData.revert") }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="saveDisabled" @click="saveCases()">
          {{ t("common.save") }}
        </el-button>
      </div>
    </footer>

    <ImportCaseSetDialog
      :visible="importVisible"
      :name="importName"
      :text="importText"
      :file-name="importFile?.name || ''"
      :importing="importing"
      @update:visible="importVisible = $event"
      @update:name="importName = $event"
      @update:text="importText = $event"
      @select-file="handleFileSelect"
      @import="doImport"
    />

    <NewCaseSetDialog
      :visible="newCaseSetVisible"
      :name="newCaseSetName"
      :creating="importing"
      @update:visible="newCaseSetVisible = $event"
      @update:name="newCaseSetName = $event"
      @create="doCreateCaseSet"
    />
  </div>
</template>

<style scoped>
.testcases-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--observe-bg-main, var(--el-bg-color-page));
}

/* ======== Main Body ======== */

.page-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.page-body.empty-body {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ======== Three-Panel Layout ======== */

.three-panel {
  position: relative;
  display: flex;
  height: 100%;
  overflow: hidden;
}

.three-panel.dragging,
.three-panel.dragging * {
  cursor: col-resize !important;
  user-select: none;
}

.panel-resizer {
  position: relative;
  flex: 0 0 8px;
  cursor: col-resize;
  background: transparent;
}

.panel-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--observe-border, var(--el-border-color));
  transition:
    background var(--transition-fast),
    width var(--transition-fast);
}

.panel-resizer:hover::after,
.three-panel.dragging .panel-resizer::after {
  left: 2px;
  width: 3px;
  background: var(--el-color-primary-light-5);
}

/* ---- Panel center (form) ---- */

.panel-center {
  display: flex;
  justify-content: center;
  flex: 1 1 auto;
  overflow-y: auto;
  min-width: 200px;
  padding: 28px 36px 48px;
  background: var(--el-bg-color);
}

/* ======== Footer ======== */

.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 0.5px solid var(--observe-border, var(--el-border-color));
  flex-shrink: 0;
  background: var(--observe-bg-card, var(--el-bg-color));
}

.footer-left {
  font-size: 12px;
}

.status-unsaved {
  color: var(--el-color-warning);
}

.status-saved {
  color: var(--el-text-color-tertiary);
}

.footer-right {
  display: flex;
  gap: 8px;
}
</style>
