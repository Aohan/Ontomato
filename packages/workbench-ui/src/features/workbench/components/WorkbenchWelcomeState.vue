<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useChatStore } from "../../chat";
import { useLocale } from "../../../composables/useLocale";
import type { WelcomeAnimation } from "../types";

defineProps<{
  mode: "qa" | "analysis";
  animation: WelcomeAnimation;
}>();

const chatStore = useChatStore();
const { input: qaInput, isLoading: qaLoading } = storeToRefs(chatStore);

const { t } = useLocale();

function handleQaKeydown(event: KeyboardEvent, qaLoading: boolean) {
  if (event.key === "Enter" && !event.shiftKey && !qaLoading) {
    event.preventDefault();
    void chatStore.sendMessage();
  }
}
</script>

<template>
  <div class="empty-state-large">
    <div :class="['empty-icon-large', `empty-icon-large--${animation.kind}`]">
      <video
        v-if="animation.kind === 'video'"
        :src="animation.src"
        class="robot-animation-video"
        autoplay
        loop
        muted
        playsinline
      ></video>
      <img v-else :src="animation.src" class="robot-animation-video" :alt="animation.alt" />
    </div>
    <template v-if="mode === 'qa'">
      <div class="empty-text-large">{{ t("app.aiEngine") }}</div>
      <div class="empty-sub-large">{{ t("chat.askDataDesc") }}</div>
      <div class="welcome-input-wrap">
        <textarea
          :value="qaInput"
          :placeholder="t('chat.enterQuery')"
          rows="2"
          @input="qaInput = ($event.target as HTMLTextAreaElement).value"
          @keydown="handleQaKeydown($event, qaLoading)"
        ></textarea>
        <button
          class="welcome-send-btn"
          :disabled="!qaInput.trim() || qaLoading"
          @click="chatStore.sendMessage()"
        >
          {{ t("chat.query") }}
        </button>
      </div>
    </template>
    <template v-else>
      <div class="empty-text-large">{{ t("app.analysisEngine") }}</div>
      <div class="empty-sub-large">{{ t("analysis.selectOrCreateTaskHint") }}</div>
    </template>
  </div>
</template>

<style scoped>
.empty-state-large {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
  margin-top: -100px;
  text-align: center;
  color: var(--el-text-color-secondary);
  background: radial-gradient(
    circle at 50% 28%,
    color-mix(in srgb, var(--el-color-primary) 8%, transparent),
    transparent 32%
  );
}
.empty-icon-large {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* Original sizes of the animated video and the static icon variants. */
.empty-icon-large--video {
  width: 200px;
  height: 200px;
  margin-bottom: -16px;
}
.empty-icon-large--image {
  width: 128px;
  height: 128px;
  margin-bottom: 0;
}
.robot-animation-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.empty-text-large {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}
.empty-sub-large {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 24px;
  line-height: 1.6;
}
.welcome-input-wrap {
  width: 100%;
  max-width: 520px;
  display: flex;
  gap: 8px;
}
.welcome-input-wrap textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 14px;
  font-size: 13px;
  outline: none;
  resize: none;
  height: 68px;
  line-height: 1.5;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: inherit;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.welcome-input-wrap textarea:focus {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}
.welcome-send-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: var(--on-primary);
  border: none;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: var(--shadow-primary);
}
.welcome-send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--el-color-primary-dark-2), var(--el-color-primary));
  box-shadow: var(--shadow-primary-hover);
}
.welcome-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .empty-state-large {
    justify-content: flex-start;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
    margin-top: 0;
    overflow-y: auto;
  }
  :where(html.workbench-mobile-navigation) .empty-icon-large {
    width: 132px;
    height: 132px;
    margin-bottom: -8px;
  }
  :where(html.workbench-mobile-navigation) .empty-sub-large {
    margin-bottom: 18px;
  }
  :where(html.workbench-mobile-navigation) .welcome-input-wrap {
    align-items: stretch;
  }
  :where(html.workbench-mobile-navigation) .welcome-input-wrap textarea {
    min-width: 0;
    height: 56px;
    padding: 8px 10px;
    font-size: 16px;
  }
  :where(html.workbench-mobile-navigation) .welcome-send-btn {
    min-width: 58px;
    padding: 8px 12px;
  }
}
</style>
