<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { Send, Square } from "lucide-vue-next";

import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  modelValue: string;
  isSending: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isFocused = ref(false);

/* ------------------------------------------------------------------ */
/*  Auto-resize                                                        */
/* ------------------------------------------------------------------ */

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  /* Clamp to max-height of 200px */
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

watch(
  () => props.modelValue,
  () => {
    nextTick(autoResize);
  }
);

/* ------------------------------------------------------------------ */
/*  Event handlers                                                     */
/* ------------------------------------------------------------------ */

function handleInput(e: Event) {
  const target = e.target as HTMLTextAreaElement;
  emit("update:modelValue", target.value);
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (props.modelValue.trim() && !props.isSending) {
      emit("send");
    }
  }
}

function handleAction() {
  if (props.isSending) {
    emit("stop");
  } else if (props.modelValue.trim()) {
    emit("send");
  }
}
</script>

<template>
  <div class="chat-input-wrapper">
    <div :class="['chat-input-box', { 'chat-input-box--focused': isFocused }]">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        :placeholder="placeholder || t('diagnosis.describeSymptoms')"
        class="chat-input-textarea"
        rows="1"
        @input="handleInput"
        @keydown="handleKeyDown"
        @focus="isFocused = true"
        @blur="isFocused = false"
      />

      <!-- Bottom bar: send/stop action -->
      <div class="chat-input-footer">
        <button
          class="chat-input-action"
          :class="{ 'chat-input-action--stop': isSending }"
          :disabled="!isSending && !modelValue.trim()"
          @click="handleAction"
        >
          <Square v-if="isSending" :size="16" />
          <Send v-else :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input-wrapper {
  padding: 12px 16px;
  flex-shrink: 0;
  border-top: 1px solid var(--observe-border, var(--el-border-color-light));
}

.chat-input-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--observe-border, var(--el-border-color));
  border-radius: 12px;
  background: var(--observe-bg-card, var(--el-bg-color));
  padding: 10px 12px 8px;
  box-shadow: 0 1px 3px var(--shadow-card);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.chat-input-box--focused {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

html.dark .chat-input-box {
  background: var(--observe-bg-card, var(--el-fill-color-dark));
  border-color: var(--observe-border, var(--el-border-color-dark));
  box-shadow: 0 1px 3px var(--shadow-md);
}

html.dark .chat-input-box--focused {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 15%, transparent);
}

.chat-input-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  min-height: 24px;
  max-height: 200px;
  padding: 2px 2px;
}

.chat-input-textarea::placeholder {
  color: var(--el-text-color-placeholder);
}

/* Bottom bar */

.chat-input-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.chat-input-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: var(--on-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background var(--transition-fast),
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.chat-input-action:hover:not(:disabled) {
  opacity: 0.85;
}

.chat-input-action:active:not(:disabled) {
  transform: scale(0.95);
}

.chat-input-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.chat-input-action--stop {
  background: var(--el-color-danger);
}
</style>
