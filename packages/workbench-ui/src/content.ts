/**
 * 应用静态装配的工作台内容：两版迁出前各自的原值，不随界面语言变化，也不从 Node 词包推导。
 * 分三类：与 Node 同一事实的产品字面量、历史匹配规则（原样保留，其中已知的旧不一致也不修）、
 * 独立的界面固定文案与 console 文案。已有 t 键的文字仍走词条；错误拼接标点另由 errorPunctuation 提供。
 */
import type { PromptTranscriptFormat } from "@ontomato/contracts/observe";

export interface WorkbenchContent {
  /** 子图代码块围栏，与 Node product.subgraphFence 为同一值（MessageContent/utils/markdown.ts）。 */
  subgraphFence: string;
  /** 产品显示名，与 Node product.serviceDisplayName 为同一值：PPT 作者/公司、外观设置的默认品牌名。 */
  serviceDisplayName: string;
  /** “当前问答线程”在 sessionStorage 中的键前缀（持久化值，chat/utils/current-qa-thread.ts）。 */
  currentQaThreadStoragePrefix: string;
  /** 分析报告 PDF 下载文件名前缀（analysis store、SnapshotContent）。 */
  reportPdfFilePrefix: string;
  /** 识别“综合总结”章节的标题集合（utils/analysis-report.ts）。 */
  comprehensiveSummaryTitles: readonly string[];
  /** 识别种子默认智能体的名称与说明，匹配到时改显当前语言的默认文案（agentDisplay、AnalysisTaskPanel）。 */
  defaultAgentNames: readonly string[];
  defaultAgentDescriptions: readonly string[];
  /** 热卡正文里的问答标记：取问题行、去掉问题行与回答标记（query-view/utils/thinkingUtils.ts）。 */
  hotCardQa: { question: RegExp; questionLine: RegExp; answerLine: RegExp };
  /** 热卡参数替换说明“原条件…替换为…”（HotCardDetail.vue）。 */
  hotCardConditionReplacement: RegExp;
  /** 回答正文里推断图表类型与“要可视化”的关键词（MessageContent/utils/markdown.ts）。 */
  chartIntentKeywords: {
    trend: readonly string[];
    proportion: readonly string[];
    correlation: readonly string[];
    visualization: readonly string[];
  };
  /** 子图步骤表的条件与字段：拆分、空值识别与展示连接符（SubgraphView.vue）。 */
  subgraphListItems: { split: RegExp; empty: RegExp; join: string };
  /** 质检结果中“步骤 N”标签（QcInlineResult.vue）。 */
  qcStepLabel: RegExp;
  /** 从回答前文取当前子问题的模板短语（MessageContent/index.vue）。 */
  answerSubject: RegExp;
  /** 技能列表的连接符（analysis/utils/loop-activity.ts）。 */
  skillListSeparator: string;
  /** 分析智能体 MCP 服务名，与 Node product.analysisMcpServerName 为同一值：MCP 页已发布服务里识别该服务（McpManager.vue）。 */
  analysisMcpServerName: string;
  /**
   * 智能体编辑弹窗（AgentCreateDialog）的原展示，聊天与管理两个入口传同一值：开源聊天布局与管理页
   * “分析智能体”（AnalysisAgentManager，其本页表单标签规则也按 labelWrap）都原样传给弹窗；
   * 开源原为必填星号在右、MCP 下拉随输入框宽、标签换行；企业原全部省略、标签不换行（企业聊天布局不传）。
   */
  agentDialogDisplay: { requireAsteriskPosition?: "right"; fitInputWidth?: boolean; labelWrap?: boolean };
  /** 分析智能体列表加载失败提示里“加载失败”与错误信息之间的原分隔（AnalysisAgentManager.vue）。 */
  analysisAgentLoadErrorSeparator: string;
  /** 技能调试 echarts 技能的默认输入示例（原 JSON.stringify(…, null, 2) 结果，SkillDebugDialog.vue），不随界面语言变化。 */
  skillDebugEchartsInput: string;
  /**
   * 观察页（/observe）的产品协议值：实时日志左栏的应用日志源，与 Node product.logSource 同一值（LiveLogsPage.vue）；
   * 提示词产物的标记词/轮次规则，与 Node 产物协议 WorkspaceArtifactText 为同一对象（FilePreview → 阅读解析）；
   * 提示词目录名，与 Node product.diagnosisWorkspaceNames.prompts 同一值（按路径判断是否提示词产物）。
   */
  observe: {
    appLogSource: string;
    promptTranscript: PromptTranscriptFormat;
    promptDirectoryName: string;
  };
  text: WorkbenchFixedText;
  console: WorkbenchConsoleText;
  dashboard: DashboardVisuals;
}

