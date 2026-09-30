<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ArrowLeft, Plus, Save, Table2, Trash2 } from "lucide-vue-next";
import { ElAlert, ElButton, ElEmpty, ElForm, ElFormItem, ElInput, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyObject, OntologyRelation } from "../api";
import OntologyAttributeCreateDialog from "./OntologyAttributeCreateDialog.vue";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { deleteOntologyObject, loadOntology, updateOntologyObject } = useManagerClient();

const props = defineProps<{ className: string }>();
const emit = defineEmits<{
  back: [];
  updated: [];
  browse: [className: string];
  attribute: [className: string, attributeName: string];
  relation: [relationship: string];
}>();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const object = ref<OntologyObject | null>(null);
const relatedRelations = ref<OntologyRelation[]>([]);
const objectLabels = ref<Record<string, string>>({});
const attributeCreateVisible = ref(false);
const form = reactive({ showName: "", classDesc: "" });

const businessKeyCount = computed(
  () => object.value?.attrs.filter((attribute) => attribute.bizzkeyBool).length || 0
);
const primaryKeyCount = computed(
  () => object.value?.attrs.filter((attribute) => attribute.primaryKey).length || 0
);
const primaryKeyStatus = computed(() => {
  if (!object.value) return null;
  const primaryKeys = object.value.attrs.filter((attribute) => attribute.primaryKey);
  if (primaryKeys.length === 0) {
    return { type: "warning" as const, message: ot("primaryKeyMissing") };
  }
  if (primaryKeys.length > 1) {
    return { type: "error" as const, message: ot("primaryKeyMultiple") };
  }
  if (primaryKeys[0].enable === false) {
    return { type: "warning" as const, message: ot("primaryKeyDisabled") };
  }
  return {
    type: "success" as const,
    message: ot("primaryKeyLabel", { name: primaryKeys[0].showName }),
  };
});

function syncForm(value: OntologyObject | null) {
  form.showName = value?.showName || "";
  form.classDesc = value?.classDesc || "";
}

