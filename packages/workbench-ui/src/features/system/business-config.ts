/**
 * 系统配置页（BusinessConfig）的应用装配输入：两个应用各在路由记录上以 props 传入本版原值。
 * 业务默认值与界面语言、Node 产品配置互不推导。
 */

/** 数据适配器卡片的原版式：表单标签宽、URL 与凭据两列栅格。 */
export interface BusinessConfigAdapterDisplay {
  labelWidth: string;
  urlSpan: number;
  credentialSpan: number;
}

/** 后端语言下拉中三个原固定显示名（其余语言的显示名两版相同，仍在组件内）。 */
export interface BusinessConfigLanguageLabels {
  zhCN: string;
  zhTW: string;
  ja: string;
}

export interface BusinessConfigProps {
  /** 业务配置语言的缺省值：初始值、加载缺省与语言下拉占位共用。 */
  defaultLanguage: string;
  adapterDisplay: BusinessConfigAdapterDisplay;
  languageLabels: BusinessConfigLanguageLabels;
}
