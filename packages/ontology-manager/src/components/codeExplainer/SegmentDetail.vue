<script setup lang="ts">
import { computed } from "vue";
import ConditionTree from "./ConditionTree.vue";
import { simplifyClassName, tokenizeFieldExpr, type CodeSegment } from "./codeSegments";
import { useOntologyText } from "../../context";

const props = defineProps<{ seg: CodeSegment }>();

const { ot } = useOntologyText();

const aliasToClass = computed(() => {
  const map: Record<string, string> = {};
  for (const obj of props.seg.filters?.objects ?? []) map[obj.alias] = obj.class;
  return map;
});

function shortClassOf(source: string): string {
  return simplifyClassName(aliasToClass.value[source] ?? source);
}

const outputFieldTokens = computed(() =>
  (props.seg.output?.fields ?? []).map((field) => ({
    source: field.source,
    tokens: tokenizeFieldExpr(field.field, shortClassOf(field.source)),
  }))
);

const groupByText = computed(() =>
  (props.seg.output?.group_by ?? [])
    .map((item) => `${shortClassOf(item.source)}.${item.field}`)
    .join(", ")
);

const sortText = computed(() =>
  (props.seg.output?.sort ?? [])
    .map((item) => `${shortClassOf(item.source)}.${item.field} ${item.order}`.trim())
    .join(", ")
);

const limitText = computed(() => {
  const limit = props.seg.output?.limit;
  if (!limit) return "";
  return `offset ${limit.offset ?? 0}, count ${limit.count ?? "∞"}`;
});

const hasOutputInfo = computed(
  () =>
    (props.seg.output?.group_by?.length ?? 0) > 0 ||
    (props.seg.output?.sort?.length ?? 0) > 0 ||
    limitText.value !== ""
);
</script>

