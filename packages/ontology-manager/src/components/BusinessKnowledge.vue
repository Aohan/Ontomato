<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  ElButton,
  ElCheckbox,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTag,
  vLoading,
} from "element-plus";
import { ArrowLeft, BookOpen, Check, Pencil, Plus, Search, Trash2 } from "lucide-vue-next";
import type { BusinessKnowledge } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import { useManagerFeedback } from "../feedback";

const context = useManagerContext();
const client = useManagerClient();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { message, confirm } = useManagerFeedback();

type StatusFilter = "all" | "pending" | "approved";
type Segment = { text: string; hit: boolean };

const loading = ref(false);
const saving = ref(false);
const list = ref<BusinessKnowledge[]>([]);
const query = ref("");
const statusFilter = ref<StatusFilter>("all");
const checked = ref<string[]>([]);
const selectedID = ref<string | null>(null);
// Below the narrow breakpoint the list and the detail take turns; this marks that the detail was opened.
const narrowDetail = ref(false);
const editing = ref(false);
const draft = reactive<BusinessKnowledge>(emptyKnowledge());

// Offers this edition's three stored tag values (labels come from Manager messages) and also accepts custom tags.
const tagOptions = computed(() => [
  { value: context.knowledgeTagValues.general, label: ot("knowledgeTagGeneral") },
  { value: context.knowledgeTagValues.business, label: ot("knowledgeTagBusiness") },
  { value: context.knowledgeTagValues.tech, label: ot("knowledgeTagTech") },
]);

function emptyKnowledge(): BusinessKnowledge {
  return { knowledgeID: "", knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 1 };
}

// Space-separated terms, case-insensitive; an entry matches when every term occurs in its title, content or tags.
const terms = computed(() => query.value.trim().toLowerCase().split(/\s+/).filter(Boolean));
const termPattern = computed(() =>
  terms.value.length
    ? new RegExp(
        // Longer terms first, so a term that contains a shorter one is highlighted whole.
        `(${[...terms.value]
          .sort((a, b) => b.length - a.length)
          .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|")})`,
        "gi"
      )
    : null
);

const matched = computed(() => {
  if (!terms.value.length) return list.value;
  const hits = list.value.filter((item) => {
    const text = [item.knowledgeTitle, item.knowledgeText, ...item.knowledgeTags].join("\n").toLowerCase();
    return terms.value.every((term) => text.includes(term));
  });
  const titleHits = (item: BusinessKnowledge) =>
    terms.value.filter((term) => item.knowledgeTitle.toLowerCase().includes(term)).length;
  return hits.sort((a, b) => titleHits(b) - titleHits(a));
});

const counts = computed(() => {
  const pending = matched.value.filter((item) => item.status !== 1).length;
  return { all: matched.value.length, pending, approved: matched.value.length - pending };
});

const visible = computed(() =>
  statusFilter.value === "all"
    ? matched.value
    : matched.value.filter((item) => (item.status === 1) === (statusFilter.value === "approved"))
);

const statusTabs = computed<{ value: StatusFilter; label: string; count: number }[]>(() => [
  { value: "all", label: ot("knowledgeFilterAll"), count: counts.value.all },
  { value: "pending", label: ot("pendingReview"), count: counts.value.pending },
  { value: "approved", label: ot("knowledgeApproved"), count: counts.value.approved },
]);

// The detail follows the chosen entry while it is in the visible list; otherwise (nothing chosen, filtered out,
// deleted, or approved under the pending filter) it shows the first visible entry, so review moves on to the next one.
const selected = computed(
  () => visible.value.find((item) => item.knowledgeID === selectedID.value) ?? visible.value[0] ?? null
);

const allVisibleChecked = computed(
  () => visible.value.length > 0 && visible.value.every((item) => checked.value.includes(item.knowledgeID))
);
const checkedEntries = computed(() => list.value.filter((item) => checked.value.includes(item.knowledgeID)));
const checkedPending = computed(() => checkedEntries.value.filter((item) => item.status !== 1));

function segments(text: string): Segment[] {
  if (!termPattern.value) return [{ text, hit: false }];
  return text
    .split(termPattern.value)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: terms.value.includes(part.toLowerCase()) }));
}

