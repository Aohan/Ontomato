<script setup lang="ts">
import { Brain, ChevronDown, CircleAlert, MessageSquareText, Wrench } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { renderAgentMarkdownWithJsonFormatting } from "../../../utils/agent-markdown";
import type { PromptMarkerKind } from "@ontomato/contracts/observe";
import type {
  PromptTranscript,
  PromptTranscriptItem,
} from "../utils/prompt-transcript-parser";
import PromptReadableValue from "./PromptReadableValue.vue";

defineProps<{
  transcript: PromptTranscript;
}>();

const { t } = useI18n();

const markerLabelKeys: Record<PromptMarkerKind, string> = {
  systemPrompt: "diagnosis.promptTranscript.systemPrompt",
  userPrompt: "diagnosis.promptTranscript.userPrompt",
  reasoning: "diagnosis.promptTranscript.thinking",
  llmOutput: "diagnosis.promptTranscript.visibleOutput",
  toolCall: "diagnosis.promptTranscript.tool",
  toolReturn: "diagnosis.promptTranscript.result",
  message: "diagnosis.promptTranscript.message",
};

function sectionLabel(item: Extract<PromptTranscriptItem, { kind: "section" }>): string {
  return item.error ? t("diagnosis.promptTranscript.error") : t(markerLabelKeys[item.type]);
}

function isErrorItem(item: PromptTranscriptItem): boolean {
  return item.kind === "section" && item.error;
}

function isVisibleOutput(item: PromptTranscriptItem): boolean {
  return item.kind === "section" && item.type === "llmOutput";
}

function sectionIcon(item: PromptTranscriptItem) {
  if (isErrorItem(item)) return CircleAlert;
  if (item.kind === "section" && item.type === "reasoning") return Brain;
  return MessageSquareText;
}
</script>