<template>
  <div v-if="seg.kind === 'QUERY'" class="ce-detail">
    <section v-if="seg.filters && seg.filters.objects.length > 0" class="ce-section">
      <h4>{{ ot("detailObjects") }}</h4>
      <div v-for="obj in seg.filters.objects" :key="obj.alias" class="ce-object-card">
        <div class="ce-object-head">
          <span class="ce-object-alias">{{ obj.alias }}</span>
          <span class="ce-object-class">{{ obj.class }}</span>
        </div>
        <ConditionTree v-if="obj.conditions" :node="obj.conditions" />
      </div>
    </section>
    <section
      v-if="seg.filters && seg.filters.relationship && seg.filters.relationship.length > 0"
      class="ce-section"
    >
      <h4>{{ ot("detailRelations") }}</h4>
      <div v-for="(rel, index) in seg.filters.relationship" :key="index" class="ce-rel-row">
        <span class="ce-rel-alias">{{ rel.from }}</span>
        <span class="ce-rel-arrow">—{{ rel.type }}→</span>
        <span class="ce-rel-alias">{{ rel.to }}</span>
      </div>
    </section>
    <section
      v-if="seg.output && seg.output.fields && seg.output.fields.length > 0"
      class="ce-section"
    >
      <h4>{{ ot("detailOutputFields") }}</h4>
      <ul class="ce-field-list">
        <li v-for="(row, index) in outputFieldTokens" :key="index" class="ce-field-item">
          <span
            v-for="(token, tokenIndex) in row.tokens"
            :key="tokenIndex"
            :class="`ce-fld-${token.type}`"
          >
            {{ token.text }}
          </span>
        </li>
      </ul>
    </section>
    <section v-if="hasOutputInfo" class="ce-section">
      <h4>{{ ot("detailGrouping") }}</h4>
      <div
        v-if="seg.output && seg.output.group_by && seg.output.group_by.length > 0"
        class="ce-info-row"
      >
        <span class="ce-info-label">{{ ot("outputGroupBy") }}</span>
        <span class="ce-info-val">{{ groupByText }}</span>
      </div>
      <div v-if="seg.output && seg.output.sort && seg.output.sort.length > 0" class="ce-info-row">
        <span class="ce-info-label">{{ ot("outputSort") }}</span>
        <span class="ce-info-val">{{ sortText }}</span>
      </div>
      <div v-if="limitText !== ''" class="ce-info-row">
        <span class="ce-info-label">{{ ot("outputLimit") }}</span>
        <span class="ce-info-val">{{ limitText }}</span>
      </div>
    </section>
  </div>

  <div v-else class="ce-detail">
    <section v-if="seg.class" class="ce-section">
      <h4>{{ ot("detailClass") }}</h4>
      <div class="ce-mono">{{ seg.class }}</div>
    </section>
    <section v-if="seg.assignments && seg.assignments.length > 0" class="ce-section">
      <h4>{{ ot("detailAssignments") }}</h4>
      <div v-for="(assign, index) in seg.assignments" :key="index" class="ce-assign-row">
        <span class="ce-assign-field">{{ assign.field }}</span>
        <span class="ce-assign-arrow">←</span>
        <span class="ce-assign-from">{{ assign.valueFrom }}</span>
      </div>
    </section>
    <section v-if="seg.kind === 'UPDATE_OBJECT' || seg.kind === 'DELETE_OBJECT'" class="ce-section">
      <h4>{{ ot("detailConditions") }}</h4>
      <ConditionTree v-if="seg.conditions" :node="seg.conditions" />
      <div v-else class="ce-empty-mini">{{ ot("detailNoCondition") }}</div>
    </section>
    <section v-if="seg.relation" class="ce-section">
      <h4>{{ ot("detailRelation") }}</h4>
      <div class="ce-mono">{{ seg.relation }}</div>
    </section>
    <section v-if="seg.sourceClass || seg.sourceObjectIdFrom" class="ce-section">
      <h4>{{ ot("detailSource") }}</h4>
      <div v-if="seg.sourceClass" class="ce-info-row">
        <span class="ce-info-label">{{ ot("detailClassRow") }}</span>
        <span class="ce-info-val">{{ seg.sourceClass }}</span>
      </div>
      <div v-if="seg.sourceObjectIdFrom" class="ce-info-row">
        <span class="ce-info-label">{{ ot("detailIdSourceRow") }}</span>
        <span class="ce-info-val">{{ seg.sourceObjectIdFrom }}</span>
      </div>
    </section>
    <section v-if="seg.targetClass || seg.targetObjectIdFrom" class="ce-section">
      <h4>{{ ot("detailTarget") }}</h4>
      <div v-if="seg.targetClass" class="ce-info-row">
        <span class="ce-info-label">{{ ot("detailClassRow") }}</span>
        <span class="ce-info-val">{{ seg.targetClass }}</span>
      </div>
      <div v-if="seg.targetObjectIdFrom" class="ce-info-row">
        <span class="ce-info-label">{{ ot("detailIdSourceRow") }}</span>
        <span class="ce-info-val">{{ seg.targetObjectIdFrom }}</span>
      </div>
    </section>
    <section v-if="seg.estRows !== undefined" class="ce-section">
      <h4>{{ ot("detailEstRows") }}</h4>
      <div class="ce-mono">{{ seg.estRows }}</div>
    </section>
  </div>
</template>

<style scoped>
.ce-detail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
.ce-section h4 {
  margin: 0 0 var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.ce-mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  word-break: break-all;
}
.ce-empty-mini {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.ce-object-card {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.ce-object-card + .ce-object-card {
  margin-top: var(--spacing-sm);
}
.ce-object-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}
.ce-object-alias {
  color: var(--el-color-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.ce-object-class {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  word-break: break-all;
}
.ce-rel-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-rel-alias {
  color: var(--el-color-primary);
  font-weight: var(--font-semibold);
}
.ce-rel-arrow {
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.ce-field-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ce-field-item {
  padding: 2px 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
}
.ce-fld-attr {
  color: var(--ce-fld-attr);
  font-weight: var(--font-semibold);
}
.ce-fld-func {
  color: var(--ce-fld-func);
  font-weight: var(--font-semibold);
}
.ce-fld-distinct {
  color: var(--ce-fld-distinct);
  font-style: italic;
}
.ce-fld-op {
  margin: 0 2px;
  color: var(--el-text-color-secondary);
}
.ce-info-row {
  display: flex;
  gap: var(--spacing-sm);
  padding: 2px 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-info-label {
  flex: 0 0 auto;
  min-width: 64px;
  color: var(--el-text-color-secondary);
  font-weight: var(--font-semibold);
}
.ce-info-val {
  color: var(--el-text-color-regular);
  word-break: break-word;
}
.ce-assign-row {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  padding: 2px 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-assign-field {
  color: var(--ce-fld-attr);
  font-weight: var(--font-semibold);
  word-break: break-all;
}
.ce-assign-arrow {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
}
.ce-assign-from {
  color: var(--ce-cond-value);
  word-break: break-word;
}
</style>
