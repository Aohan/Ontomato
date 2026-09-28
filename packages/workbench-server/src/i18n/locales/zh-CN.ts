export const zhCN = {
  // Branch labels
  "query.branch.static": "固定指标热数据",
  "query.branch.hot": "动态指标热数据",
  "query.branch.abc": "ABC 拆解",

  // Status labels
  "query.status.retrieving": "检索中",
  "query.status.decomposing": "拆解中",
  "query.status.notFound": "未命中",
  "query.status.cancelled": "已取消",
  "query.status.completed": "完成",
  "query.status.notConfigured": "未配置",
  "query.status.insufficientCoverage": "覆盖不足",
  "query.status.noAvailableData": "未召回到可用数据",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart": "🧭 正在并行执行：固定指标热数据 / 动态指标热数据 / ABC 拆解…",

  // Thinking logs - static branch
  "query.thinking.staticChecking": "检查固定指标热数据，看看是否已覆盖该问题…",
  "query.thinking.staticNotFound": "未命中固定指标热数据，继续等待其他分支。",
  "query.thinking.staticNotAvailable": "召回结果不可用，继续等待其他分支。",
  "query.thinking.staticKnowledgeSupplement": "补充业务知识上下文（用于核验）。",
  "query.thinking.staticKnowledgeFailed": "业务知识补充失败（忽略，继续核验）。",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `命中 ${params?.count ?? 0} 条内容，正在核验覆盖度。`,
  "query.thinking.staticInsufficient": "覆盖不足，继续等待其他分支。",
  "query.thinking.staticSufficient": "覆盖充分，开始拉取明细并生成结论。",
  "query.thinking.staticCardLocated": "📊 已定位到固定指标热数据来源，展示命中卡片内容：\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching": "检索动态指标热数据，争取直接给出结论…",
  "query.thinking.hotNotFound": "未命中动态指标热数据，继续等待 ABC 拆解。",
  "query.thinking.hotNotAvailable": "召回结果不可用，继续等待 ABC 拆解。",
  "query.thinking.hotKnowledgeSupplement": "补充业务知识上下文（用于核验）。",
  "query.thinking.hotKnowledgeFailed": "业务知识补充失败（忽略，继续核验）。",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `命中 ${params?.count ?? 0} 条相关内容，正在核验覆盖度。`,
  "query.thinking.hotInsufficient": "覆盖不足，继续等待 ABC 拆解。",
  "query.thinking.hotSufficient": "覆盖充分，开始拉取明细并生成结论。",
  "query.thinking.hotCardLocated": "📊 已定位到动态指标热数据来源，展示命中卡片内容：\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing": "正在拆解问题并生成查询步骤…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `查询完成，共 ${params?.count ?? 0} 个数据集`,

  // Query node messages
  "query.node.parallelProgress":
    "正在并行执行数据查询（固定指标热数据 / 动态指标热数据 / ABC 拆解）...",
  "query.node.noValidResult": "所有查询路径均未能返回有效结果",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `数据查询已完成（通过${params?.branchName ?? ""}），结果已准备好用于后续分析。`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `已完成数据查询（通过${params?.branchName ?? ""}）`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `检索到 ${params?.count ?? 0} 条热数据`,
  "query.hotData.noAvailableHotData": "未召回到可用热数据",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `命中 ${params?.docs ?? 0} 条，但覆盖不足（${params?.cards ?? 0} 张可用卡片）`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `命中 ${params?.docs ?? 0} 条，${params?.cards ?? 0} 张卡片覆盖充分`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `还有 ${params?.hidden ?? 0} 行，点击展开查看全部（共 ${params?.total ?? 0} 行）`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">结论</strong>：根据当前查询条件，未检索到相关数据记录。',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">结论</strong>：数据查询完成，但生成结论时遇到问题。',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `围绕<strong>「${params?.sq ?? ""}」</strong>，按 A → B → C 逐步说明：`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `依据上述步骤，<strong>「${params?.sq ?? ""}」</strong>的数据结果如下：`,

  // Subgraph / node labels
  "query.subgraph.label": "子图",
  "query.nodeTable.none": "无",

  // QC result label
  "query.qcResult.label": "质检结果",
  "query.qcProcess.label": "质检过程",

  // ABC / query progress
  "query.progress.splitting": "正在拆解问题...",
  "query.progress.splitDone": (params) => `拆解完成，共 ${params?.n ?? 0} 个子问题`,
  "query.progress.querying": "正在查询数据...",
  "query.progress.dataReceived": (params) => `收到第 ${params?.n ?? 0} 组数据`,
  "query.progress.dataDone": (params) => `数据查询完成，共 ${params?.n ?? 0} 组`,
  "query.progress.abcAnalyzing": (params) => `分析第 ${params?.n ?? 0} 个子问题`,
  "query.progress.queryingData": (params) => `查询第 ${params?.n ?? 0} 组数据`,

  // Status
  "query.status.queryCompleted": "查询完成",
  "query.status.queryFailed": "查询失败",
  "query.status.queryCancelled": "查询被终止",
  "query.error.apiNotConfigured": "API 未配置，请检查 .env 文件中的 DATA_QUERY_BASE_URL",
  "query.error.noSubQuestions": "问题拆分失败，未生成任何子问题",
  "query.error.queryFailed": (params) =>
    `查询失败：${params?.error ?? "未知错误"}。请检查 API 配置或尝试其他问题。`,
  "query.error.unknownError": "未知错误",
  "query.error.backendFailedWithoutReason": "后端返回失败但未给出原因",
  "query.error.responseNotJson": "返回体不是合法 JSON",
  "query.error.hotJudgeEmptyReply": "判定模型回复为空。原始回复：{preview}",
  "query.error.hotJudgeNotJson": "判定模型回复解析不出 JSON。原始回复：{preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "判定模型回复的 isAnswerable 不是布尔值。原始回复：{preview}",
  "query.error.hotJudgeNoValidCards":
    "判定模型判定可回答，但 usedCards 里没有有效卡片。原始回复：{preview}",

  // Success summaries
  "query.summary.success": "查询成功！",
  "query.summary.subQuestionCount": (params) => `子问题数量：${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `数据集数量：${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `总数据行数：${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `主要列：${params?.cols ?? ""}`,
  "query.summary.readyMessage": "数据已准备好，可进行分析或可视化。",
  "query.summary.dataChunk": (params) => `数据片段${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "综合总结",
  "response.dataTable": (params) => `数据表_${params?.n ?? 1}`,
  "response.queryData": "查询数据",
  "response.analyzeData": "分析数据",
  "response.generateChart": "生成图表",
  "response.clarification": "我理解你可能想问的是以下哪一种：",
  "response.generatingReply": "正在生成最终回复...",

  // Analysis agent
  "analysis.noValidData": "本子问题未查询到有效数据",
  "analysis.recordCount": (params) => `共查询到 ${params?.n ?? 0} 条数据记录`,
  "analysis.structuredTableHint": "已生成结构化表格，可用于对比不同对象、类别或时间点的数据差异",
  "analysis.datasetNoData": "本数据集未查询到有效数据",
  "analysis.progress.framework": "生成框架",
  "analysis.progress.collection": "采集指标",
  "analysis.progress.analysis": "数据分析",
  "analysis.progress.report": "生成报告",
  "analysis.activity.plan": "框架生成",
  "analysis.activity.evidence": "证据采集",
  "analysis.activity.skill": "执行技能",
  "analysis.activity.narrative": "智能体叙述",
  "analysis.activity.chapter": "撰写章节",
  "analysis.activity.publish": "章节定稿",
  "analysis.activity.chart": "生成图表",
  "analysis.activity.dispatch": "派遣子智能体",
  "analysis.activity.probe": "数据探测",
  "analysis.activity.external_tool": "调用外部工具",
  "analysis.runEnded": "分析运行已结束",
  "analysis.missingArtifacts": "分析运行未返回呈现产物",
  "analysis.cancelled": "深度分析已取消",

  // Checkpointer
  "checkpointer.newConversation": "新对话",
  "checkpointer.noAccess": "无权访问该会话",

  // ABC logger
  "abc.idle": "准备中",
  "abc.split": "理解问题",
  "abc.abcAnalysis": "分析中",
  "abc.data": "查询数据",
  "abc.conclusion": "总结结论",
  "abc.success": "完成",
  "abc.failed": "失败",
  "abc.cancelled": "已取消",
  "abc.exception": (params) => `异常：${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `已取消：${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `子问题 ${params?.n ?? 0}：${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `收到第 ${params?.n ?? 0} 组数据结果`,
  "abc.dataLogReceivedTotal": (params) =>
    `收到第 ${params?.n ?? 0} 组数据结果（共 ${params?.total ?? 0} 组）`,

  // API route messages
  "api.analysisAgentNotFound": "智能体不存在",
  "api.dimensionNotFound": "维度不存在",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `缺少必填字段：${params?.fields ?? ""}`,
  "api.cardNotFound": "卡片不存在",
  "api.invalidStatusValue": "无效的状态值，必须为 PENDING_REVIEW / PUBLISHED / UNUSED",
  "api.businessDescriptionMustBeString": "businessDescription 必须是字符串",
  "api.analysisTaskNotFound": "分析任务不存在",
  "api.noAccessToTask": "无权访问该任务",
  "api.taskIsRunning": "任务正在执行中",
  "api.taskAlreadyCancelled": "任务已取消",
  "api.dslCannotBeEmpty": "DSL 不能为空",
  "api.backendExecutionTimeout": "后端执行超时",
  "api.backendNotConfigured": "未配置后端地址(DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "反馈已提交",
  "api.loadConfigFailed": "获取配置失败",
  "api.saveConfigFailed": "保存配置失败",
  "api.modelTestFailed": "模型测试失败",
  "api.noAvailableDashboardData":
    "当前分析结果暂无可用数据。请先确认查询结果中有表格数据后再重试。",
  "api.dashboardNotFound": "仪表盘不存在",
  "api.cannotGenerateChartInterpretation": "暂时无法生成结构化图表解读",
  "api.checkpointerNotInitialized": "Checkpointer 未初始化",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `请求后端失败：${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "dsls 不能为空",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `获取条件失败：${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `执行失败：${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `DSL 执行失败: ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "我可以帮助你回答业务知识问题，或者你也可以直接告诉我想查询、分析或可视化什么数据。",
  "reply.defaultErrorMsg": "抱歉，我暂时无法处理你的请求，请稍后再试。",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `回复生成失败: ${params?.error ?? ""}`,
  "knowledge.created": "✅ 已生成业务知识：",
  "knowledge.creating": "正在生成业务知识…",
  "knowledge.creationFailed": "业务知识生成失败，请稍后重试。",

  // Planner node
  "planner.planningExecution": "正在规划执行节点...",

  // Analysis node
  "skill.keywordMatch": "关键词匹配",
  "skill.llmMatch": "LLM匹配",
  "skill.default": "默认",
  "analysisNode.matchingComputeSkills": "正在匹配计算型分析技能...",
  "analysisNode.skillMatchDone": "✓ 匹配计算型技能",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `正在执行 ${params?.skill ?? ""} 计算...`,
  "analysisNode.computeDone": "✓ 执行计算",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ ${params?.skill ?? ""} 执行失败: ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ 应用分析方法",
  "analysisNode.generatingAnswer": "正在生成分析回答...",
  "analysisNode.answerGenerated": "✓ 生成分析回答",
  "analysisNode.analysisComplete": "✓ 数据分析完成",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ 分析失败: ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "准备数据",
  "viz.matchingSkills": "匹配技能",
  "viz.analyzingData": "分析数据",
  "viz.generatingChart": "生成图表",
  "viz.preparingVisualization": "正在准备可视化",
  "viz.noRenderSkillsAvailable": "没有可用的渲染技能",
  "viz.initializationFailed": "可视化初始化失败",
  "viz.noRenderSkillsAvailableCheck": "没有可用的可视化渲染技能，请检查技能是否启用",
  "viz.missingData": "缺少数据",
  "viz.dataReady": "数据准备完成",
  "viz.matchingVisSkills": "正在匹配可视化技能",
  "viz.fetchingData": "正在获取数据...",
  "viz.skillMatchComplete": "技能匹配完成",
  "viz.analyzingDataStructure": "正在分析数据结构",
  "viz.dataAnalysisComplete": "数据分析完成",
  "viz.chart": "图表",
  "viz.chartGenerationComplete": "图表生成完成",
  "viz.visualizationComplete": "可视化完成",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ 已生成 ${params?.type ?? ""}：${params?.title ?? ""}`,
  "viz.visualizationFailed": "可视化生成失败",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `可视化生成失败: ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "未生成 HTML",
  "viz.chartGenerationFailed": "图表生成失败",
  "viz.generationFailedNoHtml": "可视化生成失败：未生成 HTML",

  // Response node
  "response.generationComplete": "✓ 回复生成完成",

  // Analysis agent node (additional)
  "analysis.nullValue": "空值",
  "analysis.parallelQueryStarting": "开始并行查询（固定指标 / 动态指标 / ABC）",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `查询完成，共 ${params?.count ?? 0} 条记录`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `开始查询维度：${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `维度 ${params?.name ?? ""} 查询完成`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## 报告生成失败\n\n错误：${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `智能体不存在：${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `智能体 "${params?.agentName ?? ""}" 既未配置维度，也未配置分析维度提示词，无法生成分析计划。`,
  "analysis.noExecutableDimensions": "未生成可执行的分析维度，请调整分析维度提示词或补充维度配置",

  // Data resolver
  "dataResolver.cannotGetData": "无法获取数据，请提供数据或要求使用模拟数据",

  // Default agent
  "service.defaultAgentName": "通用智能体",
  "service.defaultAgentDescription":
    "适用于各类业务场景的通用智能体，能够自动拆解问题维度并生成专业分析报告",
  "api.noFileUploaded": "未上传文件",
  "api.onlyZipSupported": "只支持 .zip 格式的文件",
  "api.testBatchRunning": "测试批次正在运行，请先停止测试",
  "api.threadNoDataDownload": "未找到可下载的数据明细",
  "api.threadNoDslDownload": "未找到可下载的 DSL",
  "api.noReportToExport": "没有可导出的分析报告",

  // Visualization messages
  "viz.noValidConfigJson": "LLM 未返回有效的配置 JSON",
  "viz.missingChartConfig": "LLM 返回的配置缺少必要字段(chartType, title)",
  "viz.missingAxisConfig": "LLM 返回的配置缺少必要字段(xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `饼图/玫瑰图不适合展示超过10条数据（当前 ${params?.count ?? 0} 条），请选择其他图表类型`,
  "viz.generating": (params?: Record<string, any>) => `正在生成 ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "未找到可用的可视化技能",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "缺少查询数据，无法进行分析。请先执行数据查询或使用分析智能体模式。",
  "analysis.matchingMethodology": "正在匹配分析方法论...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "仪表盘不存在或无权限",
  "query.datasetFallbackTitle": (params?: Record<string, any>) => `数据集 ${params?.index ?? 1}`,
  "query.display.empty": "当前没有可展示的数据（可尝试调整筛选条件或稍后再试）",
  "query.display.groupColumn": "分组",
  "query.harness.processHeading": "查询过程",
  "query.harness.dataHeading": "数据结果",
  "query.harness.scopeHeading": "口径说明",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) => `❌ 规划失败: ${params?.error ?? ""}`,
  "report.defaultTitle": "分析报告",

  // Autotest verdict
  "autotest.verdict.correct": "正确",
  "autotest.verdict.wrong": "错误",
  "autotest.verdict.abnormal": "异常",
  "autotest.verdict.reason.cancelled": "已取消",
  "autotest.verdict.reason.execAbnormal": "执行异常",
  "autotest.verdict.reason.execFailed": "执行失败",
  "autotest.verdict.reason.execIncomplete": "执行未完成",
  "autotest.verdict.reason.missingEval": "缺少评测结论",
  "autotest.verdict.reason.evalAbnormal": "评测异常",
  "autotest.verdict.reason.evalWrong": "评测判定为错误",
} satisfies import("../index").TranslationMessages;

export const zhCNLocaleMeta = {
  languageName: '简体中文',
  outputInstruction: '请使用简体中文撰写报告。不要使用其他语言。',
  conclusionPrefix: '📌 结论：',
};
