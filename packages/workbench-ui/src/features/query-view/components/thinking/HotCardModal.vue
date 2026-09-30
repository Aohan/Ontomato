<script setup lang="ts">
import type { ThinkingBranchCard } from "@ontomato/contracts/query-thinking";
import { ref, watch, onUnmounted, nextTick } from "vue";
import { X, Copy, Check } from "lucide-vue-next";
import { renderMermaidIn } from "../../utils/mermaid";
import { stripTitleFromMd, extractMdTitle } from "../../utils/thinkingUtils";
import HotCardDetail from "./HotCardDetail.vue";

import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../../content";

const { cardCount } = workbenchContent().text;

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  branchLabel: string;
  cards: ThinkingBranchCard[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const copied = ref(false);
const modalBodyRef = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      document.addEventListener("keydown", onKeydown);
      nextTick(() => {
        if (modalBodyRef.value) {
          renderMermaidIn(modalBodyRef.value).catch(() => {});
        }
      });
    } else {
      document.removeEventListener("keydown", onKeydown);
      copied.value = false;
    }
  }
);

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});

async function copyContent() {
  const text = props.cards
    .map((card) => {
      const title = extractMdTitle(card.md);
      let out = `**${title}**\n\n${stripTitleFromMd(card.md)}`;
      if (card.url) out += `\n\n${t("hotData.dataLinkLabel", { url: card.url })}`;
      if (card.parameterInstanceDesc?.length) {
        out +=
          "\n\n" +
          t("hotData.conditionReplacementLabel") +
          "\n" +
          card.parameterInstanceDesc.map((d) => `  ${d}`).join("\n");
      }
      return out;
    })
    .join("\n\n---\n\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-container">
          <div class="modal-header">
            <span class="modal-title">{{ cardCount(branchLabel, cards.length) }}</span>
            <div class="modal-header__actions">
              <button
                v-if="cards.length"
                class="modal-action-btn"
                :class="{ copied }"
                @click="copyContent"
              >
                <Check v-if="copied" :size="14" />
                <Copy v-else :size="14" />
                <span>{{ copied ? t("common.copiedToClipboard") : t("common.copy") }}</span>
              </button>
              <button class="modal-close" @click="emit('close')"><X :size="18" /></button>
            </div>
          </div>
          <div ref="modalBodyRef" class="modal-body">
            <HotCardDetail v-for="(card, ci) in cards" :key="ci" :card="card" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--el-text-color-primary) 20%, transparent);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal-container {
  background: var(--el-bg-color);
  border-radius: 14px;
  box-shadow: 0 16px 48px var(--shadow-dropdown);
  width: 100%;
  max-width: 960px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.modal-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.modal-action-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.modal-action-btn.copied {
  border-color: var(--el-color-success);
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.modal-close {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  transition: background 0.2s;
}
.modal-close:hover {
  background: var(--el-fill-color-light);
}
.modal-body {
  padding: 20px;
  overflow: auto;
  flex: 1;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95);
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 12px;
  }
  .modal-container {
    max-height: 92vh;
  }
}
</style>
