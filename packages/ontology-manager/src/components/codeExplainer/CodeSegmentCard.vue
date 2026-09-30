<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import SegmentDetail from "./SegmentDetail.vue";
import { isExpandableKind, kindColorVar, kindTextKey, type CodeSegment } from "./codeSegments";
import { useOntologyText } from "../../context";

const props = defineProps<{ seg: CodeSegment; activeId: string }>();
const emit = defineEmits<{ select: [seg: CodeSegment] }>();

const { ot } = useOntologyText();
const expanded = ref(false);
const cardRef = ref<HTMLElement | null>(null);

const expandable = computed(() => isExpandableKind(props.seg.kind));
const cardKindColor = computed(() => kindColorVar(props.seg.kind));
const kindText = computed(() => ot(kindTextKey(props.seg.kind)));
const rangeText = computed(() => `L${props.seg.codeRange.start}–${props.seg.codeRange.end}`);

function catchLabel(error: string): string {
  return error ? `catch · ${error}` : "catch";
}

function branchLabel(condition: string): string {
  return condition ? `${ot("segBranchArm")} · ${condition}` : ot("segBranchArm");
}

function select() {
  emit("select", props.seg);
}

async function toggleDetail() {
  expanded.value = !expanded.value;
  if (!expanded.value) return;
  await nextTick();
  const card = cardRef.value;
  const panel = card?.closest(".ce-seg-body");
  if (!(card instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
  const panelRect = panel.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  if (cardRect.bottom > panelRect.bottom) {
    panel.scrollTop += cardRect.top - panelRect.top - 16;
  }
}
</script>

<template>
  <div class="ce-node">
    <article
      ref="cardRef"
      :class="['ce-card', { 'is-active': seg.id === activeId }]"
      :data-seg-id="seg.id"
      :style="{ '--kind-color': cardKindColor }"
      tabindex="0"
      @click="select"
      @keydown.enter="select"
      @keydown.space.prevent="select"
    >
      <div class="ce-card-head">
        <span class="ce-kind">{{ kindText }}</span>
        <span class="ce-seg-id">{{ seg.id }}</span>
        <span class="ce-range">{{ rangeText }}</span>
        <button
          v-if="expandable"
          type="button"
          class="ce-toggle"
          :aria-expanded="expanded"
          @click.stop="toggleDetail"
        >
          {{ expanded ? ot("segDetailCollapse") : ot("segDetailExpand") }}
        </button>
      </div>
      <div class="ce-title">{{ seg.title }}</div>
      <p v-if="seg.narrative" class="ce-narrative">{{ seg.narrative }}</p>
      <div v-if="expandable && expanded" class="ce-detail-wrap" @click.stop>
        <SegmentDetail :seg="seg" />
      </div>
    </article>

    <div
      v-if="
        seg.trySegs.length > 0 ||
        seg.catchs.length > 0 ||
        seg.segs.length > 0 ||
        seg.branchArms.length > 0
      "
      class="ce-children"
    >
      <template v-if="seg.trySegs.length > 0">
        <div class="ce-group-label">try</div>
        <CodeSegmentCard
          v-for="child in seg.trySegs"
          :key="child.id"
          :seg="child"
          :active-id="activeId"
          @select="emit('select', $event)"
        />
      </template>
      <template v-for="(clause, index) in seg.catchs" :key="`catch-${index}`">
        <div class="ce-group-label">{{ catchLabel(clause.error) }}</div>
        <CodeSegmentCard
          v-for="child in clause.segs"
          :key="child.id"
          :seg="child"
          :active-id="activeId"
          @select="emit('select', $event)"
        />
      </template>
      <template v-if="seg.segs.length > 0">
        <div class="ce-group-label">{{ ot("segLoopBody") }}</div>
        <CodeSegmentCard
          v-for="child in seg.segs"
          :key="child.id"
          :seg="child"
          :active-id="activeId"
          @select="emit('select', $event)"
        />
      </template>
      <template v-for="(arm, index) in seg.branchArms" :key="`arm-${index}`">
        <div class="ce-group-label">{{ branchLabel(arm.condition) }}</div>
        <CodeSegmentCard
          v-for="child in arm.segs"
          :key="child.id"
          :seg="child"
          :active-id="activeId"
          @select="emit('select', $event)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ce-node {
  position: relative;
}
.ce-node + .ce-node {
  margin-top: var(--spacing-sm);
}
.ce-card {
  position: relative;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  cursor: pointer;
}
.ce-card::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--kind-color);
}
.ce-card:hover {
  border-color: var(--el-color-primary);
}
.ce-card.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.ce-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.ce-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}
.ce-kind {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--kind-color) 10%, transparent);
  color: var(--kind-color);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
}
.ce-seg-id {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.ce-range {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.ce-toggle {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font-size: var(--text-xs);
}
.ce-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.ce-narrative {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ce-detail-wrap {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--el-border-color);
  cursor: default;
}
.ce-children {
  position: relative;
  margin-top: var(--spacing-xs);
  margin-left: 22px;
  padding-left: var(--spacing-md);
}
.ce-children::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 8px;
  left: 0;
  width: 1px;
  background: var(--el-border-color-dark);
}
.ce-group-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: var(--spacing-sm) 0 var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.ce-group-label::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-border-color-dark);
}
</style>
