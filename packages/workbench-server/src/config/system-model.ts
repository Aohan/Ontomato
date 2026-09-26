import type {
  SystemModelConfig,
  SystemModelEntry,
  SystemModelRole,
  AbcQuestionMode,
} from "@ontomato/contracts/system-model";
import fs from "fs";
import path from "path";
import { normalizeCustomRequestParameters } from "./custom-request-parameters";
import { createLogger } from "../logging/logger";
import { getLogContext } from "../logging/log-context";
import { runtimeDataDir } from "../content/layout";
import { runtimeDefaults } from "../runtime/defaults";

export const SYSTEM_MODEL_MAX_TOKENS = 50_000;

export class SystemModelConfigError extends Error {}

/** Validate values before they are used in an HTTP Authorization header. */
export function validateSystemModelApiKey(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new SystemModelConfigError("apiKey must be a string");
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0xff || (code < 0x20 && code !== 0x09) || code === 0x7f) {
      throw new SystemModelConfigError(
        `apiKey contains a character that cannot be sent in an HTTP header at index ${index}`
      );
    }
  }
}

const logger = createLogger("system-model-config");

export const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONTEXT_WINDOW = 256_000;
const DEFAULT_ABC_QUESTION_MODE: AbcQuestionMode = "harness";
const DEFAULT_QUERY_TIMEOUT_SECONDS = 10 * 60;
const ABC_QUESTION_MODES: readonly unknown[] = ["no_tool_fixed", "tool_fixed", "harness"];

