import type {
  SystemModelConfig,
  AbcQuestionMode,
} from "@ontomato/contracts/system-model";
import fs from "fs";
import path from "path";
import { createLogger } from "../logging/logger";
import { getLogContext } from "../logging/log-context";
import { runtimeDataDir } from "../content/layout";

export class SystemModelConfigError extends Error {}

const logger = createLogger("system-model-config");

export const DEFAULT_ABC_QUESTION_MODE: AbcQuestionMode = "harness";
export const DEFAULT_QUERY_TIMEOUT_SECONDS = 10 * 60;
const ABC_QUESTION_MODES: readonly unknown[] = ["no_tool_fixed", "tool_fixed", "harness"];

function createDefaultConfig(): SystemModelConfig {
  return {
    abcQuestionMode: DEFAULT_ABC_QUESTION_MODE,
    queryTimeoutSeconds: DEFAULT_QUERY_TIMEOUT_SECONDS,
  };
}

function resolveDomainId(domainId?: string): string {
  const resolved = domainId?.trim() || getLogContext()?.domainId?.trim();
  if (!resolved) {
    throw new SystemModelConfigError("domainId is required for system model configuration");
  }
  return resolved;
}

function getDomainConfigFile(domainId: string): string {
  const directoryName = encodeURIComponent(domainId).replace(/\./g, "%2E");
  return runtimeDataDir("system-model-config", `${directoryName}.json`);
}

function writeConfig(configFile: string, config: SystemModelConfig): void {
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const isPositiveInteger = (value: unknown) => Number.isInteger(value) && (value as number) > 0;

function normalizeConfig(raw: unknown): SystemModelConfig {
  const source = asRecord(raw);
  if (!source) {
    throw new SystemModelConfigError("Configuration must be a JSON object");
  }

  if ("models" in source || "agents" in source) {
    throw new SystemModelConfigError(
      "Legacy system model config format detected with models/agents; run upgrade migration"
    );
  }

  const abcQuestionMode =
    source.abcQuestionMode === undefined ? DEFAULT_ABC_QUESTION_MODE : source.abcQuestionMode;
  if (!ABC_QUESTION_MODES.includes(abcQuestionMode)) {
    throw new SystemModelConfigError(
      `Invalid abcQuestionMode: ${String(abcQuestionMode)}. Must be one of: ${ABC_QUESTION_MODES.join(", ")}`
    );
  }

  const queryTimeoutSeconds =
    source.queryTimeoutSeconds === undefined
      ? DEFAULT_QUERY_TIMEOUT_SECONDS
      : source.queryTimeoutSeconds;
  if (!isPositiveInteger(queryTimeoutSeconds)) {
    throw new SystemModelConfigError("queryTimeoutSeconds must be a positive integer");
  }

  return {
    abcQuestionMode: abcQuestionMode as AbcQuestionMode,
    queryTimeoutSeconds: queryTimeoutSeconds as number,
  };
}

export function getSystemModelConfig(domainId?: string): SystemModelConfig {
  const resolved = resolveDomainId(domainId);
  const configFile = getDomainConfigFile(resolved);

  if (!fs.existsSync(configFile)) {
    return createDefaultConfig();
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    return normalizeConfig(raw);
  } catch (error) {
    if (error instanceof SystemModelConfigError) {
      throw error;
    }
    logger.warn(`Failed to read system model config for domain ${resolved}`, error);
    return createDefaultConfig();
  }
}

export function saveSystemModelConfig(
  domainId: string,
  partial: Partial<SystemModelConfig>
): SystemModelConfig {
  const resolved = resolveDomainId(domainId);
  const configFile = getDomainConfigFile(resolved);
  const current = getSystemModelConfig(resolved);

  if ("models" in (partial as Record<string, unknown>) || "agents" in (partial as Record<string, unknown>)) {
    throw new SystemModelConfigError(
      "Legacy system model config format detected with models/agents; run upgrade migration"
    );
  }

  const rawToValidate: Record<string, unknown> = {
    abcQuestionMode:
      partial.abcQuestionMode !== undefined ? partial.abcQuestionMode : current.abcQuestionMode,
    queryTimeoutSeconds:
      partial.queryTimeoutSeconds !== undefined
        ? partial.queryTimeoutSeconds
        : current.queryTimeoutSeconds,
  };

  const normalized = normalizeConfig(rawToValidate);
  writeConfig(configFile, normalized);
  return normalized;
}
