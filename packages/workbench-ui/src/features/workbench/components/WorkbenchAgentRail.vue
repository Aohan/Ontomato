<script setup lang="ts">
import { computed } from "vue";
import { MessageSquarePlus } from "lucide-vue-next";
import { useLocale } from "../../../composables/useLocale";
import type { AppearanceSection } from "@ontomato/contracts/workbench-appearance";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { WorkbenchAgent, WorkbenchSelectionMode } from "../types";
import {
  displayAgentDescription,
  displayAgentName,
  getAgentColor,
  getAgentIcon,
  getAgentIconComponent,
} from "../utils/agentDisplay";

const props = withDefaults(
  defineProps<{
  logoSrc: string;
  brandName: string;
  brandSubtitle: string;
  addAgentLabel: string;
  /** The Q&A entry's appearance is shared by the agent panel and the Q&A history panel, assembled once by the workbench. */
  qaAgent: WorkbenchAgent;
  agents: AnalysisAgent[];
  selectionMode: WorkbenchSelectionMode;
  selectedAgentId: string;
  /** Compact rail of the open-source layout: when true, each entry shows a tooltip on the right; other layouts omit it. */
  compact?: boolean;
  /**
   * Element of the entry cards: a div with a native title, or (open source) a button with aria-label and a focus ring.
   * nativeTitles decides whether the cards and the "add" button have native titles; addIconSize is the original "add" icon size (open source: 18).
   */
  cardTag?: "div" | "button";
  nativeTitles?: boolean;
  addIconSize?: number;
}>(),
  { cardTag: "div", nativeTitles: true, addIconSize: 16 }
);

const emit = defineEmits<{
  selectAgent: [agent: WorkbenchAgent];
  addAgent: [];
  editAppearance: [section: AppearanceSection];
}>();

const { t } = useLocale();

function agentDescription(agent: WorkbenchAgent) {
  if (agent.isQA) return agent.description;
  return (
    displayAgentDescription(agent.description?.trim(), t) ||
    (agent.reportDeliverableEnabled === false ? t("admin.productModeHarnessHint") : "")
  );
}

const allAgents = computed<WorkbenchAgent[]>(() => [
  props.qaAgent,
  { _divider: true } as WorkbenchAgent,
  ...props.agents.filter((agent) => agent.isEnabled),
]);
</script>

<template>
  <el-tooltip :disabled="!compact" :content="brandName" placement="right">
    <div
      class="brand"
      tabindex="0"
      :aria-label="t('appearance.brand')"
      @contextmenu.prevent="emit('editAppearance', 'brand')"
      @keydown.shift.f10.prevent="emit('editAppearance', 'brand')"
      @keydown.enter.prevent="emit('editAppearance', 'brand')"
    >
      <img class="brand-icon" :src="logoSrc" :alt="brandName" />
      <div class="brand-text-group">
        <span class="brand-text" :title="brandName">{{ brandName }}</span>
        <span class="brand-subtitle" :title="brandSubtitle">{{ brandSubtitle }}</span>
      </div>
    </div>
  </el-tooltip>

  <div class="agent-section-title">{{ t("app.agent") }}</div>
  <div class="agent-list">
    <template v-for="agent in allAgents" :key="agent.id || '_divider'">
      <div v-if="agent._divider" class="agent-divider"></div>
      <el-tooltip
        v-else
        :disabled="!compact"
        :content="agent.isQA ? agent.name : displayAgentName(agent.name, t)"
        placement="right"
      >
        <component
          :is="cardTag"
          :type="cardTag === 'button' ? 'button' : undefined"
          :aria-label="
            cardTag === 'button' ? (agent.isQA ? agent.name : displayAgentName(agent.name, t)) : undefined
          "
          :title="
            nativeTitles ? (agent.isQA ? agent.name : displayAgentName(agent.name, t)) : undefined
          "
          :class="[
            'agent-card',
            {
              'agent-card--button': cardTag === 'button',
              active: agent.isQA
                ? selectionMode === 'qa'
                : selectedAgentId === agent.id && selectionMode === 'analysis',
            },
          ]"
          @click="emit('selectAgent', agent)"
        >
          <div class="agent-avatar" :style="{ background: getAgentColor(agent) }">
            <component
              :is="getAgentIconComponent(agent)"
              v-if="getAgentIconComponent(agent)"
              :size="20"
            />
            <component :is="getAgentIcon(agent)" v-else :size="20" />
          </div>
          <div class="agent-info">
            <div
              class="agent-name"
              :title="agent.isQA ? agent.name : displayAgentName(agent.name, t)"
            >
              {{ agent.isQA ? agent.name : displayAgentName(agent.name, t) }}
            </div>
            <div class="agent-desc" :title="agentDescription(agent)">
              {{ agentDescription(agent) }}
            </div>
          </div>
        </component>
      </el-tooltip>
    </template>
  </div>

  <div class="agent-add-wrap">
    <el-tooltip :disabled="!compact" :content="addAgentLabel" placement="right">
      <button
        class="agent-add-btn"
        :aria-label="addAgentLabel"
        :title="nativeTitles ? addAgentLabel : undefined"
        @contextmenu.prevent="emit('editAppearance', 'addAgentLabel')"
        @keydown.shift.f10.prevent="emit('editAppearance', 'addAgentLabel')"
        @click="emit('addAgent')"
      >
        <MessageSquarePlus :size="addIconSize" />
        <span class="add-agent-text">{{ addAgentLabel }}</span>
      </button>
    </el-tooltip>
  </div>
</template>

<style scoped>
.brand {
  padding: 20px;
  border-bottom: 1px solid var(--el-border-color);
  position: relative;
  background: var(--el-bg-color);
  display: flex;
  align-items: center;
}
.brand-icon {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  object-fit: contain;
  flex-shrink: 0;
  margin-right: 10px;
}
.brand-text-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.brand-text,
.brand-subtitle,
.add-agent-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -3px;
}
.brand-text {
  font-size: 16px;
  font-weight: 800;
  color: var(--el-text-color-primary);
  letter-spacing: 0.2px;
  line-height: 1.2;
}
.brand-subtitle {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.2;
}
.agent-section-title {
  padding: 16px 20px 8px;
  font-size: 11px;
  color: var(--el-text-color-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px;
}
.agent-card {
  display: flex;
  align-items: center;
  padding: 11px 12px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 4px;
  position: relative;
  color: var(--el-text-color-secondary);
}
.agent-card--button {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
.agent-card--button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.agent-card:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.agent-card.active {
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card);
}
.agent-card.active::before {
  content: "";
  position: absolute;
  right: 8px;
  top: 14px;
  bottom: 14px;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    var(--el-color-primary),
    color-mix(in srgb, var(--el-color-primary-light-5) 50%, var(--el-color-primary))
  );
}
.agent-avatar {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  margin-right: 10px;
  color: var(--el-color-primary);
}
.agent-info {
  flex: 1;
  min-width: 0;
}
.agent-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-desc {
  font-size: 11px;
  color: var(--el-text-color-tertiary);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-divider {
  height: 1px;
  background: var(--el-border-color);
  margin: 8px 12px;
}
.agent-add-wrap {
  padding: 10px 14px 12px;
}
.agent-add-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 12px;
  border: 1.5px dashed var(--el-border-color-dark);
  border-radius: 16px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.agent-add-btn:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  background: var(--el-color-primary-light-9);
  transform: translateY(-1px);
}
.agent-list::-webkit-scrollbar {
  width: 4px;
}
.agent-list::-webkit-scrollbar-track {
  background: transparent;
}
.agent-list::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}
.agent-list::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
</style>