/** 原源码写死的界面文字（两版各自的原句）。 */
export interface WorkbenchFixedText {
  /** 分析与追问 SSE 连接失败（analysis/api.ts）。 */
  sseConnectionFailed: string;
  /** 分析运行 SSE 断开（analysis/api.ts）。 */
  connectionFailed: string;
  /** 分析执行记录切换（AnalysisChatView.vue）。 */
  runSwitcher: { label: string; previous: string; next: string };
  /** 回答与报告的赞踩反馈（ChatView.vue、AnalysisReportView.vue）。 */
  feedback: {
    cancelled: string;
    cancelFailed: string;
    promptMessage: string;
    promptTitle: string;
    submit: string;
    cancel: string;
    queryPlaceholder: string;
    analysisPlaceholder: string;
    required: string;
    thanks: string;
    submitted: string;
    submitFailed: string;
    like: string;
    dislike: string;
  };
  /**
   * 平台反馈记录页的原句（FeedbackRecords.vue）：列标题、详情、筛选占位、CSV 表头与来源单元格、提示。
   * 同一原句在页面各处共用一个字段；评价的赞/踩取上面 feedback.like/dislike（两版原句相同）。
   */
  feedbackRecords: {
    sourceQa: string;
    sourceAnalysisTask: string;
    time: string;
    source: string;
    rating: string;
    user: string;
    input: string;
    output: string;
    feedback: string;
    relatedId: string;
    actions: string;
    details: string;
    detailTitle: string;
    searchPlaceholder: string;
    loadFailed: string;
    exportEmpty: string;
    exportSucceeded: string;
    exportFailed: string;
  };
  /** 批量删除部分失败提示末尾的计数原文（问数示例两类批删）。 */
  batchDeleteFailureSuffix: (failed: number, total: number) => string;
  /** 问数示例卡片字段标签后的原冒号（ExamplesManager.vue 五处）；与请求错误的 errorPunctuation 各自独立。 */
  exampleFieldSeparator: string;
  /** 系统配置与模型配置页错误说明与超时文本的原分隔（BusinessConfig 及 BackendModelList/SystemModel/Embedding×2/QuerySettings 六处）。 */
  businessConfigSeparator: string;
  /** PPT 章节标题缺省与提炼失败（analysis/utils/ppt.ts）。 */
  pptSectionFallback: string;
  pptOutlineFailed: string;
  /** 新建仪表盘失败（dashboard/api.ts）。 */
  createDashboardFailed: string;
  /** 技能列表响应格式无效（skills/api.ts）。 */
  skillsListInvalid: string;
  /** 空错误信息的展示（query-view/utils/display-error.ts）。 */
  unknownError: string;
  /** 热卡弹窗标题中的条数（HotCardModal.vue）。 */
  cardCount: (label: string, count: number) => string;
  /**
   * 观察页写死的原句：聊天诊断入口自动发送的消息（ObserveLayout.vue）、欢迎页快捷问题的提交值（WelcomePage.vue，
   * 显示用 t 键）、产物详情的“已取消”标签/文件加载失败/大文件截断提示（ArtifactDetail.vue）、测试批次恢复日志（TestPage.vue）。
   */
  observe: {
    autoTurnDiagnosisMessage: string;
    welcomePrompts: {
      analyzeSystem: string;
      troubleshootConfig: string;
      checkLLM: string;
      viewRecentErrors: string;
    };
    cancelled: string;
    fileLoadFailed: string;
    largeFilePreview: (loadedSize: string) => string;
    restoredTestBatch: (runId: string) => string;
  };
}

