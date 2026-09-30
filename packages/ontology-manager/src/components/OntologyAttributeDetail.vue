<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ArrowLeft, Save, Trash2 } from "lucide-vue-next";
import { ElButton, ElEmpty, ElForm, ElFormItem, ElInput, ElSwitch, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyAttribute, OntologyObject } from "../api";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { deleteOntologyAttribute, loadOntology, updateOntologyAttribute } = useManagerClient();

const props = defineProps<{ className: string; attributeName: string }>();
const emit = defineEmits<{ back: []; updated: []; object: [className: string] }>();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const owner = ref<OntologyObject | null>(null);
const attribute = ref<OntologyAttribute | null>(null);
const form = reactive({
  showName: "",
  attrDesc: "",
  enable: true,
  bizzkeyBool: false,
  primaryKey: false,
});

function syncForm(value: OntologyAttribute | null) {
  form.showName = value?.showName || "";
  form.attrDesc = value?.attrDesc || "";
  form.enable = value?.enable !== false;
  form.bizzkeyBool = Boolean(value?.bizzkeyBool);
  form.primaryKey = Boolean(value?.primaryKey);
}

async function loadDetail() {
  loading.value = true;
  try {
    const ontology = await loadOntology();
    owner.value = ontology.objects.find((item) => item.className === props.className) || null;
    attribute.value = owner.value?.attrs.find((item) => item.name === props.attributeName) || null;
    syncForm(attribute.value);
  } catch {
    owner.value = null;
    attribute.value = null;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!attribute.value || !owner.value) return;
  const showName = form.showName.trim();
  if (!showName) {
    message.warning(ot("fillDisplayName"));
    return;
  }
  const changes: Parameters<typeof updateOntologyAttribute>[2] = {};
  if (showName !== attribute.value.showName) changes.showName = showName;
  if (form.attrDesc.trim() !== (attribute.value.attrDesc || ""))
    changes.attrDesc = form.attrDesc.trim();
  if (form.enable !== (attribute.value.enable !== false)) changes.enable = form.enable;
  if (form.bizzkeyBool !== Boolean(attribute.value.bizzkeyBool))
    changes.bizzkeyBool = form.bizzkeyBool;
  if (form.primaryKey && !attribute.value.primaryKey) changes.primaryKey = true;
  if (!Object.keys(changes).length) return;

  saving.value = true;
  try {
    await updateOntologyAttribute(owner.value.className, attribute.value, changes);
    Object.assign(attribute.value, { ...changes, showName, attrDesc: form.attrDesc.trim() });
    message.success(ot("attributeSaved"));
    emit("updated");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("attributeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!attribute.value || !owner.value) return;
  try {
    await confirm(
      ot("deleteAttributeConfirm", { name: attribute.value.showName }),
      ot("deleteConfirmTitle")
    );
    deleting.value = true;
    await deleteOntologyAttribute(owner.value.className, attribute.value.name);
    message.success(ot("attributeDeleted"));
    emit("updated");
    emit("back");
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("attributeDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

watch([() => props.className, () => props.attributeName], () => void loadDetail());
onMounted(() => void loadDetail());
</script>

<template>
  <section v-loading="loading" class="attribute-detail">
    <header class="detail-titlebar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("backToAttributes") }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ attribute?.showName || attributeName }}</strong>
        <small>{{ attributeName }}</small>
      </span>
      <span class="title-spacer"></span>
      <el-button
        v-if="attribute"
        type="danger"
        plain
        :icon="Trash2"
        :loading="deleting"
        @click="remove"
      >
        {{ ot("delete") }}
      </el-button>
      <el-button v-if="attribute" type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("save") }}
      </el-button>
    </header>
    <div v-if="attribute && owner" class="detail-body">
      <section class="definition-section">
        <div class="section-title">
          <div>
            <h1>{{ ot("basicInfo") }}</h1>
          </div>
        </div>
        <el-form label-position="top" class="attribute-form">
          <el-form-item :label="ot('displayName')">
            <el-input v-model="form.showName" maxlength="80" show-word-limit />
          </el-form-item>
          <el-form-item :label="ot('apiName')">
            <el-input :model-value="attribute.name" disabled />
          </el-form-item>
          <el-form-item :label="ot('dataType')">
            <el-input :model-value="attribute.type" disabled />
          </el-form-item>
          <el-form-item :label="ot('description')">
            <el-input
              v-model="form.attrDesc"
              type="textarea"
              :rows="4"
              maxlength="400"
              show-word-limit
            />
          </el-form-item>
        </el-form>
      </section>
      <section class="configuration-section">
        <div class="section-title">
          <div>
            <h2>{{ owner.showName }}</h2>
            <p>{{ owner.className }}</p>
          </div>
          <el-button text @click="emit('object', owner.className)">
            {{ ot("openObjectType") }}
          </el-button>
        </div>
        <div class="setting-row">
          <span>
            <strong>{{ ot("enableAttribute") }}</strong>
            <small>{{ ot("enableAttributeDesc") }}</small>
          </span>
          <el-switch v-model="form.enable" />
        </div>
        <div class="setting-row">
          <span>
            <strong>{{ ot("businessKey") }}</strong>
            <small>{{ ot("businessKeyDesc") }}</small>
          </span>
          <el-switch v-model="form.bizzkeyBool" />
        </div>
        <div class="setting-row">
          <span>
            <strong>{{ ot("primaryKey") }}</strong>
            <small>{{ ot("primaryKeyDesc") }}</small>
          </span>
          <el-switch v-model="form.primaryKey" :disabled="attribute.primaryKey" />
        </div>
      </section>
    </div>
    <el-empty v-else-if="!loading" :description="ot('attributeMissing')" />
  </section>
</template>

<style scoped>
.attribute-detail {
  min-height: 100%;
  background: var(--el-bg-color);
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
  grid-template-columns: minmax(320px, 0.9fr) minmax(360px, 1.1fr);
  gap: var(--spacing-xl);
  padding: var(--spacing-xl) var(--spacing-2xl);
}
.definition-section,
.configuration-section {
  min-width: 0;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
}
h1,
h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.section-title p {
  margin: 3px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.attribute-form {
  margin-top: var(--spacing-xl);
}
.attribute-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
.attribute-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  margin-top: var(--spacing-xl);
  padding-top: var(--spacing-xl);
  border-top: 1px solid var(--el-border-color-light);
}
.setting-row strong,
.setting-row small {
  display: block;
}
.setting-row strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.setting-row small {
  max-width: 360px;
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}
@container ontology-manager (max-width: 850px) {
  .detail-body {
    grid-template-columns: 1fr;
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }
  .detail-titlebar {
    padding: 0 var(--spacing-md);
  }
  .title-divider,
  .title-copy small {
    display: none;
  }
}
</style>