async function loadDetail() {
  loading.value = true;
  try {
    const ontology = await loadOntology();
    objectLabels.value = Object.fromEntries(
      ontology.objects.map((item) => [item.className, item.showName])
    );
    object.value = ontology.objects.find((item) => item.className === props.className) || null;
    relatedRelations.value = ontology.relations.filter(
      (relation) => relation.fromclass === props.className || relation.toclass === props.className
    );
    syncForm(object.value);
  } catch {
    object.value = null;
    relatedRelations.value = [];
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!object.value) return;
  const showName = form.showName.trim();
  const classDesc = form.classDesc.trim();
  if (!showName) {
    message.warning(ot("fillDisplayName"));
    return;
  }

  const changes: { showName?: string; classDesc?: string } = {};
  if (showName !== object.value.showName) changes.showName = showName;
  if (classDesc !== object.value.classDesc) changes.classDesc = classDesc;
  if (!Object.keys(changes).length) return;

  saving.value = true;
  try {
    await updateOntologyObject(object.value.className, changes);
    object.value = { ...object.value, showName, classDesc };
    message.success(ot("objectSaved"));
    emit("updated");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("objectSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!object.value) return;
  try {
    await confirm(
      ot("deleteObjectConfirm", { name: object.value.showName }),
      ot("deleteConfirmTitle")
    );
    deleting.value = true;
    await deleteOntologyObject(object.value.className);
    message.success(ot("objectDeleted"));
    emit("updated");
    emit("back");
  } catch (error) {
    if (error !== "cancel") {
      message.error(error instanceof Error ? error.message : ot("objectDeleteFailed"));
    }
  } finally {
    deleting.value = false;
  }
}

async function handleAttributeCreated(className: string, attributeName: string) {
  await loadDetail();
  emit("updated");
  emit("attribute", className, attributeName);
}

watch(
  () => props.className,
  () => void loadDetail()
);
onMounted(() => void loadDetail());
</script>

<template>
  <section v-loading="loading" class="object-detail">
    <header class="detail-titlebar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("backToObjectTypes") }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ object?.showName || className }}</strong>
        <small>{{ className }}</small>
      </span>
      <span class="title-spacer"></span>
      <el-button
        v-if="object"
        type="danger"
        plain
        :icon="Trash2"
        :loading="deleting"
        @click="remove"
      >
        {{ ot("delete") }}
      </el-button>
      <el-button v-if="object" :icon="Table2" @click="emit('browse', object.className)">
        {{ ot("browseData") }}
      </el-button>
      <el-button type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("saveChanges") }}
      </el-button>
    </header>

    <div v-if="object" class="detail-body">
      <section class="definition-section">
        <div class="section-title">
          <div>
            <h1>{{ ot("basicInfo") }}</h1>
          </div>
        </div>
        <el-form label-position="top" class="object-form">
          <el-form-item :label="ot('displayName')">
            <el-input v-model="form.showName" maxlength="80" show-word-limit />
          </el-form-item>
          <el-form-item :label="ot('apiName')">
            <el-input :model-value="object.className" disabled />
          </el-form-item>
          <el-form-item class="description-field" :label="ot('businessDescription')">
            <el-input
              v-model="form.classDesc"
              type="textarea"
              :rows="4"
              maxlength="400"
              show-word-limit
            />
          </el-form-item>
        </el-form>
        <div class="object-summary">
          <span>
            <strong>{{ object.attrs.length }}</strong>
            {{ ot("attributeCount") }}
          </span>
          <span>
            <strong>{{ businessKeyCount }}</strong>
            {{ ot("businessKeyCount") }}
          </span>
          <span>
            <strong>{{ primaryKeyCount }}</strong>
            {{ ot("primaryKeyCount") }}
          </span>
          <span>
            <strong>{{ relatedRelations.length }}</strong>
            {{ ot("relationCount") }}
          </span>
        </div>
        <el-alert
          v-if="primaryKeyStatus"
          class="primary-key-alert"
          :type="primaryKeyStatus.type"
          :title="primaryKeyStatus.message"
          :closable="false"
          show-icon
        />
      </section>

      <section class="properties-section">
        <div class="section-title">
          <div>
            <h2>{{ ot("attributes") }}</h2>
          </div>
          <el-button type="primary" :icon="Plus" @click="attributeCreateVisible = true">
            {{ ot("createAttribute") }}
          </el-button>
        </div>
        <div class="detail-table attribute-table">
          <div class="detail-table-head">
            <span>{{ ot("attributes") }}</span>
            <span>{{ ot("dataType") }}</span>
            <span>{{ ot("businessKey") }}</span>
            <span>{{ ot("primaryKey") }}</span>
            <span>{{ ot("description") }}</span>
          </div>
          <button
            v-for="attribute in object.attrs"
            :key="attribute.name"
            class="detail-table-row"
            @click="emit('attribute', object.className, attribute.name)"
          >
            <span>
              <strong>{{ attribute.showName }}</strong>
              <small>{{ attribute.name }}</small>
            </span>
            <span>{{ attribute.type }}</span>
            <span>{{ attribute.bizzkeyBool ? ot("yes") : "-" }}</span>
            <span>{{ attribute.primaryKey ? ot("yes") : "-" }}</span>
            <span>{{ attribute.attrDesc || "-" }}</span>
          </button>
        </div>
      </section>

      <section class="relations-section">
        <div class="section-title">
          <div>
            <h2>{{ ot("relations") }}</h2>
          </div>
          <span class="section-count">{{ relatedRelations.length }} {{ ot("items") }}</span>
        </div>
        <div v-if="relatedRelations.length" class="detail-table relation-table">
          <div class="detail-table-head">
            <span>{{ ot("relationTypesTitle") }}</span>
            <span>{{ ot("sourceObject") }}</span>
            <span>{{ ot("targetObject") }}</span>
            <span>{{ ot("description") }}</span>
          </div>
          <button
            v-for="relation in relatedRelations"
            :key="relation.relationship"
            class="detail-table-row"
            @click="emit('relation', relation.relationship)"
          >
            <span>
              <strong>{{ relation.showName }}</strong>
            </span>
            <span>{{ objectLabels[relation.fromclass] || relation.fromclass }}</span>
            <span>{{ objectLabels[relation.toclass] || relation.toclass }}</span>
            <span>{{ relation.desc || "-" }}</span>
          </button>
        </div>
        <el-empty v-else :description="ot('noObjectRelations')" :image-size="72" />
      </section>
    </div>
    <el-empty v-else-if="!loading" :description="ot('objectMissing')" />
    <OntologyAttributeCreateDialog
      v-model="attributeCreateVisible"
      :class-name="object?.className || className"
      @created="handleAttributeCreated"
    />
  </section>
