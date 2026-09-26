import type { Locale } from "../i18n/index";

/** 新域默认模型只从部署环境取连接信息；两版读取的环境变量名与优先级不同，由应用给出。 */
export interface DefaultModelConnection {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/** 两版各自的历史运行默认值，由应用在启动前安装；公共包不内置任何一版的值。 */
export interface RuntimeDefaults {
  postgresFallback: string;
  systemMcpUrlFallback: string;
  defaultModelConnection(): DefaultModelConnection;
  /** 诊断时后端配置未给出数据适配器的理解方式。 */
  defaultDataAdapter: "m3" | "sql";
  /** 请求未显式给 locale 时的历史缺省：企业 zh-CN、OSS en。 */
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
