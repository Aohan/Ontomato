<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElButton, ElEmpty, ElInput, vLoading } from "element-plus";
import { ChevronRight, Plus, Search } from "lucide-vue-next";
import type { OntologyAttribute, OntologyObject, OntologyRelation } from "../api";
import OntologyAttributeCreateDialog from "./OntologyAttributeCreateDialog.vue";
import OntologyRelationCreateDialog from "./OntologyRelationCreateDialog.vue";
import type { ModelResource } from "../workspace";
import { useManagerClient, useOntologyText } from "../context";

const { ot } = useOntologyText();
const { loadOntology } = useManagerClient();

const props = defineProps<{ resource: ModelResource }>();

const emit = defineEmits<{
  createObject: [];
  editObject: [className: string];
  editAttribute: [className: string, attributeName: string];
  editRelation: [relationship: string];
}>();

const query = ref("");
const loading = ref(false);
const objects = ref<OntologyObject[]>([]);
const relations = ref<OntologyRelation[]>([]);
const attributeCreateVisible = ref(false);
const relationCreateVisible = ref(false);

const labelKeys: Record<
  ModelResource,
  {
    title: Parameters<typeof ot>[0];
    description: Parameters<typeof ot>[0];
    search: Parameters<typeof ot>[0];
  }
> = {
  objects: {
    title: "objectTypesTitle",
    description: "objectTypesDesc",
    search: "filterObjectTypes",
  },
  attributes: {
    title: "attributesTitle",
    description: "attributesDesc",
    search: "filterAttributes",
  },
  relations: {
    title: "relationTypesTitle",
    description: "relationTypesDesc",
    search: "filterRelationTypes",
  },
};

const meta = computed(() => {
  const keys = labelKeys[props.resource];
  return { title: ot(keys.title), description: ot(keys.description), search: ot(keys.search) };
});
const normalizedQuery = computed(() => query.value.trim().toLowerCase());

const objectRows = computed(() =>
  objects.value.filter((object) => {
    const text = `${object.showName} ${object.className} ${object.classDesc}`.toLowerCase();
    return !normalizedQuery.value || text.includes(normalizedQuery.value);
  })
);

const attributeRows = computed(() =>
  objects.value
    .flatMap((object) => object.attrs.map((attribute) => ({ object, attribute })))
    .filter(({ object, attribute }) => {
      const text =
        `${attribute.showName} ${attribute.name} ${attribute.type} ${object.showName}`.toLowerCase();
      return !normalizedQuery.value || text.includes(normalizedQuery.value);
    })
);

const relationRows = computed(() =>
  relations.value.filter((relation) => {
    const text =
      `${relation.relationship} ${relation.fromclass} ${relation.toclass} ${relation.desc}`.toLowerCase();
    return !normalizedQuery.value || text.includes(normalizedQuery.value);
  })
);

function objectLabel(className: string) {
  return objects.value.find((object) => object.className === className)?.showName || className;
}

function businessKeyCount(object: OntologyObject) {
  return object.attrs.filter((attribute) => attribute.bizzkeyBool).length;
}

function attributeLabel(attribute: OntologyAttribute) {
  return attribute.showName || attribute.name;
}

