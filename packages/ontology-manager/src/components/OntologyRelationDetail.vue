<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ArrowLeft, ArrowRight, Save, Trash2 } from "lucide-vue-next";
import { ElAlert, ElButton, ElEmpty, ElForm, ElFormItem, ElInput, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { OntologyRelation } from "../api";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const { deleteOntologyRelation, loadOntology, updateOntologyRelation } = useManagerClient();

const props = defineProps<{ relationship: string }>();
const emit = defineEmits<{ back: []; updated: []; object: [className: string] }>();

const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const relation = ref<OntologyRelation | null>(null);
const objectLabels = ref<Record<string, string>>({});
const form = reactive({ desc: "" });

function objectLabel(className: string) {
  return objectLabels.value[className] || className;
}

async function loadDetail() {
  loading.value = true;
  try {
    const ontology = await loadOntology();
    objectLabels.value = Object.fromEntries(
      ontology.objects.map((object) => [object.className, object.showName])
    );
    relation.value =
      ontology.relations.find((item) => item.relationship === props.relationship) || null;
    form.desc = relation.value?.desc || "";
  } catch {
    relation.value = null;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!relation.value) return;
  const desc = form.desc.trim();
  if (!desc) {
    message.warning(ot("fillRelationDescription"));
    return;
  }
  if (desc === relation.value.desc) return;
  saving.value = true;
  try {
    await updateOntologyRelation(relation.value.relationship, desc);
    relation.value.desc = desc;
    relation.value.showName = desc;
    message.success(ot("relationSaved"));
    emit("updated");
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("relationSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!relation.value) return;
  try {
    await confirm(
      ot("deleteRelationConfirm", { name: relation.value.showName }),
      ot("deleteConfirmTitle")
    );
    deleting.value = true;
    await deleteOntologyRelation(relation.value.relationship);
    message.success(ot("relationDeleted"));
    emit("updated");
    emit("back");
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("relationDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

watch(
  () => props.relationship,
  () => void loadDetail()
);
onMounted(() => void loadDetail());
</script>

<template>
  <section v-loading="loading" class="relation-detail">
    <header class="detail-titlebar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ ot("backToRelationTypes") }}
      </el-button>
      <span class="title-divider"></span>
      <span class="title-copy">
        <strong>{{ relation?.showName || relationship }}</strong>
      </span>
      <span class="title-spacer"></span>
      <el-button
        v-if="relation"
        type="danger"
        plain
        :icon="Trash2"
        :loading="deleting"
        @click="remove"
      >
        {{ ot("delete") }}
      </el-button>
      <el-button v-if="relation" type="primary" :icon="Save" :loading="saving" @click="save">
        {{ ot("save") }}
      </el-button>
    </header>
    <div v-if="relation" class="detail-body">
      <section class="definition-section">
        <div class="section-title">
          <div>
            <h1>{{ ot("basicInfo") }}</h1>
          </div>
        </div>
        <el-form label-position="top" class="relation-form">
          <el-form-item :label="ot('apiName')">
            <el-input :model-value="relation.relationship" disabled />
          </el-form-item>
          <el-form-item :label="ot('relationDescription')">
            <el-input
              v-model="form.desc"
              type="textarea"
              :rows="4"
              maxlength="400"
              show-word-limit
            />
          </el-form-item>
        </el-form>
      </section>
      <section class="endpoints-section">
        <div class="section-title">
          <div>
            <h2>{{ ot("objectConnections") }}</h2>
          </div>
        </div>
        <div class="endpoints-flow">
          <button class="endpoint-card" @click="emit('object', relation.fromclass)">
            <span>
              <small>{{ ot("sourceObject") }}</small>
              <strong>{{ objectLabel(relation.fromclass) }}</strong>
              <em class="api-name">{{ relation.fromclass }}</em>
            </span>
          </button>
          <span class="relation-arrow" aria-hidden="true"><ArrowRight :size="18" /></span>
          <button class="endpoint-card" @click="emit('object', relation.toclass)">
            <span>
              <small>{{ ot("targetObject") }}</small>
              <strong>{{ objectLabel(relation.toclass) }}</strong>
              <em class="api-name">{{ relation.toclass }}</em>
            </span>
          </button>
        </div>
        <el-alert
          class="connection-note"
          :title="ot('relationConnectionNote')"
          type="info"
          :closable="false"
          show-icon
        />
      </section>
    </div>
    <el-empty v-else-if="!loading" :description="ot('relationMissing')" />
  </section>
</template>

<style scoped>
.relation-detail {
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
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  gap: var(--spacing-xl);
  padding: var(--spacing-xl) var(--spacing-2xl);
}
.definition-section,
.endpoints-section {
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
.relation-form {
  margin-top: var(--spacing-xl);
}
.relation-form :deep(.el-form-item__label) {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.endpoint-card {
  display: block;
  width: 100%;
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  text-align: left;
}
.endpoint-card:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.endpoint-card small,
.endpoint-card strong,
.endpoint-card em {
  display: block;
}
.endpoint-card .api-name {
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono);
}
.endpoint-card small,
.endpoint-card em {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-style: normal;
}
.endpoint-card strong {
  margin: 3px 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.endpoints-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr);
  align-items: stretch;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}
.relation-arrow {
  display: grid;
  place-items: center;
  color: var(--el-color-primary);
}
.connection-note {
  margin: var(--spacing-lg) 0 0;
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
  .endpoints-flow {
    grid-template-columns: 1fr;
  }
  .relation-arrow {
    height: 24px;
  }
  .relation-arrow :deep(svg) {
    transform: rotate(90deg);
  }
}
</style>
