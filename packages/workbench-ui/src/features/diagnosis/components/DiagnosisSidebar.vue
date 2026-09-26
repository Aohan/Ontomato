<script setup lang="ts">
import type { SessionInfo as AgentSession } from "@ontomato/contracts/diagnosis";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ChevronDown, X, MessageSquare } from "lucide-vue-next";
import { useAgentChat, truncateTitle } from "../composables/useAgentChat";

import { contextLabel, detectSessionContext, sessionContextLabel } from "../utils/session-context";
import AgentMessage from "./agent-chat/AgentMessage.vue";
import ChatInput from "./agent-chat/ChatInput.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ------------------------------------------------------------------ */
/*  Props / Emits                                                      */
/* ------------------------------------------------------------------ */

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ "update:visible": [value: boolean] }>();

/* ------------------------------------------------------------------ */
/*  Agent chat composable (shared Pinia store)                         */
/* ------------------------------------------------------------------ */

const {
  sessions,
  currentSessionId,
  currentSession,
  messages,
  isSending,
  draft,
  sendMessage,
  stopSending,
  loadSessions,
  createSession,
  selectSession,
  clearSession,
  cleanup,
} = useAgentChat({
  onStreamUpdate: () => scrollToBottom(),
});

/* ------------------------------------------------------------------ */
/*  Local UI state                                                     */
/* ------------------------------------------------------------------ */

const route = useRoute();
const chatContainer = ref<HTMLElement | null>(null);
const sessionDropdownOpen = ref(false);

const currentContextLabel = computed(() => {
  return contextLabel(detectSessionContext(route));
});

/* ------------------------------------------------------------------ */
/*  Header display                                                     */
/* ------------------------------------------------------------------ */

const currentTitle = computed(() => {
  if (!currentSessionId.value) return t("chat.newConversation");
  const s = sessions.value.find((s) => s.id === currentSessionId.value);
  if (!s) return t("chat.newConversation");
  const title = s.title || s.id.slice(0, 8);
  return title.length > 20 ? title.slice(0, 20) + "..." : title;
});

const currentCtxLabel = computed(() => {
  if (!currentSessionId.value) return currentContextLabel.value;
  const s = sessions.value.find((s) => s.id === currentSessionId.value);
  return s ? sessionContextLabel(s) : currentContextLabel.value;
});

function toggleSessionDropdown() {
  sessionDropdownOpen.value = !sessionDropdownOpen.value;
}

function closeDropdown() {
  sessionDropdownOpen.value = false;
}

async function handleDropdownNewChat() {
  clearSession();
  sessionDropdownOpen.value = false;
  scrollToBottom();
}

async function handleDropdownSelect(id: string) {
  sessionDropdownOpen.value = false;
  if (id !== currentSessionId.value) {
    await selectSession(id);
    scrollToBottom();
  }
}

function sessionItemLabel(s: AgentSession): string {
  const title = s.title || s.id.slice(0, 8);
  return title.length > 24 ? title.slice(0, 24) + "..." : title;
}

/* ------------------------------------------------------------------ */
/*  Auto session load on open                                          */
/* ------------------------------------------------------------------ */

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await loadSessions();
      scrollToBottom();
    }
  }
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

  if (!currentSessionId.value || !currentSession.value) {
    const ctx = detectSessionContext(route);
    const session = await createSession({
      title: truncateTitle(msg),
      context: ctx,
    });
    if (!session) return;
  }
  await sendMessage(msg);
  scrollToBottom();
}

async function startNewContextDiagnosis(message: string): Promise<boolean> {
  const msg = message.trim();
  if (!msg) return false;

  closeDropdown();
  await loadSessions();
  clearSession();

  const ctx = detectSessionContext(route);
  const session = await createSession({
    title: truncateTitle(msg),
    context: ctx,
  });

  if (!session) return false;

  void sendMessage(msg).finally(() => scrollToBottom());
  scrollToBottom();
  return true;
}

