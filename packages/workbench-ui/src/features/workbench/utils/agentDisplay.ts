import type { Component } from "vue";
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Building2,
  Database,
  MessageSquare,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-vue-next";
import { workbenchContent } from "../../../content";

const agentIcons: Record<string, Component> = {
  general: TrendingUp,
  sales: Wallet,
  finance: Building2,
  ops: Settings,
  customer: Users,
  supply: Truck,
};

const lucideIconMap: Record<string, Component> = {
  Brain,
  Sparkles,
  Activity,
  BarChart3,
  TrendingUp,
  Target,
  Database,
  Wallet,
  Users,
  Settings,
  MessageSquare,
};

export const avatarIconOptions = Object.entries(lucideIconMap).map(([key, icon]) => ({
  key,
  icon,
}));
export const lightAvatarColorOptions = [
  "#F1EFFF",
  "#EEF7FF",
  "#EFFFF8",
  "#F4F7FE",
  "#FFF4FB",
  "#FFF6ED",
];
export const darkAvatarColorOptions = [
  "#2c2850",
  "#1d3047",
  "#173b35",
  "#252a42",
  "#40223b",
  "#42331d",
];

export function displayAgentName(name: string | undefined, t: (key: string) => string): string {
  if (!name) return "";
  return workbenchContent().defaultAgentNames.includes(name) ? t("service.defaultAgentName") : name;
}

export function displayAgentDescription(
  desc: string | undefined,
  t: (key: string) => string
): string {
  if (!desc) return "";
  return workbenchContent().defaultAgentDescriptions.includes(desc)
    ? t("service.defaultAgentDescription")
    : desc;
}

export function getAgentIcon(agent: any): Component {
  if (agent.isQA) return MessageSquare;
  const id = String(agent.id || "");
  for (const [key, icon] of Object.entries(agentIcons)) {
    if (id.includes(key)) return icon;
  }
  return Bot;
}

export function getAgentIconComponent(agent: any): Component | null {
  try {
    if (agent.icon) {
      const parsed = typeof agent.icon === "string" ? JSON.parse(agent.icon) : agent.icon;
      return lucideIconMap[parsed.key] || null;
    }
  } catch {
    /* ignore malformed stored icon payload */
  }
  return null;
}

export function getAgentColor(agent: any): string {
  let storedColor = "";
  try {
    if (agent.icon) {
      const parsed = typeof agent.icon === "string" ? JSON.parse(agent.icon) : agent.icon;
      if (parsed.color) storedColor = parsed.color;
    }
  } catch {
    /* ignore malformed stored icon payload */
  }

  switch (storedColor) {
    case "#F1EFFF":
      return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
    case "#EEF7FF":
      return "color-mix(in srgb, var(--el-color-info) 8%, var(--el-bg-color))";
    case "#EFFFF8":
      return "color-mix(in srgb, var(--el-color-success) 10%, var(--el-bg-color))";
    case "#FFF6ED":
      return "color-mix(in srgb, var(--el-color-warning) 10%, var(--el-bg-color))";
    case "#FFF4FB":
      return "color-mix(in srgb, var(--el-color-danger) 8%, var(--el-bg-color))";
    case "#F4F7FE":
      return "var(--el-fill-color)";
    default:
      if (storedColor) return storedColor;
  }

  if (agent.isQA) return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
  const id = String(agent.id || "");
  if (id.includes("sales"))
    return "color-mix(in srgb, var(--el-color-info) 8%, var(--el-bg-color))";
  if (id.includes("finance"))
    return "color-mix(in srgb, var(--el-color-success) 10%, var(--el-bg-color))";
  if (id.includes("ops")) return "var(--el-fill-color)";
  if (id.includes("customer"))
    return "color-mix(in srgb, var(--el-color-danger) 8%, var(--el-bg-color))";
  if (id.includes("supply"))
    return "color-mix(in srgb, var(--el-color-warning) 10%, var(--el-bg-color))";
  return "color-mix(in srgb, var(--el-color-primary) 10%, var(--el-bg-color))";
}