async function loadCatalog() {
  loading.value = true;
  try {
    const ontology = await loadOntology();
    objects.value = ontology.objects;
    relations.value = ontology.relations;
  } catch {
    objects.value = [];
    relations.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAttributeCreated(className: string, attributeName: string) {
  await loadCatalog();
  emit("editAttribute", className, attributeName);
}

async function handleRelationCreated(relationship: string) {
  await loadCatalog();
  emit("editRelation", relationship);
}

onMounted(() => {
  void loadCatalog();
});
</script>

<template>
  <section v-loading="loading" class="model-catalog">
    <header class="catalog-titlebar">
      <div>
        <h1>{{ meta.title }}</h1>
        <p>{{ meta.description }}</p>
      </div>
      <div class="title-actions">
        <el-button
          v-if="resource === 'objects'"
          type="primary"
          :icon="Plus"
          @click="emit('createObject')"
        >
          {{ ot("createObjectType") }}
        </el-button>
        <el-button
          v-else-if="resource === 'attributes'"
          type="primary"
          :icon="Plus"
          @click="attributeCreateVisible = true"
        >
          {{ ot("createAttribute") }}
        </el-button>
        <el-button v-else type="primary" :icon="Plus" @click="relationCreateVisible = true">
          {{ ot("createRelationType") }}
        </el-button>
      </div>
    </header>

    <div class="catalog-toolbar">
      <el-input v-model="query" :prefix-icon="Search" :placeholder="meta.search" clearable />
      <span class="resource-count">
        {{
          resource === "objects"
            ? objectRows.length
            : resource === "attributes"
              ? attributeRows.length
              : relationRows.length
        }}
        {{ ot("items") }}
      </span>
    </div>

    <div class="resource-table">
      <template v-if="resource === 'objects'">
        <div class="resource-table-head object-grid">
          <span>{{ ot("objectTypesTitle") }}</span>
          <span>{{ ot("businessDescription") }}</span>
          <span>{{ ot("attributes") }}</span>
          <span>{{ ot("businessKey") }}</span>
          <span></span>
        </div>
        <button
          v-for="object in objectRows"
          :key="object.className"
          class="resource-table-row object-grid"
          @click="emit('editObject', object.className)"
        >
          <span class="resource-name">
            <span>
              <strong>{{ object.showName }}</strong>
              <small>{{ object.className }}</small>
            </span>
          </span>
          <span class="resource-description">{{ object.classDesc }}</span>
          <span>{{ object.attrs.length }}</span>
          <span>{{ businessKeyCount(object) }}</span>
          <ChevronRight :size="16" class="row-chevron" />
        </button>
        <el-empty
          v-if="!loading && objectRows.length === 0"
          :description="ot('notFoundObjectTypes')"
        />
      </template>

      <template v-else-if="resource === 'attributes'">
        <div class="resource-table-head attribute-grid">
          <span>{{ ot("attributes") }}</span>
          <span>{{ ot("ownerObjectType") }}</span>
          <span>{{ ot("dataType") }}</span>
          <span>{{ ot("businessKey") }}</span>
          <span>{{ ot("primaryKey") }}</span>
          <span></span>
        </div>
        <div
          v-for="row in attributeRows"
          :key="`${row.object.className}-${row.attribute.name}`"
          class="resource-table-row attribute-grid"
          role="button"
          tabindex="0"
          @click="emit('editAttribute', row.object.className, row.attribute.name)"
          @keydown.enter.prevent="emit('editAttribute', row.object.className, row.attribute.name)"
          @keydown.space.prevent="emit('editAttribute', row.object.className, row.attribute.name)"
        >
          <span class="resource-name">
            <span>
              <strong>{{ attributeLabel(row.attribute) }}</strong>
              <small>{{ row.attribute.name }}</small>
            </span>
          </span>
          <button
            class="inline-link"
            @click.stop="emit('editObject', row.object.className)"
            @keydown.stop
          >
            {{ row.object.showName }}
          </button>
          <span>{{ row.attribute.type }}</span>
          <span>{{ row.attribute.bizzkeyBool ? ot("yes") : "-" }}</span>
          <span>{{ row.attribute.primaryKey ? ot("yes") : "-" }}</span>
          <ChevronRight :size="16" class="row-chevron" />
        </div>
        <el-empty
          v-if="!loading && attributeRows.length === 0"
          :description="ot('notFoundAttributes')"
        />
      </template>

      <template v-else>
        <div class="resource-table-head relation-grid">
          <span>{{ ot("relationTypesTitle") }}</span>
          <span>{{ ot("sourceObject") }}</span>
          <span>{{ ot("targetObject") }}</span>
          <span>{{ ot("description") }}</span>
          <span></span>
        </div>
        <button
          v-for="relation in relationRows"
          :key="relation.relationship"
          class="resource-table-row relation-grid"
          @click="emit('editRelation', relation.relationship)"
        >
          <span class="resource-name">
            <span>
              <strong>{{ relation.desc || relation.relationship }}</strong>
            </span>
          </span>
          <span>{{ objectLabel(relation.fromclass) }}</span>
          <span>{{ objectLabel(relation.toclass) }}</span>
          <span class="resource-description">{{ relation.desc || "-" }}</span>
          <ChevronRight :size="16" class="row-chevron" />
        </button>
        <el-empty
          v-if="!loading && relationRows.length === 0"
          :description="ot('notFoundRelationTypes')"
        />
      </template>
    </div>
    <OntologyAttributeCreateDialog
      v-model="attributeCreateVisible"
      :objects="objects"
      @created="handleAttributeCreated"
    />
    <OntologyRelationCreateDialog
      v-model="relationCreateVisible"
      :objects="objects"
      :relations="relations.map((relation) => relation.relationship)"
      @created="handleRelationCreated"
    />
  </section>
</template>

<style scoped>
.model-catalog {
  /* The value is supplied by the host presentation (open source: auto). */
  min-height: var(--manager-model-catalog-min-height);
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.catalog-titlebar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}
.title-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.catalog-toolbar {
  display: flex;
  min-height: 54px;
  align-items: center;
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
  padding: 9px var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.catalog-toolbar :deep(.el-input) {
  width: 260px;
}
.resource-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.resource-table {
  overflow: hidden;
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.resource-table-head,
.resource-table-row {
  display: grid;
  width: 100%;
  align-items: center;
  column-gap: var(--spacing-md);
  text-align: left;
}
.resource-table-head {
  min-height: 40px;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-dark);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.resource-table-row {
  min-height: 62px;
  padding: 8px var(--spacing-md);
  border: 0;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.resource-table-row:last-child {
  border-bottom: 0;
}
.resource-table-row:hover {
  background: var(--el-fill-color-light);
}
.object-grid {
  grid-template-columns: minmax(220px, 1.4fr) minmax(240px, 2fr) 88px 88px 20px;
}
.attribute-grid {
  grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 1fr) minmax(120px, 1fr) 88px 88px 20px;
}
.relation-grid {
  grid-template-columns:
    minmax(220px, 1.35fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(180px, 1.6fr)
    20px;
}
.resource-name {
  display: flex;
  min-width: 0;
  align-items: center;
}
.resource-name > span:last-child {
  min-width: 0;
}
.resource-name strong,
.resource-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-name strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.resource-name small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.resource-description {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-link {
  overflow: hidden;
  padding: 0;
  border: 0;
  color: var(--el-color-primary);
  background: transparent;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-link:hover {
  text-decoration: underline;
}
.row-chevron {
  color: var(--el-text-color-tertiary);
}
@container ontology-manager (max-width: 900px) {
  .model-catalog {
    padding: var(--spacing-md);
  }
  .catalog-titlebar {
    min-height: 68px;
  }
  h1 {
    font-size: var(--text-xl);
  }
  .object-grid {
    grid-template-columns: minmax(190px, 1fr) 64px 20px;
  }
  .attribute-grid {
    grid-template-columns: minmax(190px, 1fr) minmax(100px, 1fr) 20px;
  }
  .relation-grid {
    grid-template-columns: minmax(190px, 1fr) minmax(100px, 1fr) 20px;
  }
  .resource-table-head span:nth-child(2),
  .resource-table-head span:nth-child(4),
  .resource-table-row > span:nth-child(2),
  .resource-table-row > span:nth-child(4) {
    display: none;
  }
}
@container ontology-manager (max-width: 560px) {
  .catalog-titlebar {
    align-items: flex-start;
    flex-direction: column;
  }
  .catalog-titlebar :deep(.el-button),
  .catalog-toolbar :deep(.el-input) {
    width: 100%;
  }
  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
