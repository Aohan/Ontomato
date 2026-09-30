<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeft, History, Play, Plus, Save, Sparkles, Trash2 } from "lucide-vue-next";
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElLink,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  vLoading,
} from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { SmartAsset } from "../api";
import type { AssetTab } from "../workspace";
import ActionCodeExplainer from "./codeExplainer/ActionCodeExplainer.vue";
import BusinessMeaning from "./codeExplainer/BusinessMeaning.vue";
import { normalizeBusinessMeaning, normalizeCodeSegments } from "./codeExplainer/codeSegments";
import { useManagerClient, useOntologyText } from "../context";

type AssetRecord = Record<string, any>;

const props = defineProps<{
  kind: AssetTab;
  asset?: SmartAsset | null;
  creating?: boolean;
}>();
const emit = defineEmits<{ back: []; saved: []; created: [] }>();

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { loadSmartAssets, requestSmartAsset } = useManagerClient();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const generating = ref(false);
const testing = ref(false);
const record = ref<AssetRecord | null>(null);
const functionChoices = ref<SmartAsset[]>([]);
const generationPrompt = ref("");
const showGeneration = ref(false);
const generationPersistence = ref(true);
const metricGenerationPrompt = ref("");
const metricGenerationVisible = ref(false);
const metricGenerating = ref(false);
const testVisible = ref(false);
const testTab = ref("markdown");
const testMarkdown = ref("");
const testJson = ref("");
const testResultUrl = ref("");
const taskResultsVisible = ref(false);
const taskResultLoading = ref(false);
const taskResults = ref<AssetRecord[]>([]);
const taskResultPage = ref(1);
const taskResultPageSize = ref(10);
const taskResultTotal = ref(0);
const selectedTaskResult = ref<AssetRecord | null>(null);

const meta = computed(() => {
  const titles = {
    metrics: ot("assetKindMetrics"),
    actions: ot("assetKindActions"),
    functions: ot("assetKindFunctions"),
    tasks: ot("assetKindTasks"),
  };
  return { title: titles[props.kind] };
});

const canDelete = computed(() => Boolean(record.value?.id) && record.value?.origin !== "SYSTEM");
const isTask = computed(() => props.kind === "tasks");
const isFunction = computed(() => props.kind === "functions");
const functionRecord = computed(() =>
  props.kind === "functions" ? record.value : record.value?.function || null
);
const metricParameters = computed(() =>
  Array.isArray(record.value?.function?.parameters) ? record.value.function.parameters : []
);
const parameterTypes = [
  "TYPE_STRING",
  "TYPE_NUMBER",
  "TYPE_TIME",
  "TYPE_STRING_ARRAY",
  "TYPE_NUMBER_ARRAY",
  "TYPE_TIME_ARRAY",
];
const returnClassText = computed({
  get: () => (functionRecord.value?.returnDef?.classNames || []).join(", "),
  set: (value: string) => {
    if (!functionRecord.value) return;
    functionRecord.value.returnDef = functionRecord.value.returnDef || {};
    functionRecord.value.returnDef.classNames = value
      .split(",")
      .map((item: string) => item.trim())
      .filter(Boolean);
  },
});
const matchQuestionText = computed({
  get: () => (record.value?.matchQuestions || []).join("\n"),
  set: (value: string) => {
    if (!record.value) return;
    record.value.matchQuestions = value
      .split(/\r?\n/)
      .map((item: string) => item.trim())
      .filter(Boolean);
  },
});
const taskResultPages = computed(() =>
  Math.max(1, Math.ceil(taskResultTotal.value / taskResultPageSize.value))
);

// The explanation tab belongs only to actions with segments; other assets and actions without segments show no tab bar.
const activeTab = ref<"definition" | "explainer">("definition");
const savedCodeSnapshot = ref("");

const editedCode = computed(() => {
  const code = record.value?.function?.code;
  return typeof code === "string" ? code : "";
});

const explainerState = computed(() => {
  if (props.kind !== "actions") return null;
  const raw = record.value?.codeSegments;
  if (raw === null || raw === undefined) return null;
  return normalizeCodeSegments(raw);
});

// Show the tab whenever there is an explanation: a normalized one is non-empty; an invalid format shows an error in the tab.
const showExplainerTab = computed(() => explainerState.value !== null);

const explainerSegments = computed(() => {
  const state = explainerState.value;
  return state && state.ok ? state.segments : [];
});

