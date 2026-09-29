import type { Locale } from "../i18n/index";

/** A new domain's default model takes connection info only from the deployment environment; the env var names and priority differ per edition and are supplied by the app. */
export interface DefaultModelConnection {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/** Each edition's historical runtime defaults, installed by the app before startup; the shared package embeds neither edition's values. */
export interface RuntimeDefaults {
  postgresFallback: string;
  systemMcpUrlFallback: string;
  defaultModelConnection(): DefaultModelConnection;
  /** How to interpret things when the backend config gives no data adapter during diagnosis. */
  defaultDataAdapter: "m3" | "sql";
  /** Historical fallback when the request gives no explicit locale: enterprise zh-CN, OSS en. */
  requestLocaleFallback: Locale;
}

let installed: RuntimeDefaults | null = null;

export function installRuntimeDefaults(defaults: RuntimeDefaults): void {
  installed = defaults;
}

export function runtimeDefaults(): RuntimeDefaults {
  if (!installed) throw new Error("Workbench runtime defaults are not installed");
  return installed;
}
