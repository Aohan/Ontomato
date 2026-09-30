import type { Locale } from "../i18n/index";

/** Each edition's historical runtime defaults, installed by the app before startup; the shared package embeds neither edition's values. */
export interface RuntimeDefaults {
  postgresFallback: string;
  systemMcpUrlFallback: string;
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
