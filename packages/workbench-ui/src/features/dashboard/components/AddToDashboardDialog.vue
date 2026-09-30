<template>
  <el-dialog
    v-model="visible"
    :title="t('analysis.addToDashboard')"
    width="520px"
    :close-on-click-modal="false"
    align-center
    @closed="handleClosed"
  >
    <div v-loading="loading">
      <div class="form-row">
        <div class="label">{{ t("nav.dashboard") }}</div>
        <el-select
          ref="dashboardSelectRef"
          v-model="selectedDashboardId"
          :placeholder="t('dashboard.selectDashboard')"
          @change="handleDashboardChange"
        >
          <el-option
            v-for="d in dashboards"
            :key="String(d.id)"
            :label="String(d.name || d.id)"
            :value="String(d.id)"
          />
          <template #footer>
            <el-button class="dash-create" @click="handleCreateDashboard">
              <el-icon class="dash-create__icon"><Plus /></el-icon>
              <span>{{ t("analysis.createDashboard") }}</span>
            </el-button>
          </template>
        </el-select>
      </div>

      <div class="form-row">
        <div class="label">{{ t("common.dimensions") }}</div>
        <el-select
          ref="groupSelectRef"
          v-model="selectedGroupId"
          :placeholder="t('dashboard.selectDimension')"
          :disabled="!canChooseGroup"
          @change="handleGroupChange"
        >
          <el-option
            v-for="g in groups"
            :key="String(g.id)"
            :label="String(g.title || g.id)"
            :value="String(g.id)"
          />
          <template #footer>
            <el-button class="dash-create" :disabled="!canChooseGroup" @click="handleCreateGroup">
              <el-icon class="dash-create__icon"><Plus /></el-icon>
              <span>{{ t("analysis.createDimension") }}</span>
            </el-button>
          </template>
        </el-select>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button
        type="primary"
        :disabled="!canConfirm"
        :loading="submitting"
        @click="handleConfirm"
      >
        {{ t("common.confirm") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus } from "lucide-vue-next";
import { createDimension, fetchDashboardGroups, addChartToDashboard } from "../api";
import { useDashboardStore } from "../stores/dashboard";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const dashboardStore = useDashboardStore();
const { dashboardItems: dashboards, loadingDashboards } = storeToRefs(dashboardStore);

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  threadId: { type: String, default: "" },
  requestSeq: { type: Number, default: -1 },
  datasetIndex: { type: Number, default: -1 },
  datasetTitle: { type: String, default: "" },
});

const emit = defineEmits(["update:modelValue", "added"]);

const groups = ref([]);
const selectedDashboardId = ref("");
const selectedGroupId = ref("");
const dashboardSelectRef = ref(null);
const groupSelectRef = ref(null);

const loadingGroups = ref(false);
const submitting = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const loading = computed(() => loadingDashboards.value || loadingGroups.value);
const canChooseGroup = computed(() => !!selectedDashboardId.value);
const canConfirm = computed(
  () =>
    !submitting.value &&
    !!String(props.threadId || "").trim() &&
    Number.isInteger(Number(props.requestSeq)) &&
    Number(props.requestSeq) >= 0 &&
    Number.isInteger(Number(props.datasetIndex)) &&
    Number(props.datasetIndex) >= 0 &&
    !!selectedDashboardId.value &&
    !!selectedGroupId.value
);

async function loadGroups(dashboardId) {
  loadingGroups.value = true;
  try {
    const list = await fetchDashboardGroups({ id: dashboardId });
    groups.value = Array.isArray(list) ? list : [];
  } catch (e) {
    groups.value = [];
    ElMessage.error(e?.message || t("analysis.getDimensionFailed"));
  } finally {
    loadingGroups.value = false;
  }
}

async function handleDashboardChange(v) {
  const id = String(v || "");
  selectedGroupId.value = "";
  groups.value = [];

  if (!id) return;

  await loadGroups(id);
}

async function handleGroupChange(v) {
  const gid = String(v || "");
  if (!gid) return;
}

async function handleCreateDashboard() {
  dashboardSelectRef.value?.blur?.();

  const { value, action } = await ElMessageBox.prompt(
    t("analysis.enterDashboardName"),
    t("analysis.createDashboard"),
    {
      confirmButtonText: t("common.create"),
      cancelButtonText: t("common.cancel"),
      inputPlaceholder: t("analysis.enterDashboardName"),
      inputValue: "",
    }
  ).catch(() => ({ value: "", action: "cancel" }));

  if (action !== "confirm") return;

  const name = String(value || "").trim();
  if (!name) {
    ElMessage.error(t("analysis.enterDashboardName"));
    return;
  }

  try {
    const created = await dashboardStore.createDashboard(name);
    await dashboardStore.loadDashboards({ notifyError: true });
    selectedDashboardId.value = created?.id ? String(created.id) : "";
    selectedGroupId.value = "";
    groups.value = [];
    if (selectedDashboardId.value) await loadGroups(selectedDashboardId.value);
  } catch (e) {
    ElMessage.error(e?.message || t("analysis.createDashboardFailed"));
  }
}

async function handleCreateGroup() {
  if (!canChooseGroup.value) return;
  groupSelectRef.value?.blur?.();

  const { value, action } = await ElMessageBox.prompt(
    t("analysis.enterDimensionName"),
    t("analysis.createDimension"),
    {
      confirmButtonText: t("common.create"),
      cancelButtonText: t("common.cancel"),
      inputPlaceholder: t("analysis.enterDimensionName"),
      inputValue: "",
    }
  ).catch(() => ({ value: "", action: "cancel" }));

  if (action !== "confirm") return;

  const name = String(value || "").trim();
  if (!name) {
    ElMessage.error(t("analysis.enterDimensionName"));
    return;
  }

  try {
    const did = String(selectedDashboardId.value || "");
    const ok = await createDimension(did, name);
    if (!ok) throw new Error(t("analysis.createDimensionFailed"));
    await loadGroups(did);
    const found = (groups.value || []).find((x) => String(x?.title || "") === name);
    selectedGroupId.value = found?.id ? String(found.id) : "";
  } catch (e) {
    ElMessage.error(e?.message || t("analysis.createDimensionFailed"));
  }
}

async function handleConfirm() {
  if (!canConfirm.value) return;

  submitting.value = true;
  try {
    const payload = {
      threadId: String(props.threadId || "").trim(),
      requestSeq: Number(props.requestSeq),
      datasetIndex: Number(props.datasetIndex),
      datasetTitle: String(props.datasetTitle || "").trim(),
      dashboardId: String(selectedDashboardId.value || ""),
      groupId: String(selectedGroupId.value || ""),
    };
    await addChartToDashboard({
      dashboardId: payload.dashboardId,
      groupId: payload.groupId,
      threadId: payload.threadId,
      requestSeq: payload.requestSeq,
      datasetIndex: payload.datasetIndex,
    });
    ElMessage.success(t("analysis.addedToDashboard"));
    emit("added", payload);
    visible.value = false;
  } catch (e) {
    ElMessage.error(e?.message || t("analysis.addToDashboardFailed"));
  } finally {
    submitting.value = false;
  }
}

function handleClosed() {
  selectedDashboardId.value = "";
  selectedGroupId.value = "";
  groups.value = [];
}

watch(
  () => visible.value,
  async (v) => {
    if (!v) return;
    await dashboardStore.loadDashboards({ notifyError: true });
  }
);
</script>

<style scoped>
.form-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
}

.label {
  width: 100px;
  flex-shrink: 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 32px;
  text-align: right;
}
</style>
