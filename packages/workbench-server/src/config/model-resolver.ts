import type { ModelRole, ModelSettingsData } from "@ontomato/contracts/model-settings";
import { backendGet } from "../utils/backend-client";
import { getLogContext } from "../logging/log-context";
import { config } from "./application";
import { t } from "../i18n";

export class ModelNotConfiguredError extends Error {}

export interface ResolvedModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  maxRetries: number;
  maxTokens: number;
  contextWindow: number;
  customRequestParameters: Record<string, unknown>;
}

export function validateSystemModelApiKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ModelNotConfiguredError("apiKey must be a non-empty string");
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0xff || (code < 0x20 && code !== 0x09) || code === 0x7f) {
      throw new ModelNotConfiguredError(
        `apiKey contains a character that cannot be sent in an HTTP header at index ${index}`
      );
    }
  }
}

export function parseTimeoutSeconds(timeout?: string | number): number {
  if (typeof timeout === "number") {
    return timeout > 0 ? Math.round(timeout) : 300;
  }
  if (typeof timeout === "string") {
    const match = timeout.match(/^PT(\d+)S$/);
    if (match) return parseInt(match[1], 10);
  }
  return 300;
}

export function getRoleNotConfiguredMessage(role: ModelRole): string {
  try {
    const roleName = t(`model.role.${role}`);
    return t("model.roleNotConfigured", { role: roleName });
  } catch {
    const defaultLabels: Record<ModelRole, string> = {
      query: "问数",
      coding: "取数代码编写",
      general: "通用",
      diagnosis: "诊断",
      knowledgeGovernance: "知识治理",
    };
    return `角色『${defaultLabels[role] || role}』未配置模型，请在模型配置中选择`;
  }
}

export async function resolveModelForRole(role: ModelRole = "general"): Promise<ResolvedModelConfig> {
  const endpoint = "/businessConfig/getModelSettings";
  const url = `${config.dataQuery.baseUrl}${endpoint}`;
  const context = getLogContext();

  const response = await backendGet(endpoint, url, {
    token: context?.token,
    apiKey: context?.apiKey,
  });

  const body = (
    typeof (response as any)?.text === "string"
      ? JSON.parse((response as any).text)
      : response
  ) as {
    success: boolean;
    data?: ModelSettingsData;
    error?: string;
  };

  if (!body.success || !body.data) {
    throw new Error(body.error || "Failed to fetch model settings from backend");
  }

  const agentEntry = body.data.agents?.[role];
  const modelId = agentEntry?.model?.trim();
  if (!modelId) {
    throw new ModelNotConfiguredError(getRoleNotConfiguredMessage(role));
  }

  const model = body.data.models?.find((m) => m.name === modelId);
  if (!model) {
    throw new ModelNotConfiguredError(getRoleNotConfiguredMessage(role));
  }

  const apiKey = model.apiKeys?.[0]?.trim();
  const baseUrl = model.baseUrl?.trim();
  const modelName = model.modelName?.trim();

  if (!apiKey || !baseUrl || !modelName) {
    throw new ModelNotConfiguredError(getRoleNotConfiguredMessage(role));
  }

  validateSystemModelApiKey(apiKey);

  return {
    baseUrl,
    apiKey,
    modelName,
    timeoutSeconds: parseTimeoutSeconds(model.timeout),
    maxRetries: model.maxRetries ?? 3,
    maxTokens: model.maxTokens ?? 50_000,
    contextWindow: model.contextWindow ?? 256_000,
    customRequestParameters: model.customRequestParameters ?? {},
  };
}
