<script setup lang="ts">
import { ElButton, ElInput, ElSwitch, ElTag, ElTooltip } from "element-plus";
import { Plus } from "lucide-vue-next";
import { useSharedText } from "../context";

interface AttrDef {
  name: string;
  type: string;
  showName: string;
  attrDesc: string;
  enable: boolean;
  bizzkey: string;
  bizzkeyBool: boolean;
  primaryKey: boolean;
}

interface ClassDef {
  className: string;
  showName: string;
  classDesc: string;
  attrs: AttrDef[];
}

defineProps<{
  selectedNode: ClassDef;
}>();

const emit = defineEmits<{
  close: [];
  updateClassField: [node: ClassDef, field: "showName" | "classDesc", value: string];
  updateAttrField: [
    attr: AttrDef,
    field: "showName" | "attrDesc" | "enable" | "bizzkeyBool",
    value: string | boolean,
  ];
  classShowNameFocus: [node: ClassDef];
  classShowNameBlur: [node: ClassDef];
  saveClassDesc: [node: ClassDef];
  attrEnableChange: [node: ClassDef, attr: AttrDef];
  attrBizKeyChange: [node: ClassDef, attr: AttrDef];
  attrShowNameFocus: [node: ClassDef, attr: AttrDef];
  attrShowNameBlur: [node: ClassDef, attr: AttrDef];
  saveAttrDesc: [node: ClassDef, attr: AttrDef];
  createAttr: [node: ClassDef];
}>();

const { t } = useSharedText();
</script>

<template>
  <div class="right-panel">
    <div class="panel-header">
      <div class="panel-heading-copy">
        <span class="panel-eyebrow">{{ t("hotData.className") }}</span>
        <h2 class="panel-title">{{ selectedNode.showName }}</h2>
        <code>{{ selectedNode.className }}</code>
      </div>
      <el-button text size="small" @click="emit('close')">{{ t("common.close") }}</el-button>
    </div>
    <div class="panel-content">
      <div class="section">
        <div class="section-title">
          <span>{{ t("common.basicInfo") }}</span>
        </div>
        <label class="field">
          <span class="label">{{ t("hotData.displayName") }}</span>
          <el-input
            :model-value="selectedNode.showName"
            size="small"
            :placeholder="t('admin.displayName')"
            @update:model-value="emit('updateClassField', selectedNode, 'showName', String($event))"
            @focus="emit('classShowNameFocus', selectedNode)"
            @blur="emit('classShowNameBlur', selectedNode)"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("common.description") }}</span>
          <el-input
            :model-value="selectedNode.classDesc"
            size="small"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :placeholder="t('hotData.classDesc')"
            @update:model-value="
              emit('updateClassField', selectedNode, 'classDesc', String($event))
            "
            @blur="emit('saveClassDesc', selectedNode)"
          />
        </label>
      </div>

      <div class="section">
        <div class="section-title section-title-count">
          <span>{{ t("hotData.attrList") }}</span>
          <div class="section-title-actions">
            <small>{{ selectedNode.attrs.length }}</small>
            <el-tooltip :content="t('hotData.createAttr')" placement="top">
              <el-button
                class="add-attr-button"
                text
                circle
                size="small"
                :icon="Plus"
                :aria-label="t('hotData.createAttr')"
                @click="emit('createAttr', selectedNode)"
              />
            </el-tooltip>
          </div>
        </div>
        <div v-if="selectedNode.attrs.length === 0" class="empty-hint">
          {{ t("hotData.noAttr") }}
        </div>
        <div v-for="prop in selectedNode.attrs" :key="prop.name" class="attr-item">
          <div class="attr-header">
            <div class="attr-title">
              <strong>{{ prop.showName || prop.name }}</strong>
              <code>{{ prop.name }}</code>
              <el-tag v-if="prop.primaryKey" size="small" type="warning" effect="plain">
                {{ t("hotData.primaryKey") }}
              </el-tag>
            </div>
            <el-tag size="small" effect="plain">{{ prop.type }}</el-tag>
          </div>
          <div class="attr-switches">
            <div class="switch-item">
              <span class="switch-label">{{ t("common.enable") }}</span>
              <el-switch
                :model-value="prop.enable"
                size="small"
                @update:model-value="emit('updateAttrField', prop, 'enable', Boolean($event))"
                @change="emit('attrEnableChange', selectedNode, prop)"
              />
            </div>
            <div class="switch-item">
              <span class="switch-label">{{ t("hotData.mustReturn") }}</span>
              <el-switch
                :model-value="prop.bizzkeyBool"
                size="small"
                @update:model-value="emit('updateAttrField', prop, 'bizzkeyBool', Boolean($event))"
                @change="emit('attrBizKeyChange', selectedNode, prop)"
              />
            </div>
          </div>
          <div class="attr-fields">
            <label class="field compact">
              <span class="label">{{ t("hotData.displayName") }}</span>
              <el-input
                :model-value="prop.showName"
                size="small"
                :placeholder="t('admin.displayName')"
                @update:model-value="emit('updateAttrField', prop, 'showName', String($event))"
                @focus="emit('attrShowNameFocus', selectedNode, prop)"
                @blur="emit('attrShowNameBlur', selectedNode, prop)"
              />
            </label>
            <label class="field compact">
              <span class="label">{{ t("common.description") }}</span>
              <el-input
                :model-value="prop.attrDesc"
                size="small"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 3 }"
                :placeholder="t('hotData.attributeDesc')"
                @update:model-value="emit('updateAttrField', prop, 'attrDesc', String($event))"
                @blur="emit('saveAttrDesc', selectedNode, prop)"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.right-panel {
  width: 360px;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@container ontology-manager (max-width: 900px) {
  .right-panel {
    width: 100%;
    max-height: 46cqh;
    border-top: 1px solid var(--el-border-color);
    border-left: 0;
  }
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
  /* The value is supplied by the host presentation (open source: a solid colour). */
  background: var(--manager-modeling-panel-header-background);
}

.panel-heading-copy {
  min-width: 0;
}

.panel-eyebrow {
  display: block;
  margin-bottom: 3px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.panel-title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-lg);
  background: var(--el-bg-color);
}

.section {
  padding-bottom: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color-light);
}

.section:last-child {
  margin-bottom: 0;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-title small {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  line-height: 18px;
  text-align: center;
}

.section-title-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.add-attr-button {
  color: var(--el-color-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--spacing-md);
}

.field:last-child {
  margin-bottom: 0;
}

.field.compact {
  margin-bottom: var(--spacing-sm);
}

.label {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  font-weight: var(--font-medium);
}

code {
  display: block;
  overflow: hidden;
  margin-top: 3px;
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: var(--spacing-md);
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-md);
}

.attr-item {
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--el-border-color) 60%, transparent);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.attr-item:hover {
  border-color: var(--el-border-color);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--el-text-color-primary) 7%, transparent);
}

.attr-item:last-child {
  margin-bottom: 0;
}

.attr-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.attr-title {
  min-width: 0;
}

.attr-title strong {
  display: block;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attr-switches {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 7px var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-lighter);
}

.switch-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.switch-label {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.attr-fields {
  display: grid;
  gap: var(--spacing-sm);
}

@container ontology-manager (max-width: 1400px) {
  .right-panel {
    width: 300px;
  }
}

@container ontology-manager (max-width: 1024px) {
  .right-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--el-border-color);
  }
}
</style>