<template>
  <div class="prompt-transcript">
    <header
      v-if="transcript.title || transcript.headerLines.length"
      class="prompt-transcript__header"
    >
      <h2 v-if="transcript.title" class="prompt-transcript__title">{{ transcript.title }}</h2>
      <pre v-if="transcript.headerLines.length" class="prompt-transcript__meta">{{
        transcript.headerLines.join("\n")
      }}</pre>
    </header>

    <article
      v-for="(round, roundIndex) in transcript.rounds"
      :key="`${transcript.title}-${round.title}-${roundIndex}`"
      class="prompt-round"
    >
      <header class="prompt-round__header">
        <h3 class="prompt-round__title">{{ round.title.replace(/^##\s+/, "") }}</h3>
      </header>

      <pre v-if="round.metaLines.length" class="prompt-round__meta">{{
        round.metaLines.join("\n")
      }}</pre>

      <section
        v-for="group in round.groups"
        :key="group.kind"
        class="prompt-group"
        :class="`prompt-group--${group.kind}`"
      >
        <div class="prompt-group__label">
          {{
            group.kind === "context"
              ? t("diagnosis.promptTranscript.inputContext")
              : t("diagnosis.promptTranscript.assistant")
          }}
        </div>

        <template v-for="(item, itemIndex) in group.items" :key="itemIndex">
          <div
            v-if="group.kind === 'assistant' && isVisibleOutput(item) && item.kind === 'section'"
            class="prompt-output markdown-content"
            v-html="renderAgentMarkdownWithJsonFormatting(item.content)"
          />

          <details
            v-else-if="item.kind === 'section'"
            class="prompt-disclosure"
            :class="{ 'prompt-disclosure--error': isErrorItem(item) }"
            :open="isErrorItem(item)"
          >
            <summary class="prompt-disclosure__summary">
              <component :is="sectionIcon(item)" :size="14" aria-hidden="true" />
              <span>{{ sectionLabel(item) }}</span>
              <ChevronDown class="prompt-disclosure__chevron" :size="14" aria-hidden="true" />
            </summary>
            <pre class="prompt-disclosure__content">{{ item.content }}</pre>
          </details>

          <details v-else class="prompt-disclosure prompt-tool">
            <summary class="prompt-disclosure__summary">
              <Wrench :size="14" aria-hidden="true" />
              <span class="prompt-tool__name">
                {{ item.call?.name || item.result?.name || t("diagnosis.promptTranscript.tool") }}
              </span>
              <code v-if="item.call?.id || item.result?.id" class="prompt-tool__id">
                {{ item.call?.id || item.result?.id }}
              </code>
              <span class="prompt-tool__status">
                {{ t(`diagnosis.promptTranscript.${item.matchStatus}`) }}
              </span>
              <ChevronDown class="prompt-disclosure__chevron" :size="14" aria-hidden="true" />
            </summary>
            <div class="prompt-tool__detail">
              <section v-if="item.call" class="prompt-tool__section">
                <div class="prompt-tool__section-label">
                  {{ t("diagnosis.promptTranscript.parameters") }}
                </div>
                <PromptReadableValue :value="item.call.value" />
              </section>
              <section v-if="item.result" class="prompt-tool__section">
                <div class="prompt-tool__section-label">
                  {{ t("diagnosis.promptTranscript.result") }}
                </div>
                <PromptReadableValue :value="item.result.value" />
              </section>
            </div>
          </details>
        </template>
      </section>
    </article>
  </div>
</template>

<style scoped>
.prompt-transcript {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  min-height: 100%;
  padding: 14px;
  color: var(--el-text-color-primary);
}

.prompt-transcript__header,
.prompt-round {
  border: 1px solid var(--observe-border, var(--el-border-color-lighter));
  border-radius: 8px;
  background: var(--observe-bg-card, var(--el-bg-color));
}

.prompt-transcript__header {
  padding: 12px 14px;
}

.prompt-transcript__title,
.prompt-round__title {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.prompt-transcript__meta,
.prompt-round__meta {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.prompt-round {
  overflow: hidden;
}

.prompt-round__header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.prompt-round__meta {
  margin: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.prompt-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
}

.prompt-group + .prompt-group {
  border-top: 1px solid var(--el-border-color-lighter);
}

.prompt-group--context {
  background: var(--el-fill-color-extra-light);
}

.prompt-group__label {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.prompt-disclosure {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--observe-bg-card, var(--el-bg-color));
}

.prompt-disclosure--error {
  border-color: var(--el-color-danger-light-5);
}

.prompt-disclosure__summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 6px 9px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.prompt-disclosure__summary::-webkit-details-marker {
  display: none;
}

.prompt-disclosure__summary:hover {
  background: var(--el-fill-color-lighter);
}

.prompt-disclosure__summary:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: -2px;
}

.prompt-disclosure__chevron {
  flex: 0 0 auto;
  margin-left: auto;
  transition: transform 160ms ease;
}

.prompt-disclosure[open] .prompt-disclosure__chevron {
  transform: rotate(180deg);
}

.prompt-disclosure__content {
  margin: 0;
  padding: 9px 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.prompt-output {
  padding: 2px 4px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.prompt-output :deep(> *:first-child) {
  margin-top: 0;
}

.prompt-output :deep(> *:last-child) {
  margin-bottom: 0;
}

.prompt-output :deep(pre) {
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.prompt-tool__name,
.prompt-tool__id {
  font-family: var(--font-mono);
}

.prompt-tool__name {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.prompt-tool__id {
  max-width: 240px;
  overflow: hidden;
  color: var(--el-text-color-placeholder);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-tool__status {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.prompt-tool__detail {
  display: grid;
  gap: 10px;
  padding: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}

.prompt-tool__section + .prompt-tool__section {
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color);
}

.prompt-tool__section-label {
  margin-bottom: 6px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 720px) {
  .prompt-transcript {
    padding: 10px;
  }

  .prompt-tool__id {
    display: none;
  }
}
</style>