// The list summary starts shortly before the first content hit so that the hit is inside the two visible lines.
function summary(text: string): Segment[] {
  const lower = text.toLowerCase();
  const first = Math.min(...terms.value.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  return Number.isFinite(first) && first > 24 ? segments(`…${text.slice(first - 12)}`) : segments(text);
}

async function load() {
  loading.value = true;
  try {
    list.value = await client.listKnowledge();
    checked.value = checked.value.filter((id) => list.value.some((item) => item.knowledgeID === id));
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeLoadFailed"));
  } finally {
    loading.value = false;
  }
}

function draftChanged() {
  const original = draft.knowledgeID
    ? list.value.find((item) => item.knowledgeID === draft.knowledgeID)
    : emptyKnowledge();
  return JSON.stringify(draft) !== JSON.stringify(original);
}

/** Leaving an edit with unsaved changes asks first; resolves false when the user keeps editing. */
async function leaveEdit() {
  if (!editing.value) return true;
  if (draftChanged()) {
    try {
      await confirm(ot("knowledgeDiscardConfirm"), ot("knowledgeDiscardTitle"));
    } catch {
      return false;
    }
  }
  editing.value = false;
  return true;
}

async function select(item: BusinessKnowledge) {
  if (!(await leaveEdit())) return;
  selectedID.value = item.knowledgeID;
  narrowDetail.value = true;
}

async function openCreate() {
  if (!(await leaveEdit())) return;
  Object.assign(draft, emptyKnowledge());
  editing.value = true;
  narrowDetail.value = true;
}

function openEdit(item: BusinessKnowledge) {
  Object.assign(draft, { ...item, knowledgeTags: [...item.knowledgeTags] });
  editing.value = true;
}

function toggleChecked(id: string, value: boolean) {
  checked.value = value ? [...checked.value, id] : checked.value.filter((item) => item !== id);
}

function toggleAllVisible(value: boolean) {
  const ids = visible.value.map((item) => item.knowledgeID);
  checked.value = value
    ? [...new Set([...checked.value, ...ids])]
    : checked.value.filter((id) => !ids.includes(id));
}

async function save() {
  if (!draft.knowledgeTitle.trim()) {
    message.warning(ot("knowledgeTitleRequired"));
    return;
  }
  saving.value = true;
  try {
    await client.saveKnowledge({ ...draft });
    message.success(ot("knowledgeSaved"));
    editing.value = false;
    // A new entry's ID is assigned by the data engine and not returned, so only an edit keeps its selection.
    selectedID.value = draft.knowledgeID || null;
    await load();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function approve(item: BusinessKnowledge) {
  try {
    await client.saveKnowledge({ ...item, status: 1 });
    message.success(ot("knowledgeApprovedDone"));
    await load();
  } catch (error) {
    message.error(error instanceof Error ? error.message : ot("knowledgeSaveFailed"));
  }
}

async function remove(item: BusinessKnowledge) {
  try {
    await confirm(ot("knowledgeDeleteConfirm", { name: item.knowledgeTitle }), ot("deleteConfirmTitle"));
    await client.deleteKnowledge(item.knowledgeID);
    message.success(ot("knowledgeDeleted"));
    await load();
  } catch (error) {
    if (error !== "cancel")
      message.error(error instanceof Error ? error.message : ot("knowledgeDeleteFailed"));
  }
}

async function approveChecked() {
  const results = await Promise.allSettled(
    checkedPending.value.map((item) => client.saveKnowledge({ ...item, status: 1 }))
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    message.warning(ot("knowledgeBatchApproveFailed", { failed, total: results.length }));
  } else {
    message.success(ot("knowledgeBatchApproved"));
  }
  await load();
}

async function removeChecked() {
  const targets = checkedEntries.value;
  try {
    await confirm(ot("knowledgeBatchDeleteConfirm", { n: targets.length }), ot("deleteConfirmTitle"));
  } catch {
    return;
  }
  const results = await Promise.allSettled(
    targets.map((item) => client.deleteKnowledge(item.knowledgeID))
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    message.warning(ot("knowledgeBatchDeleteFailed", { failed, total: results.length }));
  } else {
    message.success(ot("knowledgeBatchDeleted"));
  }
  await load();
}
onMounted(load);
</script>

<template>
  <section class="business-knowledge" :class="{ 'narrow-detail': narrowDetail }">
    <header class="knowledge-titlebar">
      <h1>{{ t("nav.businessKnowledge") }}</h1>
      <div class="knowledge-actions">
        <el-button
          v-if="context.knowledgeGovernanceUrl"
          tag="a"
          :href="context.knowledgeGovernanceUrl"
          target="_top"
        >
          <BookOpen :size="16" />
          {{ ot("knowledgeGovernance") }}
        </el-button>
        <el-button type="primary" @click="openCreate">
          <Plus :size="16" />
          {{ ot("knowledgeAdd") }}
        </el-button>
      </div>
    </header>

    <div class="knowledge-toolbar">
      <el-input
        v-model="query"
        :prefix-icon="Search"
        :placeholder="ot('knowledgeSearchPlaceholder')"
        clearable
        class="knowledge-search"
      />
      <div class="knowledge-filters" role="tablist">
        <button
          v-for="tab in statusTabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="statusFilter === tab.value"
          :class="['knowledge-filter', { active: statusFilter === tab.value }]"
          @click="statusFilter = tab.value"
        >
          {{ tab.label }} <span>{{ tab.count }}</span>
        </button>
      </div>
    </div>

    <div class="knowledge-body">
      <aside v-loading="loading" class="knowledge-list">
        <div class="knowledge-list-head">
          <template v-if="checked.length">
            <span class="knowledge-checked">{{ ot("knowledgeChecked", { n: checked.length }) }}</span>
            <el-button v-if="checkedPending.length" size="small" @click="approveChecked">
              <Check :size="14" />
              {{ ot("knowledgeBatchApprove") }}
            </el-button>
            <el-button size="small" @click="removeChecked">
              <Trash2 :size="14" />
              {{ ot("knowledgeBatchDelete") }}
            </el-button>
            <el-button size="small" link @click="checked = []">{{ ot("knowledgeClearChecked") }}</el-button>
          </template>
          <el-checkbox
            v-else
            :model-value="allVisibleChecked"
            :disabled="!visible.length"
            @update:model-value="toggleAllVisible(Boolean($event))"
          >
            {{ ot("knowledgeCheckAll") }}
          </el-checkbox>
        </div>
        <div
          v-for="item in visible"
          :key="item.knowledgeID"
          :class="['knowledge-item', { active: !editing && selected?.knowledgeID === item.knowledgeID }]"
        >
          <el-checkbox
            :model-value="checked.includes(item.knowledgeID)"
            class="knowledge-item-check"
            @update:model-value="toggleChecked(item.knowledgeID, Boolean($event))"
          />
          <button type="button" class="knowledge-item-main" @click="select(item)">
            <span class="knowledge-item-title">
              <i :class="['knowledge-dot', { pending: item.status !== 1 }]" />
              <span>
                <template v-for="(part, index) in segments(item.knowledgeTitle)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span class="knowledge-item-summary">
              <template v-for="(part, index) in summary(item.knowledgeText)" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span v-if="item.knowledgeTags.length" class="knowledge-item-tags">
              <el-tag v-for="tag in item.knowledgeTags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
            </span>
          </button>
        </div>
        <el-empty
          v-if="!loading && !visible.length"
          :description="ot(list.length ? 'knowledgeNoMatch' : 'knowledgeNoData')"
          :image-size="72"
        />
      </aside>

      <article class="knowledge-detail">
        <button type="button" class="knowledge-back" @click="narrowDetail = false">
          <ArrowLeft :size="16" />
          {{ ot("knowledgeBackToList") }}
        </button>

        <el-form v-if="editing" :model="draft" label-position="top" class="knowledge-form">
          <h2>{{ ot(draft.knowledgeID ? "knowledgeEdit" : "knowledgeAdd") }}</h2>
          <el-form-item :label="ot('knowledgeTitle')" required>
            <el-input v-model="draft.knowledgeTitle" :placeholder="ot('knowledgeTitlePlaceholder')" />
          </el-form-item>
          <el-form-item :label="ot('knowledgeContent')" required>
            <el-input
              v-model="draft.knowledgeText"
              type="textarea"
              :autosize="{ minRows: 8, maxRows: 24 }"
              :placeholder="ot('knowledgeContentPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="ot('knowledgeTags')">
            <el-select
              v-model="draft.knowledgeTags"
              multiple
              filterable
              allow-create
              :placeholder="ot('knowledgeTagsPlaceholder')"
              class="knowledge-tag-select"
            >
              <el-option
                v-for="option in tagOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="ot('status')">
            <el-radio-group v-model="draft.status">
              <el-radio :value="0">{{ ot("pendingReview") }}</el-radio>
              <el-radio :value="1">{{ ot("knowledgeApproved") }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <div class="knowledge-detail-actions">
            <el-button @click="leaveEdit">{{ ot("cancel") }}</el-button>
            <el-button type="primary" :loading="saving" @click="save">{{ ot("save") }}</el-button>
          </div>
        </el-form>

        <template v-else-if="selected">
          <header class="knowledge-detail-head">
            <h2>
              <template v-for="(part, index) in segments(selected.knowledgeTitle)" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </h2>
            <el-tag v-if="selected.status === 1" type="success">{{ ot("knowledgeApproved") }}</el-tag>
            <el-tag v-else type="warning">{{ ot("pendingReview") }}</el-tag>
          </header>
          <div v-if="selected.knowledgeTags.length" class="knowledge-detail-tags">
            <el-tag v-for="tag in selected.knowledgeTags" :key="tag" size="small" type="info">{{ tag }}</el-tag>
          </div>
          <div class="knowledge-detail-text">
            <template v-for="(part, index) in segments(selected.knowledgeText)" :key="index">
              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
            </template>
          </div>
          <div class="knowledge-detail-actions">
            <el-button v-if="selected.status !== 1" type="success" @click="approve(selected)">
              <Check :size="16" />
              {{ ot("knowledgeApprove") }}
            </el-button>
            <el-button @click="openEdit(selected)">
              <Pencil :size="16" />
              {{ t("common.edit") }}
            </el-button>
            <el-button type="danger" plain @click="remove(selected)">
              <Trash2 :size="16" />
              {{ ot("delete") }}
            </el-button>
          </div>
        </template>

        <el-empty v-else :description="ot('knowledgeSelectHint')" :image-size="72" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.business-knowledge {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.knowledge-titlebar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}
.knowledge-titlebar h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
.knowledge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.business-knowledge :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}
.knowledge-toolbar {
  display: flex;
  flex-wrap: wrap;
  min-height: 54px;
  align-items: center;
  gap: var(--spacing-md);
  margin: var(--spacing-lg) 0;
  padding: 9px var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
}
.knowledge-search {
  flex: 0 1 360px;
  min-width: 0;
}
.knowledge-filters {
  display: flex;
  gap: var(--spacing-xs);
}
.knowledge-filter {
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-regular);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-sm);
}
.knowledge-filter span {
  margin-left: 2px;
  color: var(--el-text-color-secondary);
}
.knowledge-filter:hover {
  background: var(--el-fill-color-light);
}
.knowledge-filter.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-weight: var(--font-semibold);
}
.knowledge-filter.active span {
  color: inherit;
}
.knowledge-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
}
.knowledge-list {
  overflow-y: auto;
  border-right: 1px solid var(--el-border-color);
}
.knowledge-list-head {
  position: sticky;
  z-index: 1;
  top: 0;
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
  font-size: var(--text-sm);
}
.knowledge-list-head :deep(.el-button + .el-button) {
  margin-left: 0;
}
.knowledge-checked {
  margin-right: auto;
  color: var(--el-text-color-secondary);
}
.knowledge-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: 10px var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.knowledge-item:hover {
  background: var(--el-fill-color-lighter);
}
.knowledge-item.active {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.knowledge-item-check {
  height: 22px;
}
.knowledge-item-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.knowledge-item-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: 22px;
}
.knowledge-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--el-color-success);
}
.knowledge-dot.pending {
  background: var(--el-color-warning);
}
.knowledge-item-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-line;
}
.knowledge-item-tags,
.knowledge-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.knowledge-detail {
  overflow-y: auto;
  padding: var(--spacing-lg) var(--spacing-xl);
}
.knowledge-detail h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
}
.knowledge-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
}
.knowledge-detail-tags {
  margin-top: var(--spacing-sm);
}
.knowledge-detail-text {
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}
.knowledge-form h2 {
  margin-bottom: var(--spacing-lg);
}
.knowledge-detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xl);
}
.knowledge-detail-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.knowledge-tag-select {
  width: 100%;
}
.business-knowledge mark {
  border-radius: 2px;
  color: inherit;
  background: var(--el-color-warning-light-7);
}
.knowledge-back {
  display: none;
}
@media (max-width: 760px) {
  .business-knowledge {
    padding: var(--spacing-lg) var(--spacing-md);
  }
  .knowledge-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .knowledge-list {
    border-right: 0;
  }
  .narrow-detail .knowledge-list,
  .business-knowledge:not(.narrow-detail) .knowledge-detail {
    display: none;
  }
  .knowledge-back {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
    padding: 0;
    border: 0;
    color: var(--el-color-primary);
    background: transparent;
    cursor: pointer;
    font-size: var(--text-sm);
  }
}
</style>