</template>

<style scoped>
.object-detail {
  min-height: 100%;
  background: var(--el-bg-color);
}
.detail-titlebar {
  display: flex;
  min-height: 64px;
  align-items: center;
  padding: 0 var(--spacing-2xl);
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.title-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--spacing-md);
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
  grid-template-columns: minmax(300px, 0.9fr) minmax(460px, 1.5fr);
  gap: var(--spacing-xl);
  padding: var(--spacing-xl) var(--spacing-2xl);
}
.definition-section {
  grid-row: span 2;
}
.definition-section,
.properties-section,
.relations-section {
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
.section-count {
  padding: 2px 7px;
  border-radius: var(--radius-full);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
}
.object-form {
  margin-top: var(--spacing-xl);
}
.object-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
}
.object-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.object-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spacing-sm);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-light);
}
.object-summary span {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.object-summary strong {
  display: block;
  margin-bottom: 3px;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.primary-key-alert {
  margin-top: var(--spacing-lg);
}
.detail-table {
  overflow: hidden;
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
}
.detail-table-head,
.detail-table-row {
  display: grid;
  align-items: center;
  gap: var(--spacing-md);
}
.attribute-table .detail-table-head,
.attribute-table .detail-table-row {
  grid-template-columns: minmax(150px, 1.2fr) 90px 70px 70px minmax(140px, 1.3fr);
}
.relation-table .detail-table-head,
.relation-table .detail-table-row {
  grid-template-columns: minmax(120px, 1.2fr) minmax(90px, 1fr) minmax(90px, 1fr) minmax(
      140px,
      1.2fr
    );
}
.detail-table-head {
  min-height: 36px;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-dark);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.detail-table-row {
  min-height: 50px;
  padding: 7px var(--spacing-md);
  border: 0;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--text-sm);
  text-align: left;
  transition: background-color var(--transition-fast);
}
.detail-table-row:last-child {
  border-bottom: 0;
}
.detail-table-row:hover {
  background: var(--el-fill-color-light);
}
.detail-table-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-table-row strong,
.detail-table-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-table-row strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.detail-table-row small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
@container ontology-manager (max-width: 1050px) {
  .detail-body {
    grid-template-columns: 1fr;
  }
  .definition-section {
    grid-row: auto;
  }
}
@container ontology-manager (max-width: 900px) {
  .detail-titlebar {
    padding: 0 var(--spacing-md);
  }
  .detail-body {
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }
  .title-divider,
  .title-copy small {
    display: none;
  }
  .attribute-table .detail-table-head,
  .attribute-table .detail-table-row,
  .relation-table .detail-table-head,
  .relation-table .detail-table-row {
    grid-template-columns: minmax(150px, 1fr) 80px;
  }
  .detail-table-head span:nth-child(3),
  .detail-table-head span:nth-child(4),
  .detail-table-head span:nth-child(5),
  .detail-table-row > span:nth-child(3),
  .detail-table-row > span:nth-child(4),
  .detail-table-row > span:nth-child(5) {
    display: none;
  }
}
</style>
