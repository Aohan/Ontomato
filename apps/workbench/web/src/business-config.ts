import type { BusinessConfigProps } from "@ontomato/workbench-ui";

/** 本版系统配置页的原值（迁出前开源 BusinessConfig 与子卡），经 /admin/system-config 路由 props 传入。 */
export const businessConfig: BusinessConfigProps = {
  defaultLanguage: "en",
  defaultDataAdapter: "postgre",
  // 开源首发界面上只开放 PostgreSQL；其余适配器的表单、保存接口与后端逻辑保留，入口先注释掉。
  adapterModes: [
    "postgre",
    // "mysql",
    // "oracle",
    // "sqlserver",
    // "db2",
    // "gaussdb",
    // "duckdb",
  ],
  extraAdapter: null,
  adapterDisplay: {
    labelWidth: "150px",
    urlSpan: 24,
    credentialSpan: 12,
    postgrePlaceholder: "jdbc:postgresql://localhost:5432/your_database",
  },
  languageLabels: { zhCN: "Simplified Chinese", zhTW: "Traditional Chinese", ja: "Japanese" },
};
