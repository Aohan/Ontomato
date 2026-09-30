<template>
  <div class="ai-chart-toolbar" :data-open="toolbarOpen ? '1' : '0'">
    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="t('dashboard.zoomIn')"
      @click.stop.prevent="emit('openZoom')"
    >
      <Expand class="tool-icon" :size="16" />
    </button>

    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="dataOpen ? t('dashboard.showChart') : t('dashboard.showData')"
      @click.stop.prevent="emit('toggleData')"
    >
      <BarChart3 v-if="dataOpen" class="tool-icon" :size="16" />
      <TableProperties v-else class="tool-icon" :size="16" />
    </button>

    <el-dropdown
      ref="controlDropdownRef"
      trigger="click"
      :hide-on-click="false"
      @visible-change="handleControlDropdownVisibleChange"
    >
      <button class="ai-chart-tool-btn" type="button" :title="t('dataBrowser.filterConditions')">
        <Filter class="tool-icon" :size="16" />
      </button>
      <template #dropdown>
        <div class="ai-chart-control-dropdown">
          <ChartFilterControl
            :conditions="props.conditions"
            :attr-show-name-map="props.attrShowNameMap"
            @conditions-change="handleConditionsChange"
            @visible-change="handleControlVisibleChange"
          />
        </div>
      </template>
    </el-dropdown>

    <!-- AI interpretation entry -->
    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="t('dashboard.aiInterpret')"
      @click.stop.prevent="emit('openAi')"
    >
      <Sparkles class="tool-icon" :size="16" />
    </button>

    <DropdownMenu
      as="button"
      :title="t('common.more')"
      scene="chart"
      trigger-class="ai-chart-tool-btn"
      icon-color="currentColor"
      @command="(cmd) => emit('command', cmd)"
      @visible-change="handleVisibleChange"
    />
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { BarChart3, Filter, Expand, Sparkles, TableProperties } from "lucide-vue-next";
import ChartFilterControl from "./ChartFilterControl.vue";
import DropdownMenu from "./DropdownMenu.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  dataOpen: { type: Boolean, default: false },
  editable: { type: Boolean, default: false },
  disabledTypes: { type: Array, default: () => [] },
  conditions: { type: Array, default: () => [] },
  attrShowNameMap: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
  "openZoom",
  "toggleData",
  "typeChange",
  "command",
  "conditions-change",
  "openAi",
]);

const menuOpen = ref(false);
const typeMenuOpen = ref(false);
const controlMenuOpen = ref(false);
const controlDropdownRef = ref();

const toolbarOpen = computed(() => menuOpen.value || typeMenuOpen.value || controlMenuOpen.value);

function handleVisibleChange(v) {
  menuOpen.value = Boolean(v);
}

function handleControlDropdownVisibleChange(v) {
  controlMenuOpen.value = Boolean(v);
}

function handleConditionsChange(conditions) {
  emit("conditions-change", conditions);
  controlDropdownRef.value?.handleClose?.();
  controlMenuOpen.value = false;
}

function handleControlVisibleChange(v) {
  if (!v && controlMenuOpen.value) controlDropdownRef.value?.handleOpen?.();
}
</script>
<style scoped>
.ai-chart-tool-btn {
  color: var(--el-text-color-regular);
  transition: color var(--transition-base);
}

.ai-chart-tool-btn:hover {
  color: var(--el-text-color-primary);
}

.tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: currentColor;
}
</style>
