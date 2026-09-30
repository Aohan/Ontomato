<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAgentChat, truncateTitle } from "../../composables/useAgentChat";
import {
  contextLabel,
  detectSessionContext,
  sessionContextLabel,
} from "../../utils/session-context";
import AgentMessage from "./AgentMessage.vue";
import ChatInput from "./ChatInput.vue";
import WelcomePage from "./WelcomePage.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  Route                                                              */
/* ------------------------------------------------------------------ */

const route = useRoute();

/* ------------------------------------------------------------------ */
/*  Agent chat composable                                              */
/* ------------------------------------------------------------------ */

const {
  currentSessionId,
  currentSession,
  messages,
  isSending,
  draft,
  sendMessage,
  stopSending,
  selectSession,
  createSession,
  cleanup,
} = useAgentChat({ onStreamUpdate: () => scrollToBottom() });

/* ------------------------------------------------------------------ */
/*  Local UI state                                                     */
/* ------------------------------------------------------------------ */

const chatContainer = ref<HTMLElement | null>(null);
const draftContext = computed(() => detectSessionContext(route));
const currentContextLabel = computed(() =>
  currentSession.value
    ? sessionContextLabel(currentSession.value)
    : contextLabel(draftContext.value)
);

/* ------------------------------------------------------------------ */
/*  Sync session from route query                                      */
/* ------------------------------------------------------------------ */

watch(
  () => route.query.sessionId as string | undefined,
  async (sessionId) => {
    if (sessionId && sessionId !== currentSessionId.value) {
      await selectSession(sessionId);
      scrollToBottom();
    }
  },
  { immediate: true }
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scrollToBottom() {
  nextTick(() => {
    const el = chatContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function handleSend() {
  const msg = draft.value.trim();
  if (!msg) return;
  if (!currentSessionId.value) {
    const session = await createSession({ title: truncateTitle(msg), context: draftContext.value });
    if (!session) return;
  }
  await sendMessage(msg);
  scrollToBottom();
}

async function handleQuickAction(question: string) {
  /* Create a new session if none exists, then send the question */
  if (!currentSessionId.value) {
    const session = await createSession({
      title: truncateTitle(question),
      context: draftContext.value,
    });
    if (!session) return;
  }
  await sendMessage(question);
  scrollToBottom();
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onBeforeUnmount(() => {
  cleanup();
});
</script>

<template>
  <div class="diagnosis-page">
    <div class="chat-panel">
      <template v-if="currentSessionId">
        <!-- Chat Header -->
        <div class="chat-header">
          <span class="chat-title">
            {{ currentSession?.title || t("diagnosis.diagnosisConversation") }}
          </span>
          <span v-if="currentContextLabel" class="chat-context">
            {{ currentContextLabel }}
          </span>
        </div>

        <!-- Welcome page when no messages -->
        <template v-if="messages.length === 0 && !isSending">
          <WelcomePage @quick-action="handleQuickAction" />
        </template>

        <!-- Messages -->
        <template v-else>
          <div ref="chatContainer" class="chat-messages">
            <div v-for="(msg, i) in messages" :key="i" class="chat-messages__item">
              <AgentMessage :message="msg" :message-index="i" />
            </div>
            <div v-if="isSending" class="typing-indicator">
              <span class="typing-dot" />
              <span class="typing-dot" />
              <span class="typing-dot" />
            </div>
          </div>
        </template>

        <!-- Input -->
        <ChatInput v-model="draft" :is-sending="isSending" @send="handleSend" @stop="stopSending" />
      </template>
      <template v-else>
        <WelcomePage @quick-action="handleQuickAction" />
        <ChatInput v-model="draft" :is-sending="isSending" @send="handleSend" @stop="stopSending" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.diagnosis-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* Chat Panel */

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--observe-border, var(--el-border-color-light));
  border-radius: 8px;
  background: var(--observe-bg-main, var(--el-bg-color));
  overflow: hidden;
  min-width: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--observe-border, var(--el-border-color-light));
  flex-shrink: 0;
}

.chat-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.chat-context {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--el-text-color-secondary);
}

/* Messages */

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}

/* Typing indicator */

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-text-color-secondary);
  animation: typing-bounce 1.4s ease-in-out infinite both;
}

.typing-dot:nth-child(1) {
  animation-delay: 0s;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.16s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes typing-bounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
