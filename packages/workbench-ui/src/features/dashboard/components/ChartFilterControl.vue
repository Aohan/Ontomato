<template>
  <div class="condition-filter">
    <div class="filter-content">
      <div class="header">{{ t("dashboard.queryConditions") }}</div>

      <div v-for="(cond, index) in localConditions" :key="index" class="condition-row">
        <el-input
          class="attr"
          :model-value="attrShowNameOf(cond)"
          :title="attrShowNameOf(cond)"
          size="small"
          disabled
        />
        <el-input class="operator" :model-value="cond.operator" size="small" disabled />

        <div class="value">
          <component
            :is="valueComponentMap[cond.valueType] || FallbackInput"
            v-model="cond.originSample"
            :cond="cond"
            :ui-state="uiStates[index]"
            :options="mergedOptions(index, cond)"
            @remote-query="(q) => handleRemoteQuery(index, q)"
            @remote-visible="(v) => handleRemoteVisible(index, v)"
          />
        </div>
      </div>

      <div v-if="limitCondition" class="limit-row">
        <div class="limit-label">{{ t("dashboard.returnRowCount") }}</div>
        <el-input-number v-model="limitCondition.originSample" :min="1" size="small" />
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" size="small" @click="confirm">{{ t("common.confirm") }}</el-button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, reactive, ref, toRaw, watch } from "vue";
import { queryViewApi } from "../../query-view";

import StringSelect from "./inputs/StringSelect.vue";
import StringArraySelect from "./inputs/StringArraySelect.vue";
import NumberInput from "./inputs/NumberInput.vue";
import NumberArraySelect from "./inputs/NumberArraySelect.vue";
import TimePicker from "./inputs/TimePicker.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  conditions: {
    type: Array,
    required: true,
  },
  attrShowNameMap: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["conditions-change", "visible-change"]);

/* ================== Dynamic component mapping ================== */

const valueComponentMap = {
  STRING: StringSelect,
  STRING_ARRAY: StringArraySelect,
  NUMBER: NumberInput,
  NUMBER_ARRAY: NumberArraySelect,
  TIME: TimePicker,
};

const queryCache = new Map();
const debounceTimers = new Map();

/* ================== Local state ================== */
const localConditions = reactive([]);
const uiStates = reactive([]);
const limitCondition = ref(null);

function buildLocalConditions(conditions) {
  return (Array.isArray(conditions) ? conditions : [])
    .filter((c) => c?.type !== "LIMIT")
    .map((c) => ({
      ...(c || {}),
      originSample: normalizeValue(c || {}),
    }));
}

function buildLimitCondition(conditions) {
  const list = Array.isArray(conditions) ? conditions : [];
  const c = list.find((c) => c?.type === "LIMIT");
  if (!c) return null;
  return reactive({
    ...(c || {}),
    originSample: normalizeValue(c || {}),
  });
}

function resetUiStates(count) {
  uiStates.splice(
    0,
    uiStates.length,
    ...Array.from({ length: count }, () => ({
      options: [],
      loading: false,
      query: "",
    }))
  );
}

watch(
  () => props.conditions,
  (next) => {
    debounceTimers.forEach((t) => clearTimeout(t));
    debounceTimers.clear();

    const list = buildLocalConditions(next);
    localConditions.splice(0, localConditions.length, ...list);
    resetUiStates(list.length);
    limitCondition.value = buildLimitCondition(next);
  },
  { immediate: true, deep: true }
);

watch(
  [
    () => localConditions.map((c) => c.originSample),
    () => (limitCondition.value ? limitCondition.value.originSample : null),
  ],
  () => {
    emit("visible-change", false);
  },
  { deep: true, immediate: false }
);

/* ================== External behavior ================== */

function confirm() {
  emit("conditions-change", snapshotConditions());
}