/** New domains take only the connection from the deployment env; every other field is a default. */
function createDefaultConfig(): SystemModelConfig {
  return {
    models: [
      {
        name: "default",
        displayName: "default",
        ...runtimeDefaults().defaultModelConnection(),
        customRequestParameters: {},
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        maxRetries: DEFAULT_MAX_RETRIES,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
      },
    ],
    agents: { default: { model: "default" }, diagnosis: { model: "default" } },
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

const isPositiveNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isPositiveInteger = (value: unknown) => Number.isInteger(value) && (value as number) > 0;
const isNonNegativeInteger = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;

/**
 * Optional fields: a missing value takes `fallback` (the default, or the saved value on a
 * partial save); a present value must be valid and is never silently replaced.
 */
function optionalField<T>(
  value: unknown,
  fallback: T,
  isValid: (value: unknown) => boolean,
  message: string
): T {
  if (value === undefined) return fallback;
  if (!isValid(value)) throw new SystemModelConfigError(message);
  return value as T;
}

/**
 * `load` reads a persisted file: connection fields may be blank (an unconfigured domain must
 * still open the settings page) and an unsendable key is cleared for rewrite. `save` validates
 * user input: the connection fields are required and a bad key is rejected.
 */
type NormalizeMode = "load" | "save";

function requiredConnectionField(
  source: Record<string, unknown>,
  field: "baseUrl" | "modelName",
  index: number,
  mode: NormalizeMode
): string {
  const value = source[field];
  if (typeof value !== "string" || (mode === "save" && !value.trim())) {
    throw new SystemModelConfigError(`models[${index}].${field} must be a non-empty string`);
  }
  return value;
}

function normalizeEntry(
  raw: unknown,
  index: number,
  mode: NormalizeMode
): { entry: SystemModelEntry; apiKeyCleared: boolean } {
  const source = asRecord(raw);
  if (!source) {
    throw new SystemModelConfigError(`models[${index}] must be an object`);
  }
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) {
    throw new SystemModelConfigError(`models[${index}].name must be a non-empty string`);
  }
  // A missing or blank display name falls back to the config ID, as on the DataRAG side.
  const displayName =
    optionalField<string>(
      source.displayName,
      name,
      (value) => typeof value === "string",
      `models[${index}].displayName must be a string`
    ).trim() || name;
  let apiKey = source.apiKey;
  let apiKeyCleared = false;
  if (mode === "save") {
    validateSystemModelApiKey(apiKey);
    if (!apiKey.trim()) {
      throw new SystemModelConfigError(`models[${index}].apiKey must be a non-empty string`);
    }
  } else {
    try {
      validateSystemModelApiKey(apiKey);
    } catch {
      apiKey = "";
      apiKeyCleared = true;
    }
  }
  return {
    entry: {
      name,
      displayName,
      baseUrl: requiredConnectionField(source, "baseUrl", index, mode),
      apiKey: apiKey as string,
      modelName: requiredConnectionField(source, "modelName", index, mode),
      customRequestParameters:
        source.customRequestParameters === undefined
          ? {}
          : normalizeCustomRequestParameters(source.customRequestParameters),
      timeoutSeconds: optionalField(
        source.timeoutSeconds,
        DEFAULT_TIMEOUT_SECONDS,
        isPositiveNumber,
        "timeoutSeconds must be a positive number"
      ),
      maxRetries: optionalField(
        source.maxRetries,
        DEFAULT_MAX_RETRIES,
        isNonNegativeInteger,
        "maxRetries must be a non-negative integer"
      ),
      contextWindow: optionalField(
        source.contextWindow,
        DEFAULT_CONTEXT_WINDOW,
        isPositiveInteger,
        `models[${index}].contextWindow must be a positive integer`
      ),
    },
    apiKeyCleared,
  };
}

function normalizeModels(
  raw: unknown[],
  mode: NormalizeMode
): { models: SystemModelEntry[]; names: Set<string>; apiKeyCleared: boolean } {
  const models: SystemModelEntry[] = [];
  const names = new Set<string>();
  let apiKeyCleared = false;
  raw.forEach((item, index) => {
    const { entry, apiKeyCleared: cleared } = normalizeEntry(item, index, mode);
    if (names.has(entry.name)) {
      throw new SystemModelConfigError(`Duplicate system model name "${entry.name}"`);
    }
    names.add(entry.name);
    apiKeyCleared = apiKeyCleared || cleared;
    models.push(entry);
  });
  return { models, names, apiKeyCleared };
}

/** The default role must reference a model; an unset diagnosis role uses the default role's model. */
function normalizeAgents(
  raw: unknown,
  names: Set<string>,
  invalidReference: (role: SystemModelRole, ref: unknown) => string
): SystemModelConfig["agents"] {
  const agents = asRecord(raw);
  const reference = (role: SystemModelRole): string => {
    const ref = asRecord(agents?.[role])?.model;
    if (typeof ref !== "string" || !names.has(ref)) {
      throw new SystemModelConfigError(invalidReference(role, ref));
    }
    return ref;
  };
  const defaultModel = reference("default");
  const diagnosisModel = agents?.diagnosis === undefined ? defaultModel : reference("diagnosis");
  return { default: { model: defaultModel }, diagnosis: { model: diagnosisModel } };
}

function normalizeAbcQuestionMode(value: unknown, fallback: AbcQuestionMode): AbcQuestionMode {
  return optionalField(
    value,
    fallback,
    (mode) => ABC_QUESTION_MODES.includes(mode),
    `abcQuestionMode must be one of: ${ABC_QUESTION_MODES.join(", ")}`
  );
}

function normalizeQueryTimeoutSeconds(value: unknown, fallback: number): number {
  return optionalField(
    value,
    fallback,
    isPositiveInteger,
    "queryTimeoutSeconds must be a positive integer"
  );
}

/** Missing optional fields are filled in memory only; the file is rewritten only to clear a bad key. */
function normalizePersistedConfig(domainId: string, parsed: unknown): SystemModelConfig {
  const saved = asRecord(parsed);
  if (!saved) {
    throw new Error("Persisted system model configuration must be a JSON object");
  }
  if (!Array.isArray(saved.models)) {
    throw new SystemModelConfigError(
      `System model config for domain "${domainId}" is in the legacy format; migrate it with the upgrade package before use`
    );
  }
  const { models, names, apiKeyCleared } = normalizeModels(saved.models, "load");
  const config: SystemModelConfig = {
    models,
    agents: normalizeAgents(
      saved.agents,
      names,
      (role, ref) =>
        `System model config for domain "${domainId}" agents.${role}.model references unknown model "${String(ref)}"`
    ),
    abcQuestionMode: normalizeAbcQuestionMode(saved.abcQuestionMode, DEFAULT_ABC_QUESTION_MODE),
    queryTimeoutSeconds: normalizeQueryTimeoutSeconds(
      saved.queryTimeoutSeconds,
      DEFAULT_QUERY_TIMEOUT_SECONDS
    ),
  };

  if (apiKeyCleared) {
    try {
      writeConfig(getDomainConfigFile(domainId), config);
    } catch (error) {
      logger.error("Failed to normalize persisted domain system model configuration", {
        domainId,
        error,
      });
    }
  }

  return config;
}

function loadConfig(domainId: string): SystemModelConfig {
  const configFile = getDomainConfigFile(domainId);
  const defaults = createDefaultConfig();
  if (!fs.existsSync(configFile)) {
    writeConfig(configFile, defaults);
    return defaults;
  }
  const raw = fs.readFileSync(configFile, "utf-8");
  return normalizePersistedConfig(domainId, JSON.parse(raw));
}

const cachedConfigs = new Map<string, SystemModelConfig>();

export function getSystemModelConfig(domainId?: string): SystemModelConfig {
  const resolvedDomainId = resolveDomainId(domainId);
  let config = cachedConfigs.get(resolvedDomainId);
  if (!config) {
    config = loadConfig(resolvedDomainId);
    cachedConfigs.set(resolvedDomainId, config);
  }
  return structuredClone(config);
}

/**
 * The single place that resolves a model connection. Every consumer that needs
 * baseUrl / apiKey / modelName goes through here instead of reading the config.
 */
export function resolveSystemModel(
  domainId?: string,
  role: SystemModelRole = "default"
): SystemModelEntry {
  const config = getSystemModelConfig(domainId);
  // 读取与保存都已校验两个角色引用存在于模型库。
  return config.models.find((model) => model.name === config.agents[role].model)!;
}

export function saveSystemModelConfig(
  domainId: string,
  input: {
    models?: unknown;
    agents?: unknown;
    abcQuestionMode?: unknown;
    queryTimeoutSeconds?: unknown;
  }
): SystemModelConfig {
  const resolvedDomainId = resolveDomainId(domainId);
  const current = getSystemModelConfig(resolvedDomainId);

  // 模型区与问数区共用本入口：未提交的字段沿用已保存当前值；
  // 提交了空值仍按提交值校验（空数组、空字符串不会被当成缺省）。
  let models = current.models;
  let names = new Set(models.map((model) => model.name));
  if (input.models !== undefined) {
    if (!Array.isArray(input.models) || input.models.length === 0) {
      throw new SystemModelConfigError("models must be a non-empty array");
    }
    ({ models, names } = normalizeModels(input.models, "save"));
  }

  const updated: SystemModelConfig = {
    models,
    agents: normalizeAgents(
      input.agents === undefined ? current.agents : input.agents,
      names,
      (role) =>
        `agents.${role}.model must reference one of: ${models.map((model) => model.name).join(", ")}`
    ),
    abcQuestionMode: normalizeAbcQuestionMode(input.abcQuestionMode, current.abcQuestionMode),
    queryTimeoutSeconds: normalizeQueryTimeoutSeconds(
      input.queryTimeoutSeconds,
      current.queryTimeoutSeconds
    ),
  };

  writeConfig(getDomainConfigFile(resolvedDomainId), updated);
  cachedConfigs.set(resolvedDomainId, structuredClone(updated));

  return structuredClone(updated);
}

export function clearSystemModelConfigCache(): void {
  cachedConfigs.clear();
}

export function hasCustomConfig(domainId: string): boolean {
  return fs.existsSync(getDomainConfigFile(resolveDomainId(domainId)));
}
