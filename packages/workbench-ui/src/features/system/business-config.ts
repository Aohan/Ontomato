/**
 * 系统配置页（BusinessConfig）的应用装配输入：两个应用各在路由记录上以 props 传入本版原值。
 * 业务默认值与界面语言、Node 产品配置互不推导。
 */

/**
 * 额外的数据适配器（公共八种之外）：在适配器单选的首位显示，保存时调用 save 并提示 successKey。
 * 不需要时应用传 null。
 */
export interface BusinessConfigExtraAdapter {
  mode: string;
  labelKey: string;
  successKey: string;
  save: () => Promise<unknown>;
}

/** 数据适配器卡片的原版式与示例：表单标签宽、URL 与凭据两列栅格、PostgreSQL 示例地址、达梦 URL 标签。 */
export interface BusinessConfigAdapterDisplay {
  labelWidth: string;
  urlSpan: number;
  credentialSpan: number;
  postgrePlaceholder: string;
  damengLabel: string;
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
  /** 数据适配器缺省 mode：初始值与 normalize 末尾回退共用。 */
  defaultDataAdapter: string;
  extraAdapter: BusinessConfigExtraAdapter | null;
  adapterDisplay: BusinessConfigAdapterDisplay;
  languageLabels: BusinessConfigLanguageLabels;
}