function attrShowNameOf(cond) {
  const className = String(cond?.className || "").trim();
  const attrName = String(cond?.attrName || "").trim();
  if (!className || !attrName) return attrName;
  const m = props.attrShowNameMap?.[className];
  return (m && m[attrName]) || attrName;
}

function snapshotConditions() {
  const list = localConditions.map((c) => {
    const raw = toRaw(c);
    const rawValue = toRaw(raw.originSample);
    return {
      ...raw,
      originSample: Array.isArray(rawValue) ? [...rawValue] : rawValue,
    };
  });

  if (limitCondition.value) {
    const raw = toRaw(limitCondition.value);
    const rawValue = toRaw(raw.originSample);
    list.push({
      ...raw,
      originSample: Array.isArray(rawValue) ? [...rawValue] : rawValue,
    });
  }

  return list.length ? list : null;
}

/* ================== Remote query ================== */

function mergedOptions(index, cond) {
  const base = uiStates[index]?.options || [];
  const selected = Array.isArray(cond.originSample)
    ? cond.originSample
    : cond.originSample
      ? [cond.originSample]
      : [];

  return Array.from(new Set([...selected, ...base].map((v) => String(v).trim()))).filter(Boolean);
}

function handleRemoteVisible(index, visible) {
  if (!visible) {
    return;
  }
  const st = uiStates[index];
  if (st?.options?.length) return;
  handleRemoteQuery(index, "");
}

function handleRemoteQuery(index, query) {
  const cond = localConditions[index];
  const st = uiStates[index];
  if (!cond || !st) return;

  const className = String(cond.className || "").trim();
  const attrName = String(cond.attrName || "").trim();
  if (!className || !attrName) return;

  const q = String(query || "").trim();
  st.query = q;

  clearTimeout(debounceTimers.get(index));

  const timer = setTimeout(async () => {
    st.loading = true;
    const key = `${className}||${attrName}||${q}`;

    try {
      if (queryCache.has(key)) {
        st.options = queryCache.get(key);
        return;
      }

      const json = await queryViewApi.queryDistinctAttrValue({
        className,
        attrName,
        query: q,
      });

      const list = normalizeDistinctValues(json);
      queryCache.set(key, list);
      if (st.query === q) st.options = list;
    } finally {
      if (st.query === q) st.loading = false;
    }
  }, 250);

  debounceTimers.set(index, timer);
}

onBeforeUnmount(() => {
  debounceTimers.forEach((t) => clearTimeout(t));
  debounceTimers.clear();
});

/* ================== Utilities ================== */

function normalizeDistinctValues(json) {
  return (json?.data || []).map((v) => String(v).trim()).filter(Boolean);
}

function normalizeValue(cond) {
  const { valueType, originSample } = cond;
  const type = String(valueType || "");

  if (type.endsWith("_ARRAY")) {
    if (Array.isArray(originSample)) return originSample;
    if (!originSample) return [];
    return String(originSample)
      .split(",")
      .map((v) => (type === "NUMBER_ARRAY" ? Number(v) : v));
  }

  if (type === "NUMBER") {
    return originSample != null ? Number(originSample) : null;
  }

  if (type === "TIME") {
    if (originSample == null || originSample === "") return "";
    if (typeof originSample === "number" && Number.isFinite(originSample)) {
      const d = new Date(originSample);
      if (Number.isNaN(d.getTime())) return String(originSample);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    return String(originSample);
  }

  return originSample;
}
</script>
<style scoped>
.condition-filter {
  width: 400px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  padding: 16px 16px 40px;
  border-radius: 4px;
  background: var(--el-bg-color);
}
.filter-content {
  max-height: 300px;
  overflow-y: auto;
}
.header {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.condition-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.attr {
  width: 80px;
}
.operator {
  width: 40px;
  text-align: center;
}
.value {
  flex: 1;
}
.limit-row {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.limit-label {
  font-size: 14px;
  font-weight: 600;
}
.actions {
  position: absolute;
  bottom: 10px;
  right: 16px;
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
