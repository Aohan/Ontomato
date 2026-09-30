/**
 * Workbench content supplied statically by the app: each edition's original values from before extraction, independent
 * of the UI locale and not derived from the Node message bundle. Three kinds: product literals that are the same fact as
 * in Node, historical matching rules (kept as-is, including known old inconsistencies), and standalone fixed UI and
 * console text. Text that already has a t key still uses messages; error joining punctuation comes from errorPunctuation.
 */
import type { PromptTranscriptFormat } from "@ontomato/contracts/observe";

export interface WorkbenchContent {
  /** Subgraph code block fence, the same value as Node product.subgraphFence (MessageContent/utils/markdown.ts). */
  subgraphFence: string;
  /** Product display name, the same value as Node product.serviceDisplayName: PPT author/company and the default brand name in appearance settings. */
  serviceDisplayName: string;
  /** Key prefix of the "current Q&A thread" in sessionStorage (a persisted value, chat/utils/current-qa-thread.ts). */
  currentQaThreadStoragePrefix: string;
  /** File name prefix of downloaded analysis report PDFs (analysis store, SnapshotContent). */
  reportPdfFilePrefix: string;
  /** Headings that identify the "overall summary" section (utils/analysis-report.ts). */
  comprehensiveSummaryTitles: readonly string[];
  /** Name and description that identify the seeded default agent; on a match the current locale's default text is shown instead (agentDisplay, AnalysisTaskPanel). */
  defaultAgentNames: readonly string[];
  defaultAgentDescriptions: readonly string[];
  /** Q&A markers in hot card bodies: pick the question line and strip the question line and answer marker (query-view/utils/thinkingUtils.ts). */
  hotCardQa: { question: RegExp; questionLine: RegExp; answerLine: RegExp };
  /** Hot card parameter replacement note "original condition … replaced with …" (HotCardDetail.vue). */
  hotCardConditionReplacement: RegExp;
  /** Keywords in answer bodies used to infer the chart type and the "wants a visualization" intent (MessageContent/utils/markdown.ts). */
  chartIntentKeywords: {
    trend: readonly string[];
    proportion: readonly string[];
    correlation: readonly string[];
    visualization: readonly string[];
  };
  /** Conditions and fields of the subgraph step table: splitting, empty-value detection and display separators (SubgraphView.vue). */
  subgraphListItems: { split: RegExp; empty: RegExp; join: string };
  /** "Step N" label in quality check results (QcInlineResult.vue). */
  qcStepLabel: RegExp;
  /** Template phrase for taking the current sub-question from the preceding answer text (MessageContent/index.vue). */
  answerSubject: RegExp;
  /** Separator of skill lists (analysis/utils/loop-activity.ts). */
  skillListSeparator: string;
  /** Analysis agent MCP server name, the same value as Node product.analysisMcpServerName: identifies that server among published services on the MCP page (McpManager.vue). */
  analysisMcpServerName: string;
  /** Operations agent MCP server name, the same value as Node product.opsMcpServerName: identifies that server the same way (McpManager.vue). */
  opsMcpServerName: string;
  /**
   * Original display of the agent edit dialog (AgentCreateDialog); the chat and admin entries pass the same value: the
   * open-source chat layout and the admin "analysis agents" page (AnalysisAgentManager, whose own form labels also follow
   * labelWrap) both pass it to the dialog as-is. Open source: required asterisk on the right, MCP dropdown as wide as the
   * input, wrapping labels; when omitted, all are left unset and labels do not wrap.
   */
  agentDialogDisplay: { requireAsteriskPosition?: "right"; fitInputWidth?: boolean; labelWrap?: boolean };
  /** Original separator between "failed to load" and the error message in the analysis agent list load failure message (AnalysisAgentManager.vue). */
  analysisAgentLoadErrorSeparator: string;
  /** Default input example for debugging the echarts skill (the original JSON.stringify(…, null, 2) result, SkillDebugDialog.vue), independent of the UI locale. */
  skillDebugEchartsInput: string;
  /**
   * Product protocol values of the observe page (/observe): the application log source in the live log sidebar, the same
   * value as Node product.logSource (LiveLogsPage.vue); the marker words/turn rules of prompt artifacts, the same object as
   * the Node artifact protocol WorkspaceArtifactText (FilePreview → reading parser); and the prompt directory name, the same
   * value as Node product.diagnosisWorkspaceNames.prompts (used to tell prompt artifacts by path).
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

/** UI text that was hard-coded in the original source (each edition's own sentences). */
export interface WorkbenchFixedText {
  /** SSE connection failure for analysis and follow-ups (analysis/api.ts). */
  sseConnectionFailed: string;
  /** Analysis run SSE disconnected (analysis/api.ts). */
  connectionFailed: string;
  /** Switching between analysis runs (AnalysisChatView.vue). */
  runSwitcher: { label: string; previous: string; next: string };
  /** Like/dislike feedback on answers and reports (ChatView.vue, AnalysisReportView.vue). */
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
   * Original sentences of the platform feedback records page (FeedbackRecords.vue): column titles, details, filter
   * placeholders, CSV headers and source cells, and messages. The same sentence shares one field across the page; the
   * like/dislike ratings use feedback.like/dislike above.
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
  /** Original count text at the end of partial batch-delete failure messages (both query example batch deletes). */
  batchDeleteFailureSuffix: (failed: number, total: number) => string;
  /** Original colon after field labels on query example cards (five places in ExamplesManager.vue); independent of errorPunctuation for request errors. */
  exampleFieldSeparator: string;
  /** Original separator between error explanations and timeout text on the system and model configuration pages. */
  businessConfigSeparator: string;
  /** Default PPT section title and extraction failure (analysis/utils/ppt.ts). */
  pptSectionFallback: string;
  pptOutlineFailed: string;
  /** Dashboard creation failure (dashboard/api.ts). */
  createDashboardFailed: string;
  /** Invalid skill list response format (skills/api.ts). */
  skillsListInvalid: string;
  /** Display of an empty error message (query-view/utils/display-error.ts). */
  unknownError: string;
  /** Item count in the hot card dialog title (HotCardModal.vue). */
  cardCount: (label: string, count: number) => string;
  /**
   * Sentences hard-coded in the observe page: the message the chat diagnosis entry sends automatically (ObserveLayout.vue),
   * the submitted values of welcome page quick questions (WelcomePage.vue; the display uses t keys), the "cancelled" label,
   * file load failure and large-file truncation notes of artifact details (ArtifactDetail.vue), and the test batch resume log (TestPage.vue).
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

/** Console text that was hard-coded in the original source (each edition's own sentences). */
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

/** Brand colours of dashboard charts and two display details (dashboard/components and utils). */
export interface DashboardVisuals {
  /** Theme name registered with echarts (original value). */
  themeName: string;
  /** Series colours, shared by the theme color and sequential colour picking. */
  series: readonly string[];
  /** Theme colours that change with light/dark; items that originally did not change in an edition return the same value in both cases. */
  themeColors(isDark: boolean): DashboardThemeColors;
  /** Bar gradient: series colour → [top, bottom]. */
  barGradients: Readonly<Record<string, readonly [string, string]>>;
  /** Area gradient: series colour → three opacity stops; unregistered colours use defaultAreaGradient. */
  areaGradients: Readonly<Record<string, readonly [string, string, string]>>;
  defaultAreaGradient: readonly [string, string, string];
  /** Chart theme of the zoom dialog: either echarts' default theme or (open source) the registered dashboard theme. */
  zoomChartTheme: "default" | "dashboard";
  /** Loading mask of charts and metric cards: the Element Plus default background or (open source) transparent. */
  loadingMask: "default" | "transparent";
  /**
   * Colours hard-coded in the generator that do not change with light/dark: the primary RGB (shadow opacities keep their
   * original values), label and secondary label colours, radar split lines, and gauge track and ticks.
   */
  chartColors: {
    primaryRgb: string;
    label: string;
    labelSecondary: string;
    radarSplitLine: string;
    gaugeTrack: string;
  };
  /** The generator's two original tooltip sentences: value with share, and the value/share line of tree maps. */
  chartTooltips: {
    valueWithPercent(value: string, percent: string): string;
    valueWithShare(key: string, value: string, percent: string): string;
  };
  /** Original reason sentences returned by the chart health check; chart is the chart type name at the start of the sentence and the numbers are the counts in it. */
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
  /** Candlestick rising colour and border (originally the same in both editions). */
  kPositive: string;
  timelineLine: string;
  /** Timeline nodes, controls and labels (originally the same in both editions). */
  timelineAccent: string;
  timelineCheck: string;
}

let content: WorkbenchContent | null = null;

export function installWorkbenchContent(next: WorkbenchContent): void {
  content = next;
}

/** Module-level code reads this at call time (not at module evaluation). */
export function workbenchContent(): WorkbenchContent {
  if (!content) throw new Error("Workbench content is not installed");
  return content;
}
