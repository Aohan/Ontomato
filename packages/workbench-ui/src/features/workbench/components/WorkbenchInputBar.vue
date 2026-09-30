<script setup lang="ts">
import { computed } from "vue";
import { useAnalysisStore } from "../../analysis";
import { storeToRefs } from "pinia";
import { useChatStore } from "../../chat";
import { useLocale } from "../../../composables/useLocale";
import type { WorkbenchSelectionMode } from "../types";

defineProps<{
  selectionMode: WorkbenchSelectionMode;
}>();

const chatStore = useChatStore();
const { input: qaInput, isLoading: qaLoading } = storeToRefs(chatStore);
const analysisStore = useAnalysisStore();
const { activeInput: analysisInput, activeSession } = storeToRefs(analysisStore);
const analysisLoading = computed(() => activeSession.value?.isLoading ?? false);

const { t } = useLocale();

function handleQaKeydown(event: KeyboardEvent, qaLoading: boolean) {
  if (event.key === "Enter" && !event.shiftKey && !qaLoading) {
    event.preventDefault();
    void chatStore.sendMessage();
  }
}

function handleAnalysisKeydown(event: KeyboardEvent, analysisLoading: boolean) {
  if (event.key === "Enter" && !event.shiftKey && !analysisLoading) {
    event.preventDefault();
    void analysisStore.sendCurrentMessage();
  }
}
</script>

<template>
  <div class="input-bar">
    <template v-if="selectionMode === 'qa'">
      <textarea
        :value="qaInput"
        :placeholder="t('chat.enterQuery')"
        @input="qaInput = ($event.target as HTMLTextAreaElement).value"
        @keydown="handleQaKeydown($event, qaLoading)"
      ></textarea>
      <button
        v-if="!qaLoading"
        class="qa-send-btn"
        :disabled="!qaInput.trim()"
        @click="chatStore.sendMessage()"
      >
        {{ t("chat.query") }}
      </button>
      <button v-else class="qa-send-btn qa-stop-btn" @click="chatStore.stopGenerating()">
        {{ t("common.stop") }}
      </button>
    </template>
    <template v-else>
      <textarea
        :value="analysisInput"
        :placeholder="t('chat.followUpPlaceholder')"
        @input="analysisStore.updateActiveInput(($event.target as HTMLTextAreaElement).value)"
        @keydown="handleAnalysisKeydown($event, analysisLoading)"
      ></textarea>
      <button
        v-if="!analysisLoading"
        class="qa-send-btn"
        :disabled="!analysisInput.trim()"
        @click="analysisStore.sendCurrentMessage()"
      >
        {{ t("chat.send") }}
      </button>
      <button v-else class="qa-send-btn qa-stop-btn" @click="analysisStore.stopCurrentAnalysis()">
        {{ t("common.stop") }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.input-bar {
  flex-shrink: 0;
  padding: 16px 24px;
  border-top: 1px solid var(--el-border-color);
  display: flex;
  gap: 10px;
  background: var(--el-bg-color);
}
.input-bar textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 14px;
  font-size: 13px;
  outline: none;
  resize: none;
  height: 68px;
  line-height: 1.5;
  font-family: inherit;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.input-bar textarea:focus {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}
.input-bar textarea:disabled {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}
.qa-send-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: var(--on-primary);
  border: none;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: var(--shadow-primary);
}
.qa-send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--el-color-primary-dark-2), var(--el-color-primary));
  box-shadow: var(--shadow-primary-hover);
}
.qa-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.qa-stop-btn {
  background: var(--el-color-danger);
}
.qa-stop-btn:hover:not(:disabled) {
  background: var(--el-color-danger-dark-2);
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .input-bar {
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
    gap: 8px;
  }
  :where(html.workbench-mobile-navigation) .input-bar textarea {
    height: 52px;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 12px;
    font-size: 16px;
  }
  :where(html.workbench-mobile-navigation) .qa-send-btn {
    min-width: 58px;
    padding: 8px 12px;
    border-radius: 12px;
  }
}
</style>
