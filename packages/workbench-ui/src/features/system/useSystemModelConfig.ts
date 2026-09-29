import type { SystemModelConfigResponse as SystemModelConfig } from "@ontomato/contracts/system-model";
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { adminApi } from "../admin";

/**
 * 应用（Node）模型配置的读取：模型配置页用其中的模型与角色引用，系统配置页用其中的问数设置；
 * 两页各自保存本区字段（部分更新），读取与错误态在此一处。
 */
export function useSystemModelConfig() {
  const { t } = useI18n();
  const systemModel = reactive<SystemModelConfig>({
    models: [],
    agents: { default: { model: "" }, diagnosis: { model: "" } },
    abcQuestionMode: "harness",
    queryTimeoutSeconds: 600,
    hasCustomConfig: false,
  });
  const loadingSystemModel = ref(false);
  const systemLoadError = ref("");

  async function loadSystemModelConfig() {
    loadingSystemModel.value = true;
    systemLoadError.value = "";
    try {
      const res = await adminApi.getSystemModelConfig();
      if (res?.success) {
        Object.assign(systemModel, res.data as SystemModelConfig);
      } else {
        systemLoadError.value = res?.message || t("admin.loadConfigFailed");
      }
    } catch (e: any) {
      systemLoadError.value = e.message || t("admin.loadConfigFailed");
      ElMessage.error(e.message || t("admin.loadConfigFailed"));
    } finally {
      loadingSystemModel.value = false;
    }
  }

  return { systemModel, loadingSystemModel, systemLoadError, loadSystemModelConfig };
}
