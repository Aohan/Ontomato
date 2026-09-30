<script setup lang="ts">
import { computed } from "vue";
import {
  formatConditionValue,
  type ConditionLogicGroup,
  type ConditionNode,
  type ConditionProperties,
} from "./codeSegments";

const props = defineProps<{ node: ConditionNode }>();

function isProperties(node: ConditionNode): node is ConditionProperties {
  return "properties" in node;
}

function isLogic(node: ConditionNode): node is ConditionLogicGroup {
  return "operator" in node && node.operator === "logic";
}

const leafValue = computed(() =>
  "field" in props.node ? formatConditionValue(props.node.value) : ""
);

/* A group with a single child condition shows no AND / OR tag and renders that child directly. */
const singleChild = computed(() => {
  if (!isLogic(props.node)) return null;
  const and = props.node.and ?? [];
  const or = props.node.or ?? [];
  if (and.length + or.length !== 1) return null;
  return and.length === 1 ? and[0] : or[0];
});
</script>

<template>
  <div v-if="isProperties(node)" class="ce-cond-passthrough">
    <ConditionTree :node="node.properties" />
  </div>
  <div v-else-if="singleChild" class="ce-cond-passthrough">
    <ConditionTree :node="singleChild" />
  </div>
  <div v-else-if="isLogic(node)" class="ce-cond-group">
    <div v-if="node.and && node.and.length > 0" class="ce-cond-branch ce-cond-and">
      <span class="ce-cond-op">AND</span>
      <div class="ce-cond-items">
        <ConditionTree v-for="(child, index) in node.and" :key="index" :node="child" />
      </div>
    </div>
    <div v-if="node.or && node.or.length > 0" class="ce-cond-branch ce-cond-or">
      <span class="ce-cond-op">OR</span>
      <div class="ce-cond-items">
        <ConditionTree v-for="(child, index) in node.or" :key="index" :node="child" />
      </div>
    </div>
  </div>
  <div v-else class="ce-cond-leaf">
    <span class="ce-cond-field">{{ node.field }}</span>
    <span class="ce-cond-operator">{{ node.operator }}</span>
    <span class="ce-cond-value">{{ leafValue }}</span>
  </div>
</template>

<style scoped>
.ce-cond-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.ce-cond-branch {
  padding-left: var(--spacing-sm);
  border-left: 2px solid var(--el-border-color-dark);
}
.ce-cond-op {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.05em;
}
.ce-cond-and > .ce-cond-op {
  background: var(--seg-QUERY);
}
.ce-cond-or > .ce-cond-op {
  background: var(--seg-EXTERNAL_CALL);
}
.ce-cond-items {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
}
.ce-cond-leaf {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-cond-field {
  color: var(--ce-cond-field);
  font-weight: var(--font-semibold);
}
.ce-cond-operator {
  margin: 0 var(--spacing-xs);
  color: var(--ce-cond-operator);
}
.ce-cond-value {
  color: var(--ce-cond-value);
  word-break: break-all;
}
</style>