/** 原源码写死的 console 文案（两版各自的原句）。 */
export interface WorkbenchConsoleText {
  deepAnalysisConnected: string;
  deepAnalysisParseFailed: string;
  deepAnalysisError: string;
  followUpConnected: string;
  followUpParseFailed: string;
  followUpError: string;
  followUpRunParseFailed: string;
  loadAgentsFailed: string;
  loadTasksFailed: string;
  loadTaskHistoryFailed: string;
  loadConversationTurnsFailed: string;
  loadRunHistoryFailed: string;
  loadTaskDetailFailed: string;
  loadQaThreadsFailed: string;
  loadMessagesFailed: (threadId: string) => string;
  loadHistoryFailed: string;
  deleteQaThreadFailed: string;
  analysisActivityInvalid: string;
  analysisEventUnknown: string;
  reportChartMarkerUnmatched: (label: string) => string;
}

/** 仪表盘图表的品牌配色与两处展示（dashboard/components 与 utils）。 */
export interface DashboardVisuals {
  /** echarts 注册的主题名（原值）。 */
  themeName: string;
  /** 系列色，主题 color 与按序取色共用。 */
  series: readonly string[];
  /** 主题里随明暗变化的颜色；某一版原本不随明暗变化的项两种情况返回同值。 */
  themeColors(isDark: boolean): DashboardThemeColors;
  /** 柱状渐变：系列色 → [顶部, 底部]。 */
  barGradients: Readonly<Record<string, readonly [string, string]>>;
  /** 面积渐变：系列色 → 三段不透明度；未登记颜色用 defaultAreaGradient。 */
  areaGradients: Readonly<Record<string, readonly [string, string, string]>>;
  defaultAreaGradient: readonly [string, string, string];
  /** 放大弹窗的图表主题：企业原用 echarts 默认主题，开源原先注册并使用仪表盘主题。 */
  zoomChartTheme: "default" | "dashboard";
  /** 图表与指标卡加载遮罩：企业原为 Element Plus 默认底色，开源原为透明。 */
  loadingMask: "default" | "transparent";
  /**
   * 生成器里写死、不随明暗变化的配色：主色 RGB（各处阴影透明度保持原值）、
   * 标签与次级标签色、雷达分隔线、仪表盘轨道与刻度。
   */
  chartColors: {
    primaryRgb: string;
    label: string;
    labelSecondary: string;
    radarSplitLine: string;
    gaugeTrack: string;
  };
  /** 生成器的两处 tooltip 原句：值与占比、树图的值与占比行。 */
  chartTooltips: {
    valueWithPercent(value: string, percent: string): string;
    valueWithShare(key: string, value: string, percent: string): string;
  };
  /** 图表健康检查返回的原因原句；chart 为原句开头的图表类型名，数值为原句里的计数。 */
  healthReasons: DashboardHealthReasons;
}

export interface DashboardHealthReasons {
  xAxisDataEmpty(chart: string): string;
  barSeriesMissing: string;
  lineSeriesMissing: string;
  barLineLengthMismatch: string;
  seriesDataEmpty(chart: string): string;
  areaLineAllZero: string;
  areaLineLengthMismatch(x: number, y: number): string;
  scatterIllegalPoints(n: number): string;
  radarIndicatorEmpty: string;
  radarValueEmpty: string;
  radarTooFewDimensions: string;
  radarLengthMismatch(indicators: number, values: number): string;
  radarIllegalMax: string;
  sankeyFieldsMissing: string;
  sankeyNodesEmpty: string;
  sankeyLinksEmpty: string;
  sankeyLinksOutsideNodes(n: number): string;
  sankeyAllZero: string;
  sankeyIllegalValues(n: number): string;
  sankeyDuplicateEdges(n: number): string;
  illegalValues(chart: string, n: number): string;
  boxplotIllegalItems(n: number): string;
  gaugeIllegalValue: string;
  liquidFillIllegalValues(n: number): string;
}

export interface DashboardThemeColors {
  text: string;
  textSecondary: string;
  axis: string;
  splitLine: string;
  border: string;
  visualMap: readonly string[];
  /** K 线阳线颜色与边框（两版原本都相同）。 */
  kPositive: string;
  timelineLine: string;
  /** 时间轴节点、控件与标签（两版原本都相同）。 */
  timelineAccent: string;
  timelineCheck: string;
}

let content: WorkbenchContent | null = null;

export function installWorkbenchContent(next: WorkbenchContent): void {
  content = next;
}

/** 模块级代码在调用时读取（不在模块求值时读取）。 */
export function workbenchContent(): WorkbenchContent {
  if (!content) throw new Error("Workbench content is not installed");
  return content;
}