function closeSidebar() {
  emit("update:visible", false);
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onBeforeUnmount(() => {
  cleanup();
});

defineExpose({
  startNewContextDiagnosis,
});
</script>

<template>
  <!-- Sidebar panel -- embedded in layout, not teleported -->
  <Transition name="sidebar-slide">
    <div v-if="visible" class="diagnosis-sidebar">
      <!-- Compact header: session switcher + close button -->
      <div class="sidebar-header">
        <div class="session-switcher" @click="toggleSessionDropdown">
          <span class="session-title">{{ currentTitle }}</span>
          <span v-if="currentCtxLabel" class="session-context-tag">{{ currentCtxLabel }}</span>
          <ChevronDown class="session-chevron" :class="{ open: sessionDropdownOpen }" :size="14" />
        </div>
        <button class="close-btn" @click="closeSidebar">
          <X :size="16" />
        </button>
      </div>

      <!-- Session dropdown -->
      <div v-if="sessionDropdownOpen" class="session-dropdown-backdrop" @click="closeDropdown" />
      <Transition name="dropdown-fade">
        <div v-if="sessionDropdownOpen" class="session-dropdown">
          <div class="session-dropdown-item new-chat" @click="handleDropdownNewChat">
            <span class="new-chat-icon">+</span>
            <span>{{ t("chat.newConversation") }}</span>
          </div>
          <div class="session-dropdown-divider" />
          <div class="session-dropdown-list">
            <div
              v-for="s in sessions"
              :key="s.id"
              :class="['session-dropdown-item', { active: currentSessionId === s.id }]"
              @click="handleDropdownSelect(s.id)"
            >
              <span class="dropdown-item-title">{{ sessionItemLabel(s) }}</span>
              <span v-if="sessionContextLabel(s)" class="dropdown-item-tag">
                {{ sessionContextLabel(s) }}
              </span>
            </div>
            <div v-if="sessions.length === 0" class="session-dropdown-empty">
              {{ t("chat.noConversations") }}
            </div>
          </div>
        </div>
      </Transition>

      <!-- Messages -->
      <div ref="chatContainer" class="sidebar-messages">
        <div v-if="messages.length === 0" class="sidebar-empty">
          <el-icon :size="28" class="sidebar-empty-icon"><MessageSquare /></el-icon>
          <div class="sidebar-empty-text">{{ t("diagnosis.enterProblem") }}</div>
        </div>
        <div v-for="(msg, i) in messages" :key="i" class="sidebar-msg-wrapper">
          <AgentMessage :message="msg" :message-index="i" />
        </div>
        <div v-if="isSending" class="sidebar-typing">
          <span class="typing-dot" />
          <span class="typing-dot" />
          <span class="typing-dot" />
        </div>
      </div>

      <!-- Input -->
      <ChatInput
        v-model="draft"
        :is-sending="isSending"
        :placeholder="t('diagnosis.enterDiagnosis')"
        @send="handleSend"
        @stop="stopSending"
      />
    </div>
  </Transition>
</template>

<style scoped>
/* ------------------------------------------------------------------ */
/*  Sidebar panel                                                      */
/* ------------------------------------------------------------------ */

.diagnosis-sidebar {
  width: 400px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
  height: 100%;
  position: relative;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition:
    width 0.3s ease,
    opacity 0.3s ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  width: 0;
  opacity: 0;
  overflow: hidden;
}

/* ------------------------------------------------------------------ */
/*  Compact header (single row)                                        */
/* ------------------------------------------------------------------ */

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  flex-shrink: 0;
}

.session-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.session-switcher:hover {
  background: var(--observe-bg-hover, var(--el-fill-color));
}

.session-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.session-context-tag {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}

.session-chevron {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
  transition: transform 0.2s;
}

.session-chevron.open {
  transform: rotate(180deg);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.close-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--observe-bg-hover, var(--el-fill-color));
}

/* ------------------------------------------------------------------ */
/*  Session dropdown                                                   */
/* ------------------------------------------------------------------ */

.session-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}

.session-dropdown {
  position: absolute;
  top: 42px;
  left: 8px;
  right: 8px;
  z-index: 100;
  background: var(--observe-bg-card, var(--el-bg-color));
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: all 0.15s ease;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.session-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-regular);
  transition: background 0.15s;
  white-space: nowrap;
  overflow: hidden;
}

.session-dropdown-item:hover {
  background: var(--observe-bg-hover, var(--el-fill-color));
}

.session-dropdown-item.active {
  background: var(--observe-bg-active, var(--el-fill-color-light));
  color: var(--el-color-primary);
}

.session-dropdown-item.new-chat {
  color: var(--el-color-primary);
  font-weight: 500;
}

.new-chat-icon {
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}

.session-dropdown-divider {
  height: 1px;
  background: var(--el-border-color-lighter);
  margin: 0;
  flex-shrink: 0;
}

.session-dropdown-list {
  overflow-y: auto;
  max-height: 260px;
}

.dropdown-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.dropdown-item-tag {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.session-dropdown-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  padding: 16px 0;
}

/* ------------------------------------------------------------------ */
/*  Messages                                                           */
/* ------------------------------------------------------------------ */

.sidebar-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.sidebar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--el-text-color-placeholder);
}

.sidebar-empty-icon {
  color: var(--el-text-color-placeholder);
}

.sidebar-empty-text {
  font-size: 13px;
}

.sidebar-msg-wrapper {
  width: 100%;
}

/* Typing indicator */

.sidebar-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.typing-dot {
  width: 5px;
  height: 5px;
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