// When the editor has unsaved changes relative to the saved code, the explanation tab warns and still renders the saved version.
const codeDirty = computed(() => editedCode.value !== savedCodeSnapshot.value);

// Business meaning reflects the saved code and is read-only; its dirty state reuses the explanation tab's check instead of a separate one.
const businessMeaning = computed(() =>
  props.kind === "actions" ? normalizeBusinessMeaning(record.value?.businessMeaning) : null
);

// The snapshot syncs only when record is reassigned (not deep): new load paths are not missed and editor changes do not trigger it.
watch(
  () => record.value,
  () => {
    savedCodeSnapshot.value = editedCode.value;
  }
);

function createRecord(kind: AssetTab): AssetRecord {
  if (kind === "metrics") {
    return {
      name: "",
      description: "",
      origin: "USER",
      type: "GENERAL",
      status: "PENDING_REVIEW",
      matchQuestions: [],
      function: {
        name: "",
        origin: "USER",
        operation: "OPERATION_READ",
        description: "",
        parameters: [],
        returnDef: { isVoid: false, outKeyRefs: [], value: {}, classNames: [] },
        code: "",
        logic: "",
      },
    };
  }
  if (kind === "functions") {
    return {
      name: "",
      description: "",
      origin: "USER",
      operation: "OPERATION_READ",
      parameters: [],
      returnDef: { isVoid: false, outKeyRefs: [], value: {}, classNames: [] },
      code: "",
      logic: "",
    };
  }
  return {
    name: "",
    description: "",
    status: "STOPPED",
    cron: "",
    function: null,
  };
}

