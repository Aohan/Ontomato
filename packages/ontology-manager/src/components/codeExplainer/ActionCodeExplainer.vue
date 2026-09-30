<script setup lang="ts">
import { computed, ref, watch } from "vue";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import CodeSegmentCard from "./CodeSegmentCard.vue";
import {
  collectKinds,
  findInnermostSegment,
  flattenSegments,
  kindColorVar,
  kindTextKey,
  type CodeSegment,
  type SegmentKind,
} from "./codeSegments";
import { useOntologyText } from "../../context";

hljs.registerLanguage("python", python);

/*
 * Explanation view container: receives the saved code and the normalized segment tree only through props,
 * calls no API and reads no global state. It holds the "active segment" and owns two-way scroll positioning.
 */
const props = defineProps<{ code: string; segments: CodeSegment[] }>();

const { ot } = useOntologyText();

const codePanelRef = ref<HTMLElement | null>(null);
const segPanelRef = ref<HTMLElement | null>(null);
const activeId = ref("");

// After loading, the first segment is active by default; reloading the record returns to the first segment too.
watch(
  () => props.segments,
  (segments) => {
    activeId.value = segments.length > 0 ? segments[0].id : "";
  },
  { immediate: true }
);

const lines = computed(() => props.code.split("\n"));
// highlight.js escapes the source text first and its output contains only its own span markup, so it can be used with v-html directly.
const highlighted = computed(() =>
  lines.value.map(
    (line) => hljs.highlight(line, { language: "python", ignoreIllegals: true }).value
  )
);
const flat = computed(() => flattenSegments(props.segments));
const presentKinds = computed(() => collectKinds(props.segments));

const activeRange = computed(() => {
  const found = flat.value.find((item) => item.seg.id === activeId.value);
  return found ? { start: found.start, end: found.end } : null;
});

const lineActive = computed(() => {
  const range = activeRange.value;
  return lines.value.map(
    (_, index) => range !== null && index + 1 >= range.start && index + 1 <= range.end
  );
});

function scrollCodeToLine(lineNo: number) {
  const panel = codePanelRef.value;
  const el = panel?.children[lineNo - 1];
  if (!panel || !(el instanceof HTMLElement)) return;
  const panelRect = panel.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  panel.scrollTop += elRect.top - panelRect.top - 72;
}

function scrollSegToCard(id: string) {
  const panel = segPanelRef.value;
  if (!panel) return;
  const el = panel.querySelector(`[data-seg-id="${CSS.escape(id)}"]`);
  if (!(el instanceof HTMLElement)) return;
  const panelRect = panel.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  panel.scrollTop += elRect.top - panelRect.top - panel.clientHeight / 2 + elRect.height / 2;
}

function onSelect(seg: CodeSegment) {
  activeId.value = seg.id;
  scrollCodeToLine(seg.codeRange.start);
}

function onLineClick(lineNo: number) {
  // Nothing happens if the line belongs to no segment.
  const found = findInnermostSegment(flat.value, lineNo);
  if (!found) return;
  activeId.value = found.id;
  scrollSegToCard(found.id);
}

function kindLabelOf(kind: SegmentKind): string {
  return ot(kindTextKey(kind));
}
</script>

<template>
  <div class="code-explainer">
    <section class="ce-panel ce-code-panel">
      <header class="ce-panel-head">
        <span class="ce-panel-title">{{ ot("explainerCode") }}</span>
        <span class="ce-panel-meta">{{ ot("explainerLineCount", { count: lines.length }) }}</span>
      </header>
      <div ref="codePanelRef" class="ce-code-body">
        <div
          v-for="(html, index) in highlighted"
          :key="index"
          :class="['ce-line', { 'is-active': lineActive[index] }]"
          @click="onLineClick(index + 1)"
        >
          <span class="ce-line-num">{{ index + 1 }}</span>
          <span class="ce-line-content" v-html="html" />
        </div>
      </div>
    </section>

    <section class="ce-panel ce-seg-panel">
      <header class="ce-panel-head">
        <span class="ce-panel-title">{{ ot("explainerSegTitle") }}</span>
        <span class="ce-panel-meta">{{ ot("explainerSegCount", { count: flat.length }) }}</span>
      </header>
      <div class="ce-legend">
        <span
          v-for="kind in presentKinds"
          :key="kind"
          class="ce-legend-item"
          :style="{ '--kind-color': kindColorVar(kind) }"
        >
          <span class="ce-legend-dot"></span>
          {{ kindLabelOf(kind) }}
        </span>
      </div>
      <div ref="segPanelRef" class="ce-seg-body">
        <CodeSegmentCard
          v-for="seg in segments"
          :key="seg.id"
          :seg="seg"
          :active-id="activeId"
          @select="onSelect"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.code-explainer {
  --seg-QUERY: #1d4ed8;
  --seg-CREATE_OBJECT: #047857;
  --seg-UPDATE_OBJECT: #065f46;
  --seg-DELETE_OBJECT: #b91c1c;
  --seg-CREATE_EDGE: #4d7c0f;
  --seg-DELETE_EDGE: #c2410c;
  --seg-COMPUTE: #6d28d9;
  --seg-EXTERNAL_CALL: #b45309;
  --seg-BRANCH: #a16207;
  --seg-LOOP: #a16207;
  --seg-TRY_CATCH: #7e22ce;
  --seg-ERROR_HANDLING: #991b1b;
  --seg-CUSTOM: #4b5563;
  --ce-tok-comment: #64748b;
  --ce-tok-string: #047857;
  --ce-tok-number: #b45309;
  --ce-tok-keyword: #6d28d9;
  --ce-tok-func: #1d4ed8;
  --ce-fld-attr: #0f766e;
  --ce-fld-func: #1d4ed8;
  --ce-fld-distinct: #b45309;
  --ce-cond-field: #0f766e;
  --ce-cond-operator: #b45309;
  --ce-cond-value: #6d28d9;

  display: flex;
  min-height: 0;
  flex: 1;
  gap: var(--spacing-md);
}

