<script setup lang="ts">
import type { FeedbackRecord, FeedbackRating } from "@ontomato/contracts/feedback";

import { ref, nextTick, onMounted, onUnmounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { useChatStore } from "../stores/chat";
import { useDashboardStore } from "../../dashboard";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { ThumbsUp, ThumbsDown, Copy, Check } from "lucide-vue-next";
import SnapshotContent from "./SnapshotContent.vue";
import type { ClarificationOption } from "@ontomato/contracts/chat";
import type { Message, ResponseSnapshot } from "../../../types/chat";
import { setupAiTableEnhancer } from "../utils/table";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { snapshotTurnKey } from "../../diagnosis/utils/workspace-route";
import { feedbackApi } from "../../../api/feedback";
import { workbenchContent } from "../../../content";

const feedbackCopy = workbenchContent().text.feedback;

const { t } = useI18n();

const chatStore = useChatStore();
const dashboardStore = useDashboardStore();
const { messages, tailRevision, isSelectingThread } = storeToRefs(chatStore);
const { creatingDashboardKey } = storeToRefs(dashboardStore);

const feedbackState = ref<Record<number, "like" | "dislike" | null>>({});
const copiedState = ref<Record<number, boolean>>({});
const messagesContainerRef = ref<HTMLElement | null>(null);

const copyContent = async (snapshot: ResponseSnapshot, msgId: number) => {
  try {
    const textToCopy = [snapshot.primaryText, snapshot.analysisText]
      .filter(Boolean)
      .join("\n\n---\n\n");
    if (!textToCopy) {
      ElMessage.warning(t("chat.noContentCopy"));
      return;
    }
    await navigator.clipboard.writeText(textToCopy);
    copiedState.value[msgId] = true;
    ElMessage.success(t("chat.copiedToClipboard"));
    setTimeout(() => {
      copiedState.value[msgId] = false;
    }, 2000);
  } catch {
    ElMessage.error(t("chat.copyFailed"));
  }
};

function findUserInputForMessage(msgId: number): string {
  const index = messages.value.findIndex((msg) => msg.id === msgId);
  for (let i = index - 1; i >= 0; i--) {
    if (messages.value[i]?.role === "user") return messages.value[i].content || "";
  }
  return "";
}

function buildOutput(snapshot: ResponseSnapshot): string {
  return [snapshot.primaryText, snapshot.analysisText].filter(Boolean).join("\n\n---\n\n");
}

function feedbackTargetId(msg: Message): string {
  const turnKey = msg.snapshot ? snapshotTurnKey(msg.snapshot) : "";
  return turnKey || `${msg.snapshot?.threadId || "qa"}:${msg.id}`;
}

function feedbackRecordMatches(
  record: FeedbackRecord,
  snapshot: ResponseSnapshot,
  targetId: string
) {
  if (record.targetId === targetId) return true;
  if (record.threadId && record.threadId === snapshot.threadId) {
    return record.requestSeq === snapshot.requestSeq;
  }
  return false;
}

async function loadFeedbackState() {
  const feedbackMessages = messages.value.filter((msg) => msg.role === "assistant" && msg.snapshot);
  if (!feedbackMessages.length) return;

  const targetIds = Array.from(new Set(feedbackMessages.map(feedbackTargetId).filter(Boolean)));
  const threadId = feedbackMessages.find((msg) => msg.snapshot?.threadId)?.snapshot?.threadId;
  try {
    const data = await feedbackApi.state({
      sourceType: "qa",
      threadId,
      targetIds: threadId ? undefined : targetIds,
      limit: threadId ? 500 : Math.max(20, targetIds.length * 2),
    });
    const nextState: Record<number, FeedbackRating | null> = {};
    for (const msg of feedbackMessages) {
      if (!msg.snapshot) continue;
      const targetId = feedbackTargetId(msg);
      const record = data.records.find((item) =>
        feedbackRecordMatches(item, msg.snapshot!, targetId)
      );
      nextState[msg.id] = record?.rating || null;
    }
    feedbackState.value = { ...feedbackState.value, ...nextState };
  } catch {
    // Feedback state is non-blocking; leave the chat usable if it fails to load.
  }
}

const handleFeedback = async (msg: Message, type: FeedbackRating) => {
  if (!msg.snapshot) return;
  const msgId = msg.id;
  const current = feedbackState.value[msgId];
  if (current === type) {
    try {
      const turnKey = snapshotTurnKey(msg.snapshot);
      await feedbackApi.cancel({
        sourceType: "qa",
        targetId: feedbackTargetId(msg),
        threadId: msg.snapshot.threadId,
        requestSeq: msg.snapshot.requestSeq,
        turnKey: turnKey || undefined,
      });
      feedbackState.value[msgId] = null;
      ElMessage.success(feedbackCopy.cancelled);
    } catch (error: any) {
      ElMessage.error(error?.message || feedbackCopy.cancelFailed);
    }
    return;
  }

  let feedbackText = "";
  if (type === "dislike") {
    try {
      const { value } = await ElMessageBox.prompt(
        feedbackCopy.promptMessage,
        feedbackCopy.promptTitle,
        {
          confirmButtonText: feedbackCopy.submit,
          cancelButtonText: feedbackCopy.cancel,
          inputType: "textarea",
          inputPlaceholder: feedbackCopy.queryPlaceholder,
          inputValidator: (value) => !!String(value || "").trim() || feedbackCopy.required,
        }
      );
      feedbackText = String(value || "").trim();
    } catch {
      return;
    }
  }

  try {
    await feedbackApi.submit({
      sourceType: "qa",
      targetId: feedbackTargetId(msg),
      threadId: msg.snapshot.threadId,
      requestSeq: msg.snapshot.requestSeq,
      rating: type,
      userInput: findUserInputForMessage(msgId),
      assistantOutput: buildOutput(msg.snapshot),
      feedbackText,
      metadata: {
        mode: msg.snapshot.mode,
        status: msg.snapshot.status,
        turnKey: snapshotTurnKey(msg.snapshot) || undefined,
      },
    });
    feedbackState.value[msgId] = type;
    ElMessage.success(type === "like" ? feedbackCopy.thanks : feedbackCopy.submitted);
  } catch (error: any) {
    ElMessage.error(error?.message || feedbackCopy.submitFailed);
  }
};

function handleClarificationSelect(option: ClarificationOption) {
  void chatStore.sendMessage(
    {
      displayText: option.resolvedQuestion,
      submitText: option.resolvedQuestion,
    },
    { updateThreadList: false }
  );
}

watch(
  tailRevision,
  async () => {
    await nextTick();
    const container = messagesContainerRef.value;
    if (container) container.scrollTop = container.scrollHeight;
  },
  { flush: "sync" }
);

let tableEnhancer: { dispose: () => void } | null = null;

onMounted(() => {
  tableEnhancer = setupAiTableEnhancer(".chat-layout");
});

onUnmounted(() => {
  tableEnhancer?.dispose();
});

watch(
  () => messages.value.map((msg) => (msg.snapshot ? feedbackTargetId(msg) : "")).join("|"),
  () => {
    void loadFeedbackState();
  },
  { immediate: true }
);
</script>

<template>
  <div class="chat-layout">
    <div ref="messagesContainerRef" class="messages-scroll">
      <div class="messages-inner">
        <div v-if="isSelectingThread" class="chat-loading-skeleton">
          <div class="skeleton-message skeleton-user">
            <el-skeleton animated :throttle="300">
              <template #template>
                <el-skeleton-item variant="text" style="height: 14px; width: 60%" />
              </template>
            </el-skeleton>
          </div>
          <div class="skeleton-message skeleton-assistant">
            <el-skeleton animated :throttle="300">
              <template #template>
                <div class="skeleton-assistant-lines">
                  <el-skeleton-item variant="text" style="height: 14px; width: 100%" />
                  <el-skeleton-item variant="text" style="height: 14px; width: 85%" />
                  <el-skeleton-item variant="text" style="height: 14px; width: 45%" />
                </div>
              </template>
            </el-skeleton>
          </div>
        </div>

        <div v-for="msg in messages" :key="msg.id" class="message-row" :class="msg.role">
          <div v-if="msg.role === 'user'" class="user-message">
            <div class="user-bubble">
              <p>{{ msg.content }}</p>
            </div>
          </div>

          <div v-else class="assistant-message">
            <div class="assistant-content-wrapper">
              <template v-if="msg.snapshot">
                <SnapshotContent
                  :snapshot="msg.snapshot"
                  :archived="msg.snapshot.source === 'history'"
                  :creating-dashboard-key="creatingDashboardKey"
                  @clarification-select="handleClarificationSelect"
                  @add-to-dashboard="dashboardStore.requestAddToDashboard"
                  @create-dashboard="dashboardStore.createDashboardFromAnalysis"
                />

                <div v-if="msg.snapshot.status === 'streaming'" class="streaming-footer">
                  <span class="streaming-dots" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>

                <div v-if="msg.snapshot.stoppedByUser" class="stopped-badge">
                  {{ t("chat.generationStopped") }}
                </div>

                <div class="message-actions">
                  <button
                    class="ui-icon-btn action-btn"
                    :class="{ active: feedbackState[msg.id] === 'like' }"
                    :title="t('chat.helpful')"
                    @click="handleFeedback(msg, 'like')"
                  >
                    <ThumbsUp
                      :size="14"
                      :stroke-width="feedbackState[msg.id] === 'like' ? 2.6 : 2"
                    />
                  </button>
                  <button
                    class="ui-icon-btn action-btn"
                    :class="{ active: feedbackState[msg.id] === 'dislike' }"
                    :title="t('chat.notHelpful')"
                    @click="handleFeedback(msg, 'dislike')"
                  >
                    <ThumbsDown
                      :size="14"
                      :stroke-width="feedbackState[msg.id] === 'dislike' ? 2.6 : 2"
                    />
                  </button>
                  <button
                    class="ui-icon-btn action-btn"
                    :class="{ copied: copiedState[msg.id] }"
                    :title="t('common.copy')"
                    @click="copyContent(msg.snapshot, msg.id)"
                  >
                    <Check v-if="copiedState[msg.id]" :size="14" />
                    <Copy v-else :size="14" />
                  </button>
                  <TurnDiagnoseButton class="ui-icon-btn action-btn" :turn="msg.snapshot" />
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.messages-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.messages-inner {
  width: 100%;
  max-width: var(--chat-content-max-width);
  margin: 0 auto;
  padding: 32px 20px 0;
}

.chat-loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.skeleton-message {
  max-width: var(--user-message-max-width, 70%);
}

.skeleton-user {
  align-self: flex-end;
  margin-left: auto;
  max-width: var(--user-message-max-width, 60%);
}

.skeleton-assistant-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-row {
  margin-bottom: 32px;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-row.user {
  display: flex;
  justify-content: flex-end;
}

.user-message {
  display: flex;
  max-width: min(85%, 760px);
  margin-left: auto;
}

.user-bubble {
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: var(--on-primary);
  padding: 12px 16px;
  border-radius: 14px 14px 4px 14px;
  font-size: 14px;
}

.user-bubble p {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
}

.assistant-message {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}

.assistant-content-wrapper {
  width: min(100%, 920px);
  min-width: 0;
}

.live-card {
  padding-left: 0;
}

.streaming-footer {
  display: inline-flex;
  align-items: center;
  margin-top: 4px;
  padding: 6px 2px;
}

.stopped-badge {
  display: inline-flex;
  align-items: center;
  margin-top: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}

.streaming-dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.streaming-dots span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--el-color-primary) 72%, white 28%);
  opacity: 0.24;
  box-shadow: 0 0 0 rgba(37, 99, 235, 0);
  animation: streaming-glow 1.2s ease-in-out infinite;
}

.streaming-dots span:nth-child(2) {
  animation-delay: 0.18s;
}

.streaming-dots span:nth-child(3) {
  animation-delay: 0.36s;
}

.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.action-btn {
  border-radius: 10px;
}

.action-btn:hover,
.action-btn.active,
.action-btn.copied {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

@keyframes streaming-glow {
  0%,
  80%,
  100% {
    opacity: 0.24;
    background: color-mix(in srgb, var(--el-color-primary) 68%, white 32%);
    box-shadow: 0 0 0 rgba(37, 99, 235, 0);
  }
  40% {
    opacity: 1;
    background: var(--el-color-primary);
    box-shadow: 0 0 10px rgba(37, 99, 235, 0.32);
  }
}

@media (max-width: 767px) {
  .messages-inner {
    padding: 20px 14px 0;
  }

  .user-message {
    max-width: 88%;
  }
}
</style>