async function loadDetail() {
  if (props.creating && props.kind !== "actions") {
    record.value = createRecord(props.kind);
    if (props.kind === "tasks")
      functionChoices.value = await loadSmartAssets("functions").catch(() => []);
    return;
  }
  if (props.creating && props.kind === "actions") {
    showGeneration.value = true;
    return;
  }
  if (!props.asset?.id) {
    record.value = props.asset ? structuredClone(props.asset) : null;
    return;
  }
  loading.value = true;
  try {
    const response = await requestSmartAsset(props.kind, "queryById", { id: props.asset.id });
    record.value = structuredClone(response?.data ?? response);
    if (props.kind === "tasks")
      functionChoices.value = await loadSmartAssets("functions").catch(() => []);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetLoadDetailFailed"));
    record.value = null;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!record.value) return;
  if (!record.value.name?.trim()) {
    message.warning(ot("assetNameRequired"));
    return;
  }
  if (isTask.value && (!record.value.cron?.trim() || !record.value.function?.id)) {
    message.warning(ot("assetTaskFieldsRequired"));
    return;
  }
  saving.value = true;
  try {
    const isAction = props.kind === "actions";
    const codeChanged = isAction && codeDirty.value;
    // Recalculation happens synchronously in the save request, so actions with code changes first warn that it may take a while.
    if (codeChanged) message.info(ot("explainerRegenerating"));
    await requestSmartAsset(props.kind, "save", record.value);
    message.success(ot("assetSaved", { title: meta.value.title }));
    if (props.creating) {
      emit("created");
    } else if (isAction) {
      // Existing actions stay on the detail page: tell the parent to refresh the catalog, then reload this record.
      emit("saved");
      await loadDetail();
      if (codeChanged && explainerSegments.value.length === 0) {
        message.warning(ot("explainerNotGenerated"));
      }
      return;
    } else {
      emit("saved");
    }
    emit("back");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("assetSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!record.value?.id) return;
  try {
    await confirm(
      ot("assetDeleteConfirm", { name: record.value.name }),
      ot("assetDeleteConfirmTitle")
    );
    deleting.value = true;
    await requestSmartAsset(props.kind, "delete", { id: record.value.id });
    message.success(ot("assetDeleted", { title: meta.value.title }));
    emit("saved");
    emit("back");
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("assetDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

async function runTask() {
  if (!record.value?.id) return;
  try {
    await requestSmartAsset("tasks", "runOnce", { id: record.value.id });
    message.success(ot("taskRunSubmitted"));
    await openTaskResults();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskRunFailed"));
  }
}

function addParameter() {
  if (!functionRecord.value) return;
  functionRecord.value.parameters = functionRecord.value.parameters || [];
  functionRecord.value.parameters.push({
    name: "",
    type: "TYPE_STRING",
    description: "",
    sample: "",
    value: "",
    classNames: [],
  });
}

function removeParameter(index: string | number) {
  functionRecord.value?.parameters?.splice(Number(index), 1);
}

function parameterClassNamesText(parameter: AssetRecord) {
  return Array.isArray(parameter.classNames) ? parameter.classNames.join(", ") : "";
}

function updateParameterClassNames(parameter: AssetRecord, value: string) {
  parameter.classNames = value
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean);
}

async function openTaskResults() {
  if (!record.value?.id) return;
  taskResultsVisible.value = true;
  taskResultPage.value = 1;
  selectedTaskResult.value = null;
  await loadTaskResults();
}

async function loadTaskResults() {
  if (!record.value?.id) return;
  taskResultLoading.value = true;
  try {
    const response = await requestSmartAsset("tasks", "queryResultPageByTaskId", {
      id: record.value.id,
      pageNum: taskResultPage.value,
      pageSize: taskResultPageSize.value,
    });
    const payload = response?.data ?? response ?? {};
    taskResults.value = Array.isArray(payload.data) ? payload.data : [];
    taskResultTotal.value = Number(payload.totalRows || 0);
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskResultsLoadFailed"));
  } finally {
    taskResultLoading.value = false;
  }
}

async function viewTaskResult(result: AssetRecord) {
  try {
    const response = await requestSmartAsset("tasks", "queryResultById", { resultId: result.id });
    selectedTaskResult.value = response?.data ?? response;
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("taskResultLoadFailed"));
  }
}

function openMetricTest() {
  testMarkdown.value = "";
  testJson.value = "";
  testResultUrl.value = "";
  testTab.value = "markdown";
  testVisible.value = true;
}

async function testMetricView() {
  if (!record.value) return;
  testing.value = true;
  try {
    const response = await requestSmartAsset("metrics", "test", record.value);
    testMarkdown.value = response?.data?.md || ot("metricTestNoResult");
    testResultUrl.value = typeof response?.data?.url === "string" ? response.data.url : "";
    testTab.value = "markdown";
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricTestFailed"));
  } finally {
    testing.value = false;
  }
}

async function testExecuteMetricView() {
  if (!record.value) return;
  if (record.value.status !== "PUBLISHED") {
    message.warning(ot("metricJsonTestPublishedOnly"));
    return;
  }
  testing.value = true;
  try {
    const param = Object.fromEntries(
      metricParameters.value.map((parameter: AssetRecord) => [parameter.name, parameter.value])
    );
    const response = await requestSmartAsset("metrics", "testExecute", {
      metricView: record.value,
      param,
    });
    testJson.value = JSON.stringify(response?.data ?? null, null, 2);
    testTab.value = "json";
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricJsonTestFailed"));
  } finally {
    testing.value = false;
  }
}

async function generateAction() {
  if (!generationPrompt.value.trim()) {
    message.warning(ot("actionPromptRequired"));
    return;
  }
  generating.value = true;
  try {
    const response = await requestSmartAsset("actions", "generateFromNatureLanguage", {
      question: generationPrompt.value.trim(),
      persistence: generationPersistence.value,
    });
    const generated = response?.data ?? response;
    if (!generationPersistence.value && generated) {
      record.value = structuredClone(generated);
      showGeneration.value = false;
      message.success(ot("actionDraftGenerated"));
      return;
    }
    message.success(ot("actionGenerated"));
    showGeneration.value = false;
    emit("created");
    emit("back");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("actionGenerateFailed"));
  } finally {
    generating.value = false;
  }
}

async function generateMetricView() {
  const question = metricGenerationPrompt.value.trim();
  if (!question) {
    message.warning(ot("metricPromptRequired"));
    return;
  }
  metricGenerating.value = true;
  try {
    const response = await requestSmartAsset("metrics", "generateFromNatureLanguage", {
      question,
      persistence: false,
    });
    const generated = response?.data ?? response;
    if (!generated) throw new Error(ot("metricNotGenerated"));
    const draft: AssetRecord = structuredClone(generated);
    if (!Array.isArray(draft.matchQuestions) || !draft.matchQuestions.length) {
      draft.matchQuestions = [question];
    }
    record.value = draft;
    metricGenerationVisible.value = false;
    message.success(ot("metricDraftGenerated"));
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("metricGenerateFailed"));
  } finally {
    metricGenerating.value = false;
  }
}

watch([() => props.kind, () => props.asset?.id, () => props.creating], () => void loadDetail());
onMounted(() => void loadDetail());
</script>

<template>
  <section
    v-loading="loading"
    :class="['asset-detail', { 'task-detail': isTask }, { 'with-explainer-tab': showExplainerTab }]"
  >
    <header class="detail-titlebar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("assetBackTo", { title: meta.title }) }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ record?.name || ot("assetNew", { title: meta.title }) }}</strong>
        <small>{{ meta.title }}</small>
      </span>
      <span class="title-spacer"></span>
      <el-button v-if="kind === 'metrics' && record" :icon="Play" @click="openMetricTest">
        {{ ot("assetTest") }}
      </el-button>
      <el-button
        v-if="kind === 'metrics' && creating"
        :icon="Sparkles"
        @click="metricGenerationVisible = true"
      >
        {{ ot("assetGenerateFromNl") }}
      </el-button>
      <el-button
        v-if="canDelete"
        type="danger"
        plain
        :icon="Trash2"
        :loading="deleting"
        @click="remove"
      >
        {{ ot("delete") }}
      </el-button>
      <el-button v-if="record" type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("save") }}
      </el-button>
    </header>

    <nav v-if="record && showExplainerTab" class="detail-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'definition'"
        :class="['detail-tab', { 'is-active': activeTab === 'definition' }]"
        @click="activeTab = 'definition'"
      >
        {{ ot("assetTabDefinition") }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'explainer'"
        :class="['detail-tab', { 'is-active': activeTab === 'explainer' }]"
        @click="activeTab = 'explainer'"
      >
        {{ ot("assetTabCodeExplainer") }}
      </button>
    </nav>

    <div
      v-if="record && showExplainerTab"
      v-show="activeTab === 'explainer'"
      class="explainer-pane"
      role="tabpanel"
    >
      <el-alert
        v-if="codeDirty"
        :title="ot('explainerStale')"
        type="warning"
        show-icon
        :closable="false"
      />
      <el-alert
        v-if="explainerState && !explainerState.ok"
        :title="ot('explainerInvalid')"
        type="error"
        show-icon
        :closable="false"
      />
      <ActionCodeExplainer v-else :code="savedCodeSnapshot" :segments="explainerSegments" />
    </div>

    <div v-if="record" v-show="!showExplainerTab || activeTab === 'definition'" class="detail-body">
      <section class="definition-section">
        <div class="section-title">
          <div>
            <h1>{{ meta.title }}</h1>
          </div>
        </div>
        <el-form label-position="top" class="asset-form">
          <el-form-item :label="ot('assetFieldName')">
            <el-input v-model="record.name" />
          </el-form-item>
          <el-form-item :label="ot('description')">
            <el-input v-model="record.description" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item v-if="!isFunction" :label="ot('status')">
            <el-select v-model="record.status">
              <el-option
                v-if="!isTask"
                :label="ot('assetStatusPendingReview')"
                value="PENDING_REVIEW"
              />
              <el-option v-if="!isTask" :label="ot('published')" value="PUBLISHED" />
              <el-option v-if="!isTask" :label="ot('unused')" value="UNUSED" />
              <el-option v-if="isTask" :label="ot('running')" value="RUNNING" />
              <el-option v-if="isTask" :label="ot('stopped')" value="STOPPED" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="kind === 'metrics'" :label="ot('assetMetricType')">
            <el-radio-group v-model="record.type">
              <el-radio value="GENERAL">{{ ot("assetMetricTypeGeneral") }}</el-radio>
              <el-radio value="STATIC">{{ ot("assetMetricTypeStatic") }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="kind === 'metrics'" :label="ot('assetMatchQuestions')">
            <el-input
              v-model="matchQuestionText"
              type="textarea"
              :rows="3"
              :placeholder="ot('assetMatchQuestionsPlaceholder')"
            />
          </el-form-item>
          <el-form-item v-if="isFunction" :label="ot('assetOperationType')">
            <el-radio-group v-model="record.operation">
              <el-radio value="OPERATION_READ">{{ ot("assetOperationRead") }}</el-radio>
              <el-radio value="OPERATION_WRITE">{{ ot("assetOperationWrite") }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="isTask" :label="ot('taskCron')">
            <el-input v-model="record.cron" :placeholder="ot('taskCronPlaceholder')" />
          </el-form-item>
          <el-form-item v-if="isTask" :label="ot('taskLinkedFunction')">
            <el-select
              v-model="record.function"
              value-key="id"
              filterable
              :placeholder="ot('taskSelectFunction')"
            >
              <el-option
                v-for="item in functionChoices"
                :key="item.id"
                :label="item.name"
                :value="item"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <BusinessMeaning
          v-if="kind === 'actions' && businessMeaning"
          :meaning="businessMeaning"
          :stale="codeDirty"
        />
      </section>

      <section v-if="!isTask" class="logic-section">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("assetExecutionDefinition") }}</span>
            <h2>{{ isFunction ? ot("assetFunctionLogic") : ot("taskLinkedFunction") }}</h2>
          </div>
        </div>
        <el-form label-position="top" class="asset-form">
          <el-form-item v-if="functionRecord" :label="ot('assetFunctionName')">
            <el-input v-model="functionRecord.name" />
          </el-form-item>
          <template v-if="functionRecord">
            <div class="parameter-header">
              <span class="field-label">{{ ot("assetInputParameters") }}</span>
              <el-button size="small" :icon="Plus" @click="addParameter">
                {{ ot("assetAddParameter") }}
              </el-button>
            </div>
            <div
              v-for="(parameter, index) in functionRecord.parameters || []"
              :key="index"
              class="parameter-row"
            >
              <el-input v-model="parameter.name" :placeholder="ot('assetParameterName')" />
              <el-select v-model="parameter.type" :placeholder="ot('assetParameterType')">
                <el-option v-for="type in parameterTypes" :key="type" :label="type" :value="type" />
              </el-select>
              <el-input v-model="parameter.description" :placeholder="ot('description')" />
              <el-input v-model="parameter.sample" :placeholder="ot('assetParameterSample')" />
              <el-input
                :model-value="parameterClassNamesText(parameter)"
                :placeholder="ot('assetParameterClasses')"
                @update:model-value="updateParameterClassNames(parameter, $event)"
              />
              <el-button link type="danger" :icon="Trash2" @click="removeParameter(index)" />
            </div>
            <el-form-item :label="ot('assetReturnClasses')">
              <el-input
                v-model="returnClassText"
                :placeholder="ot('assetReturnClassesPlaceholder')"
              />
            </el-form-item>
            <template v-if="isFunction">
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="record.logic" type="textarea" :rows="3" />
              </el-form-item>
              <el-form-item :label="ot('explainerCode')">
                <el-input v-model="record.code" type="textarea" :rows="14" class="code-input" />
              </el-form-item>
            </template>
            <template v-else>
              <el-form-item :label="ot('assetLogicDescription')">
                <el-input v-model="functionRecord.logic" type="textarea" :rows="3" />
              </el-form-item>
              <el-form-item :label="ot('explainerCode')">
                <el-input
                  v-model="functionRecord.code"
                  type="textarea"
                  :rows="14"
                  class="code-input"
                />
              </el-form-item>
            </template>
          </template>
        </el-form>
      </section>

      <section v-else class="task-execution-section">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ ot("taskExecutionEyebrow") }}</span>
            <h2>{{ ot("taskExecutionTitle") }}</h2>
          </div>
        </div>
        <div class="task-summary">
          <div>
            <span>{{ ot("status") }}</span>
            <strong>{{ record.status === "RUNNING" ? ot("running") : ot("stopped") }}</strong>
          </div>
          <div>
            <span>{{ ot("taskSchedule") }}</span>
            <strong>{{ record.cron || ot("taskNotConfigured") }}</strong>
          </div>
          <div>
            <span>{{ ot("taskLinkedFunction") }}</span>
            <strong>{{ record.function?.name || ot("taskNotSelected") }}</strong>
          </div>
        </div>
        <div class="task-actions">
          <el-button v-if="record.id" type="primary" :icon="Play" @click="runTask">
            {{ ot("taskRunOnce") }}
          </el-button>
          <el-button v-if="record.id" :icon="History" @click="openTaskResults">
            {{ ot("taskViewResults") }}
          </el-button>
        </div>
        <p class="task-hint">{{ ot("taskRunOnceHint") }}</p>
      </section>
    </div>

    <el-dialog
      v-model="showGeneration"
      :lock-scroll="false"
      :title="ot('actionGenerateTitle')"
      width="560px"
      :close-on-click-modal="false"
      @closed="emit('back')"
    >
      <el-input
        v-model="generationPrompt"
        type="textarea"
        :rows="4"
        :placeholder="ot('actionPromptPlaceholder')"
      />
      <el-checkbox v-model="generationPersistence" class="generation-option">
        {{ ot("actionSaveAfterGenerate") }}
      </el-checkbox>
      <template #footer>
        <el-button @click="showGeneration = false">{{ ot("cancel") }}</el-button>
        <el-button type="primary" :loading="generating" @click="generateAction">
          {{ ot("actionGenerateAndSave") }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="metricGenerationVisible"
      :lock-scroll="false"
      :title="ot('metricGenerateTitle')"
      width="560px"
    >
      <el-input
        v-model="metricGenerationPrompt"
        type="textarea"
        :rows="4"
        :placeholder="ot('metricPromptPlaceholder')"
      />
      <template #footer>
        <el-button @click="metricGenerationVisible = false">{{ ot("cancel") }}</el-button>
        <el-button type="primary" :loading="metricGenerating" @click="generateMetricView">
          {{ ot("metricGenerateDraft") }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="testVisible"
      :lock-scroll="false"
      :title="ot('metricTestTitle')"
      width="min(900px, 94cqw)"
    >
      <el-alert :title="ot('metricTestHint')" type="info" :closable="false" />
      <el-form v-if="metricParameters.length" label-position="top" class="test-parameters">
        <el-form-item
          v-for="parameter in metricParameters"
          :key="parameter.name"
          :label="parameter.name || ot('metricUnnamedParameter')"
        >
          <el-input
            v-model="parameter.value"
            :placeholder="parameter.description || ot('metricParameterValue')"
          />
        </el-form-item>
      </el-form>
      <el-tabs v-model="testTab">
        <el-tab-pane :label="ot('metricMarkdownTest')" name="markdown">
          <el-input
            v-model="testMarkdown"
            type="textarea"
            :rows="14"
            readonly
            :placeholder="ot('metricTestResultPlaceholder')"
            class="code-input"
          />
          <el-link v-if="testResultUrl" :href="testResultUrl" target="_blank" type="primary">
            {{ ot("metricOpenFullResult") }}
          </el-link>
        </el-tab-pane>
        <el-tab-pane :label="ot('metricJsonTest')" name="json">
          <el-input
            v-model="testJson"
            type="textarea"
            :rows="14"
            readonly
            :placeholder="ot('metricJsonResultPlaceholder')"
            class="code-input"
          />
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="testVisible = false">{{ ot("close") }}</el-button>
        <el-button type="primary" :icon="Play" :loading="testing" @click="testMetricView">
          {{ ot("metricTestMarkdown") }}
        </el-button>
        <el-button :icon="Play" :loading="testing" @click="testExecuteMetricView">
          {{ ot("metricTestJson") }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="taskResultsVisible"
      :lock-scroll="false"
      :title="ot('taskResultsTitle')"
      width="min(960px, calc(100cqw - 32px))"
      class="task-results-dialog"
    >
      <div class="task-results-content">
        <el-table
          v-loading="taskResultLoading"
          :data="taskResults"
          border
          stripe
          class="task-results-table"
        >
          <el-table-column :label="ot('taskResultTime')" width="190">
            <template #default="{ row }">
              {{ row.executeTimestamp ? new Date(row.executeTimestamp).toLocaleString() : "-" }}
            </template>
          </el-table-column>
          <el-table-column :label="ot('status')" width="90">
            <template #default="{ row }">
              <el-tag :type="row.error ? 'danger' : 'success'">
                {{ row.error ? ot("taskResultFailed") : ot("taskResultSucceeded") }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="spendTime" :label="ot('taskResultElapsed')" width="100" />
          <el-table-column :label="ot('taskResultActions')" width="90">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewTaskResult(row)">
                {{ ot("taskResultView") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="taskResultTotal"
          v-model:current-page="taskResultPage"
          v-model:page-size="taskResultPageSize"
          class="task-pagination"
          layout="total, prev, pager, next"
          :total="taskResultTotal"
          :page-count="taskResultPages"
          @current-change="loadTaskResults"
        />
        <el-alert
          v-if="selectedTaskResult"
          class="task-result-preview"
          :title="selectedTaskResult.error || ot('taskResultOutput')"
          :type="selectedTaskResult.error ? 'error' : 'success'"
          :closable="false"
        >
          <pre>{{
            selectedTaskResult.error || selectedTaskResult.result || ot("taskResultNoOutput")
          }}</pre>
        </el-alert>
      </div>
      <template #footer>
        <el-button @click="taskResultsVisible = false">{{ ot("close") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.asset-detail {
  min-height: 100%;
  background: var(--el-bg-color);
}
.asset-detail.with-explainer-tab {
  display: flex;
  height: 100%;
  flex-direction: column;
}
.detail-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-2xl) 0;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.detail-tab {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
}
.detail-tab.is-active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}
.explainer-pane {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-2xl) var(--spacing-xl);
}
.detail-titlebar {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-2xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.title-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--spacing-xs);
  background: var(--el-border-color);
}
.title-copy {
  min-width: 0;
}
.title-copy strong,
.title-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-copy strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.title-copy small {
  margin-top: 1px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.title-spacer {
  flex: 1;
}
.detail-body {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(460px, 1.4fr);
  gap: var(--spacing-xl);
  padding: var(--spacing-xl) var(--spacing-2xl);
}
.definition-section,
.logic-section,
.task-execution-section {
  min-width: 0;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.section-title {
  display: flex;
  justify-content: space-between;
}
h1,
h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.asset-form {
  margin-top: var(--spacing-xl);
}
.asset-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.asset-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
.asset-form :deep(.el-select) {
  width: 100%;
}
.code-input :deep(textarea) {
  font-family: var(--font-mono);
}
.test-parameters {
  margin: var(--spacing-lg) 0;
}
.generation-option {
  margin-top: var(--spacing-md);
}
.parameter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin: var(--spacing-sm) 0 var(--spacing-xs);
}
.field-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.parameter-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) 28px;
  gap: var(--spacing-sm);
  align-items: center;
  min-width: 0;
  margin-bottom: var(--spacing-sm);
}
.parameter-row > * {
  min-width: 0;
  width: 100%;
}
.parameter-row :deep(.el-input),
.parameter-row :deep(.el-select) {
  min-width: 0;
  width: 100%;
}
.parameter-row > .el-button {
  width: 28px;
  min-width: 28px;
  justify-self: center;
}
.task-pagination {
  margin-top: var(--spacing-lg);
}
.task-result-preview {
  margin-top: var(--spacing-lg);
}
.task-result-preview :deep(pre) {
  max-height: 260px;
  margin: var(--spacing-sm) 0 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
}
.task-detail .detail-body {
  grid-template-columns: minmax(360px, 0.95fr) minmax(360px, 1.05fr);
}
.task-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
}
.task-summary span,
.task-summary strong {
  display: block;
}
.task-summary span {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.task-summary strong {
  margin-top: 4px;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}
.task-hint {
  margin: var(--spacing-lg) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
}
.task-results-content {
  max-height: min(62cqh, 560px);
  overflow: auto;
  padding-right: var(--spacing-xs);
}
.task-results-table {
  min-width: 560px;
}
.task-results-dialog :deep(.el-dialog) {
  max-width: calc(100cqw - var(--spacing-xl));
  margin: 0 auto;
}
.task-results-dialog :deep(.el-dialog__body) {
  padding-top: var(--spacing-md);
  padding-bottom: var(--spacing-md);
}
@container ontology-manager (max-width: 980px) {
  .detail-body {
    grid-template-columns: 1fr;
  }
  .task-detail .detail-body {
    grid-template-columns: 1fr;
  }
}
@container ontology-manager (max-width: 900px) {
  .parameter-row {
    grid-template-columns: 1fr 1fr 28px;
  }
  .parameter-row .el-input:nth-child(3),
  .parameter-row .el-input:nth-child(4),
  .parameter-row .el-input:nth-child(5) {
    grid-column: span 1;
  }
}
@container ontology-manager (max-width: 640px) {
  .detail-titlebar {
    padding: 0 var(--spacing-md);
  }
  .detail-tabs {
    padding: var(--spacing-sm) var(--spacing-md) 0;
  }
  .explainer-pane {
    padding: var(--spacing-md);
  }
  .title-divider,
  .title-copy small {
    display: none;
  }
  .detail-body {
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }
  .task-summary {
    grid-template-columns: 1fr;
  }
  .task-results-content {
    max-height: 58cqh;
  }
  .detail-titlebar :deep(.el-button:not(:first-child)) {
    padding-left: var(--spacing-sm);
    padding-right: var(--spacing-sm);
    font-size: 0;
  }
  .detail-titlebar :deep(.el-button:not(:first-child) .el-icon) {
    margin: 0;
    font-size: 16px;
  }
}
</style>
