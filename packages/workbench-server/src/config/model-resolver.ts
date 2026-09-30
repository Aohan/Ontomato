import type { ModelRole, ModelSettingsData } from "@ontomato/contracts/model-settings";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { backendGet } from "../utils/backend-client";
import { getLogContext } from "../logging/log-context";
import { config } from "./application";
import { t } from "../i18n";

export class ModelNotConfiguredError extends Error {}

export interface ResolvedModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxTokens: number;
  contextWindow: number;
  customRequestParameters: Record<string, unknown>;
}

export function getRoleNotConfiguredMessage(role: ModelRole): string {
  const roleName = t(`model.role.${role}`);
  return t("model.roleNotConfigured", { role: roleName });
}

export async function resolveModelForRole(role: ModelRole = "general"): Promise<ResolvedModelConfig> {
  const endpoint = "/businessConfig/getModelSettings";
  const url = `${config.dataQuery.baseUrl}${endpoint}`;
  const context = getLogContext();

  const response = await backendGet(endpoint, url, {
    token: context?.token,
    apiKey: context?.apiKey,
  });

  const body = JSON.parse(response.text) as {
    success: boolean;
    data?: ModelSettingsData;
    message?: string;
  };

  if (!body.success || !body.data) {
    throw new Error(body.message || "Failed to fetch model settings from backend");
  }

  const agentEntry = body.data.agents?.[role];
  const modelId = agentEntry?.model;
  if (!modelId) {
    throw new ModelNotConfiguredError(getRoleNotConfiguredMessage(role));
  }

  const model = body.data.models?.find((m) => m.name === modelId);
  if (!model) {
    throw new Error(`Model settings are inconsistent: role "${role}" references missing model "${modelId}"`);
  }

  const apiKey = model.apiKeys?.[0];
  const baseUrl = model.baseUrl;
  const modelName = model.modelName;
  const timeoutSeconds = model.timeout ? parseIsoDurationSeconds(model.timeout) : undefined;

  return {
    baseUrl,
    apiKey,
    modelName,
    timeoutSeconds,
    maxRetries: model.maxRetries,
    maxTokens: model.maxTokens,
    contextWindow: model.contextWindow,
    customRequestParameters: model.customRequestParameters ?? {},
  };
}
