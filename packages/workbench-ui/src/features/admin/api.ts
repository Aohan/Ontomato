import { apiGet, apiPost, nodeApiFetch, nodeApiGet, nodeApiPost } from "../../utils/api";
import type { AgentKey, GeneralConfigKey } from "../system";

const generalConfigSaveEndpoints: Record<GeneralConfigKey, string> = {
  knowledgeMaxResult: "/businessConfig/saveKnowledgeMaxResult",
  toolAndPythonRetry: "/businessConfig/saveToolAndPythonRetry",
  dslCookerTries: "/businessConfig/saveDslCookerTries",
  dslCookerTimeout: "/businessConfig/saveDslCookerTimeout",
  questionSpliterTries: "/businessConfig/saveQuestionSpliterTries",
  questionSpliterTimeout: "/businessConfig/saveQuestionSpliterTimeout",
  lang: "/businessConfig/saveLang",
};

export const adminApi = {
  getBusinessConfig: () => apiGet("/businessConfig/getConfig"),
  saveBackendModels: (models: unknown) => apiPost("/businessConfig/saveModels", { models }),
  saveBackendAgentModels: (modelsByRole: Record<AgentKey, string>) =>
    apiPost("/businessConfig/saveAgentModels", { modelsByRole }),
  saveToolSkillDir: (skilldir: string) => apiPost("/businessConfig/saveToolSkillDir", { skilldir }),
  testBackendModel: (model: unknown, prompt: string) =>
    apiPost("/businessConfig/testModel", { model, prompt }),
  saveEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/saveEmbeddingModel", payload),
  saveGeneralConfig: (key: GeneralConfigKey, value: unknown) =>
    apiPost(generalConfigSaveEndpoints[key], { [key]: value }),
  usePostgreDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/usePostgreDataAdapter", payload),
  useMysqlDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/useMysqlDataAdapter", payload),
  useOracleDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/useOracleDataAdapter", payload),
  useSqlServerDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/useSqlServerDataAdapter", payload),
  useDb2DataAdapter: (payload: unknown) => apiPost("/businessConfig/useDb2DataAdapter", payload),
  useDmDataAdapter: (payload: unknown) => apiPost("/businessConfig/useDmDataAdapter", payload),
  useGaussDbDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/useGaussDBDataAdapter", payload),
  useDuckDBDataAdapter: (payload: unknown) =>
    apiPost("/businessConfig/useDuckDBDataAdapter", payload),
  testEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/testEmbeddingModel", payload),
  getSystemModelConfig: () => nodeApiGet("/system-model-config"),
  saveSystemModelConfig: (payload: unknown) => nodeApiPost("/system-model-config/save", payload),
  testSystemModelConfig: (payload: unknown) =>
    nodeApiFetch("/system-model-config/test", "POST", payload),
  queryAuditLogs: (params: unknown) => apiPost("/auditLog/queryPage", params),
  getServiceInfo: () => apiGet("/maintenance/getserviceinfo"),
  runServiceAction: (payload: unknown) => apiPost("/maintenance/serviceaction", payload),
  listKnowledge: () => apiPost("/admin/getBussinessKnowledge", {}),
  addKnowledge: (payload: unknown) => apiPost("/admin/addBussinessKnowledge", payload),
  editKnowledge: (payload: unknown) => apiPost("/admin/editBussinessKnowledge", payload),
  deleteKnowledge: (knowledgeID: unknown) =>
    apiPost("/admin/delBussinessKnowledge", { knowledgeID }),
  editClassDescription: (payload: unknown) => apiPost("/admin/editClassDesc", payload),
  editClassShowName: (payload: unknown) => apiPost("/admin/editClassShowName", payload),
  editClassAttributeDescription: (payload: unknown) => apiPost("/admin/editClassAttrDesc", payload),
  editClassAttributeShowName: (payload: unknown) =>
    apiPost("/admin/editClassAttrShowName", payload),
  editClassAttributeShouldReturn: (payload: unknown) =>
    apiPost("/admin/editClassAttrShouldReturn", payload),
  setClassAttrPermissionField: (payload: unknown) =>
    apiPost("/admin/setClassAttrPermissionField", payload),
  addClass: (payload: unknown) => apiPost("/admin/addClass", payload),
  deleteClass: (className: string) => apiPost("/admin/delClass", { className }),
  addClassAttribute: (payload: unknown) => apiPost("/admin/addClassAttr", payload),
  editClassAttrPrimaryKey: (payload: unknown) => apiPost("/admin/editClassAttrPrimaryKey", payload),
  deleteClassAttribute: (payload: unknown) => apiPost("/admin/delClassAttr", payload),
  editClassInStarChart: (payload: unknown) => apiPost("/admin/editClassInStarChart", payload),
  addBucketIndicator: (payload: unknown) => apiPost("/admin/addBucketIndicator", payload),
  deleteBucketIndicator: (payload: unknown) => apiPost("/admin/delBucketIndicator", payload),
  addRelationship: (payload: unknown) => apiPost("/admin/addRelationship", payload),
  deleteRelationship: (relationName: string) => apiPost("/admin/delRelationship", { relationName }),
  editRelationshipDescription: (payload: unknown) =>
    apiPost("/admin/editRelationshipDesc", payload),
  editBucketIndicatorDescription: (payload: unknown) =>
    apiPost("/admin/editBucketIndicatorDesc", payload),
  editBucketIndicatorUnit: (payload: unknown) => apiPost("/admin/editBucketIndicatorUnit", payload),
};