.ontology-manager.is-dark .code-explainer {
  --seg-QUERY: #93c5fd;
  --seg-CREATE_OBJECT: #6ee7b7;
  --seg-UPDATE_OBJECT: #34d399;
  --seg-DELETE_OBJECT: #fca5a5;
  --seg-CREATE_EDGE: #bef264;
  --seg-DELETE_EDGE: #fdba74;
  --seg-COMPUTE: #c4b5fd;
  --seg-EXTERNAL_CALL: #fcd34d;
  --seg-BRANCH: #fde047;
  --seg-LOOP: #fde047;
  --seg-TRY_CATCH: #d8b4fe;
  --seg-ERROR_HANDLING: #f87171;
  --seg-CUSTOM: #cbd5e1;
  --ce-tok-comment: #7d86a8;
  --ce-tok-string: #6ee7b7;
  --ce-tok-number: #fcd34d;
  --ce-tok-keyword: #c4b5fd;
  --ce-tok-func: #7dd3fc;
  --ce-fld-attr: #5eead4;
  --ce-fld-func: #93c5fd;
  --ce-fld-distinct: #fcd34d;
  --ce-cond-field: #5eead4;
  --ce-cond-operator: #fbbf24;
  --ce-cond-value: #c4b5fd;
}

.ce-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.ce-code-panel {
  flex: 55 1 0;
}
.ce-seg-panel {
  flex: 45 1 0;
}
.ce-panel-head {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.ce-panel-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.ce-panel-meta {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.ce-legend {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.ce-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.ce-legend-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 3px;
  background: var(--kind-color);
}
.ce-code-body {
  /* Single-column grid: the auto track is at least as wide as the longest line and stretches when the panel is wider, so
     all lines share one width and the active line's background and left bar span the whole horizontal scroll range, not just its content. */
  display: grid;
  grid-template-columns: auto;
  align-content: start;
  flex: 1 1 auto;
  overflow: auto;
  background: var(--el-fill-color-extra-light);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-line {
  display: flex;
  min-height: 20px;
  cursor: pointer;
}
.ce-line:hover {
  background: var(--el-fill-color);
}
.ce-line.is-active {
  background: var(--el-color-primary-light-9);
}
/* Line numbers stick to the left so they stay visible while long lines scroll horizontally. They cover the line start, so they draw their own background and active left bar. */
.ce-line-num {
  position: sticky;
  left: 0;
  flex: 0 0 auto;
  width: 52px;
  padding-right: var(--spacing-md);
  border-right: 1px solid var(--el-border-color);
  background: var(--el-fill-color-extra-light);
  color: var(--el-text-color-secondary);
  text-align: right;
  user-select: none;
}
.ce-line:hover .ce-line-num {
  background: var(--el-fill-color);
}
.ce-line.is-active .ce-line-num {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.ce-line-content {
  flex: 1 1 auto;
  padding: 0 var(--spacing-md);
  color: var(--el-text-color-primary);
  white-space: pre;
}
/* v-html content has no scoped attribute, so :deep() maps the hljs classes to the existing token variables. */
.ce-line-content :deep(.hljs-comment) {
  color: var(--ce-tok-comment);
}
.ce-line-content :deep(.hljs-string) {
  color: var(--ce-tok-string);
}
.ce-line-content :deep(.hljs-number) {
  color: var(--ce-tok-number);
}
.ce-line-content :deep(.hljs-keyword),
.ce-line-content :deep(.hljs-literal),
.ce-line-content :deep(.hljs-built_in) {
  color: var(--ce-tok-keyword);
  font-weight: var(--font-semibold);
}
.ce-line-content :deep(.hljs-title),
.ce-line-content :deep(.hljs-title.function_) {
  color: var(--ce-tok-func);
}
.ce-seg-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: var(--spacing-md);
}
@media (prefers-reduced-motion: no-preference) {
  .ce-code-body,
  .ce-seg-body {
    scroll-behavior: smooth;
  }
}
@container ontology-manager (max-width: 960px) {
  .code-explainer {
    flex-direction: column;
    overflow-y: auto;
  }
  .ce-panel {
    flex: none;
  }
  .ce-code-body {
    max-height: 40cqh;
  }
  .ce-seg-body {
    overflow: visible;
  }
}
</style>
