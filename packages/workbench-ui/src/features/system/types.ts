import type {
  BackendAgentConfig,
  BackendModelConfig,
  ModelRole,
} from "@ontomato/contracts/model-settings";

/**
 * 模型配置页编辑的模型条目：以 getModelSettings 读取的条目为底，未上控件的字段（organizationId 等）随快照原样往返。
 * 读取时未设置的可选项可能为 null；新建或清空的 maxTokens / contextWindow 以 null 提交，默认值由 Java 读取归一化补上。
 */
export type ModelEntry = Omit<
  BackendModelConfig,
  "maxTokens" | "contextWindow" | "timeout" | "maxRetries" | "temperature" | "topP"
> & {
  maxTokens: number | null;
  contextWindow: number | null;
  timeout?: string | null;
  maxRetries?: number | null;
  temperature?: number | null;
  topP?: number | null;
  maxCompletionTokens?: number | null;
};

/** 五个角色的模型引用草稿：配置 ID，或未配置（null）；与 saveModelSettings 请求的 agents 同形。 */
export type RoleModels = Record<ModelRole, string | null>;

export interface EmbeddingModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: string;
  customHeaders?: Record<string, string> | null;
}

/** 数据适配器连接可填的字段；每种适配器实际需要哪些由后端列表的 fields 给出。 */
export type DataAdapterField = "url" | "user" | "password";

/** 某种适配器已保存的连接（业务配置 dataAdapterConnections 的值）。 */
export type DataAdapterConnection = Partial<Record<DataAdapterField, string>>;

/** 本版本已安装的数据适配器（GET /businessConfig/dataAdapters 的一项）。 */
export interface DataAdapterInfo {
  type: string;
  label: string;
  sql: boolean;
  fields: DataAdapterField[];
  /** 输入框示例（只含有示例的字段），由适配器模块声明。 */
  examples: Partial<Record<DataAdapterField, string>>;
}

/** 系统配置页编辑的通用参数、语言与数据适配器。 */
export interface SystemSettings {
  knowledgeMaxResult: number;
  toolAndPythonRetry: number;
  dslCookerTries: number;
  dslCookerTimeout: number;
  questionSpliterTries: number;
  questionSpliterTimeout: number;
  lang: string;
  dataAdapter: string;
  dataAdapterConnections: Record<string, DataAdapterConnection>;
}

/** GET /businessConfig/getConfig 中两页读取的部分：系统配置页读取通用设置与技能目录，模型配置页读取 Embedding。 */
export interface BusinessConfig extends SystemSettings {
  agents: Record<ModelRole, BackendAgentConfig>;
  embeddingModelProperties: EmbeddingModelConfig | null;
}

export type GeneralConfigKey =
  | "knowledgeMaxResult"
  | "toolAndPythonRetry"
  | "dslCookerTries"
  | "dslCookerTimeout"
  | "questionSpliterTries"
  | "questionSpliterTimeout"
  | "lang";

// Model identity: name is the fixed config ID and displayName may be duplicated;
// append the ID when they differ, show it once when they match.
export function modelLabel(model: { name: string; displayName: string }): string {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

export function formatTimeout(seconds: number): string {
  return `PT${seconds}S`;
}
