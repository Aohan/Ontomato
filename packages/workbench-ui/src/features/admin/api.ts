import { apiGet, apiPost, nodeApiGet, nodeApiPost } from "../../utils/api";
import type { SystemModelConfig } from "@ontomato/contracts/system-model";
import type { DataAdapterConnection, GeneralConfigKey, ModelEntry, RoleModels } from "../system";

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
  getModelSettings: () => apiGet("/businessConfig/getModelSettings"),
  saveModelSettings: (payload: { models: ModelEntry[]; agents: RoleModels }) =>
    apiPost("/businessConfig/saveModelSettings", payload),
  saveToolSkillDir: (skilldir: string) => apiPost("/businessConfig/saveToolSkillDir", { skilldir }),
  testModel: (model: ModelEntry, prompt: string) =>
    apiPost("/businessConfig/testModel", { model, prompt }),
  saveEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/saveEmbeddingModel", payload),
  saveGeneralConfig: (key: GeneralConfigKey, value: unknown) =>
    apiPost(generalConfigSaveEndpoints[key], { [key]: value }),
  listDataAdapters: () => apiGet("/businessConfig/dataAdapters"),
  useDataAdapter: (payload: { type: string } & DataAdapterConnection) =>
    apiPost("/businessConfig/useDataAdapter", payload),
  testEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/testEmbeddingModel", payload),
  getSystemModelConfig: () => nodeApiGet("/system-model-config"),
  saveSystemModelConfig: (payload: SystemModelConfig) =>
    nodeApiPost("/system-model-config/save", payload),
  queryAuditLogs: (params: unknown) => apiPost("/auditLog/queryPage", params),
  getServiceInfo: () => apiGet("/maintenance/getserviceinfo"),
  runServiceAction: (payload: unknown) => apiPost("/maintenance/serviceaction", payload),
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
