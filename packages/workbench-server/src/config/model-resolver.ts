import type { ModelRole, ModelSettingsData } from "@ontomato/contracts/model-settings";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { AuthFailedError, backendGet, buildBackendHeaders } from "../utils/backend-client";
import { workbenchIdentity } from "../identity/installed";
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
    headers: {
      ...buildBackendHeaders(context?.token, undefined, undefined, context?.apiKey),
      ...workbenchIdentity().modelSettingsReadHeaders,
    },
  }).catch((error: unknown) => {
    if (error instanceof AuthFailedError && error.status === 403) {
      // This read's 403 is a service/domain configuration refusal; only a 401 asks the user to sign in again.
      throw new Error(t("model.settingsReadRefused"));
    }
    throw error;
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
