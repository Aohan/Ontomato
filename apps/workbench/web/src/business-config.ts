import type { BusinessConfigProps } from "@ontomato/workbench-ui";

/** 本版系统配置页的原值（迁出前开源 BusinessConfig 与子卡），经 /admin/system-config 路由 props 传入。 */
export const businessConfig: BusinessConfigProps = {
  defaultLanguage: "en",
  adapterDisplay: {
    labelWidth: "150px",
    urlSpan: 24,
    credentialSpan: 12,
  },
  languageLabels: { zhCN: "Simplified Chinese", zhTW: "Traditional Chinese", ja: "Japanese" },
};
