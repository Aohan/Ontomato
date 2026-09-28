export const zhTW = {
  // Branch labels
  "query.branch.static": "固定指標熱數據",
  "query.branch.hot": "動態指標熱數據",
  "query.branch.abc": "ABC 拆解",

  // Status labels
  "query.status.retrieving": "檢索中",
  "query.status.decomposing": "拆解中",
  "query.status.notFound": "未命中",
  "query.status.cancelled": "已取消",
  "query.status.completed": "完成",
  "query.status.notConfigured": "未配置",
  "query.status.insufficientCoverage": "覆蓋不足",
  "query.status.noAvailableData": "未召回到可用數據",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart": "🧭 正在並行執行：固定指標熱數據 / 動態指標熱數據 / ABC 拆解…",

  // Thinking logs - static branch
  "query.thinking.staticChecking": "檢查固定指標熱數據，看看是否已覆蓋该問題…",
  "query.thinking.staticNotFound": "未命中固定指標熱數據，繼續等待其他分支。",
  "query.thinking.staticNotAvailable": "召回結果不可用，繼續等待其他分支。",
  "query.thinking.staticKnowledgeSupplement": "補充業務知識上下文（用於核驗）。",
  "query.thinking.staticKnowledgeFailed": "業務知識補充失败（忽略，繼續核驗）。",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `命中 ${params?.count ?? 0} 條內容，正在核驗覆蓋度。`,
  "query.thinking.staticInsufficient": "覆蓋不足，繼續等待其他分支。",
  "query.thinking.staticSufficient": "覆蓋充分，開始拉取明細並生成結論。",
  "query.thinking.staticCardLocated": "📊 已定位到固定指標熱數據来源，展示命中卡片內容：\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching": "檢索動態指標熱數據，爭取直接給出結論…",
  "query.thinking.hotNotFound": "未命中動態指標熱數據，繼續等待 ABC 拆解。",
  "query.thinking.hotNotAvailable": "召回結果不可用，繼續等待 ABC 拆解。",
  "query.thinking.hotKnowledgeSupplement": "補充業務知識上下文（用於核驗）。",
  "query.thinking.hotKnowledgeFailed": "業務知識補充失败（忽略，繼續核驗）。",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `命中 ${params?.count ?? 0} 條相關內容，正在核驗覆蓋度。`,
  "query.thinking.hotInsufficient": "覆蓋不足，繼續等待 ABC 拆解。",
  "query.thinking.hotSufficient": "覆蓋充分，開始拉取明細並生成結論。",
  "query.thinking.hotCardLocated": "📊 已定位到動態指標熱數據来源，展示命中卡片內容：\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing": "正在拆解問題並生成查詢步骤…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `查詢完成，共 ${params?.count ?? 0} 個數據集`,

  // Query node messages
  "query.node.parallelProgress":
    "正在並行執行數據查詢（固定指標熱數據 / 動態指標熱數據 / ABC 拆解）...",
  "query.node.noValidResult": "所有查詢路徑均未能返回有效結果",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `數據查詢已完成（通過${params?.branchName ?? ""}），結果已準備好用於後續分析。`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `已完成數據查詢（通過${params?.branchName ?? ""}）`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `檢索到 ${params?.count ?? 0} 條熱數據`,
  "query.hotData.noAvailableHotData": "未召回到可用熱數據",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `命中 ${params?.docs ?? 0} 條，但覆蓋不足（${params?.cards ?? 0} 张可用卡片）`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `命中 ${params?.docs ?? 0} 條，${params?.cards ?? 0} 张卡片覆蓋充分`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `还有 ${params?.hidden ?? 0} 行，點击展開查看全部（共 ${params?.total ?? 0} 行）`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">結論</strong>：根據當前查詢條件，未檢索到相關數據記錄。',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">結論</strong>：數據查詢完成，但生成結論時遇到問題。',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `围繞<strong>「${params?.sq ?? ""}」</strong>，按 A → B → C 逐步說明：`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `依據上述步骤，<strong>「${params?.sq ?? ""}」</strong>的數據結果如下：`,

  // Subgraph / node labels
  "query.subgraph.label": "子圖",
  "query.nodeTable.none": "無",

  // QC result label
  "query.qcResult.label": "質檢結果",
  "query.qcProcess.label": "質檢過程",

  // ABC / query progress
  "query.progress.splitting": "正在拆解問題...",
  "query.progress.splitDone": (params) => `拆解完成，共 ${params?.n ?? 0} 個子問題`,
  "query.progress.querying": "正在查詢數據...",
  "query.progress.dataReceived": (params) => `收到第 ${params?.n ?? 0} 組數據`,
  "query.progress.dataDone": (params) => `數據查詢完成，共 ${params?.n ?? 0} 組`,
  "query.progress.abcAnalyzing": (params) => `分析第 ${params?.n ?? 0} 個子問題`,
  "query.progress.queryingData": (params) => `查詢第 ${params?.n ?? 0} 組數據`,

  // Status
  "query.status.queryCompleted": "查詢完成",
  "query.status.queryFailed": "查詢失败",
  "query.status.queryCancelled": "查詢被終止",
  "query.error.apiNotConfigured": "API 未配置，請檢查 .env 文件中的 DATA_QUERY_BASE_URL",
  "query.error.noSubQuestions": "問題拆分失败，未生成任何子問題",
  "query.error.queryFailed": (params) =>
    `查詢失败：${params?.error ?? "未知錯誤"}。請檢查 API 配置或嘗試其他問題。`,
  "query.error.unknownError": "未知錯誤",
  "query.error.backendFailedWithoutReason": "後端返回失敗但未給出原因",
  "query.error.responseNotJson": "返回體不是合法 JSON",
  "query.error.hotJudgeEmptyReply": "判定模型回覆為空。原始回覆：{preview}",
  "query.error.hotJudgeNotJson": "判定模型回覆解析不出 JSON。原始回覆：{preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "判定模型回覆的 isAnswerable 不是布林值。原始回覆：{preview}",
  "query.error.hotJudgeNoValidCards":
    "判定模型判定可回答，但 usedCards 裡沒有有效卡片。原始回覆：{preview}",

  // Success summaries
  "query.summary.success": "查詢成功！",
  "query.summary.subQuestionCount": (params) => `子問題數量：${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `數據集數量：${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `總數據行數：${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `主要列：${params?.cols ?? ""}`,
  "query.summary.readyMessage": "數據已準備好，可进行分析或可視優化。",
  "query.summary.dataChunk": (params) => `數據片段${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "綜合總結",
  "response.dataTable": (params) => `數據錶_${params?.n ?? 1}`,
  "response.queryData": "查詢數據",
  "response.analyzeData": "分析數據",
  "response.generateChart": "生成圖錶",
  "response.clarification": "我理解你可能想問的是以下哪一种：",
  "response.generatingReply": "正在生成最終回複...",

  // Analysis agent
  "analysis.noValidData": "本子問題未查詢到有效數據",
  "analysis.recordCount": (params) => `共查詢到 ${params?.n ?? 0} 條數據記錄`,
  "analysis.structuredTableHint": "已生成結構優化錶格，可用於對比不同對象、類別或時間點的數據差異",
  "analysis.datasetNoData": "本數據集未查詢到有效數據",
  "analysis.progress.framework": "產生框架",
  "analysis.progress.collection": "採集指標",
  "analysis.progress.analysis": "資料分析",
  "analysis.progress.report": "產生報告",
  "analysis.activity.plan": "框架產生",
  "analysis.activity.evidence": "證據採集",
  "analysis.activity.skill": "執行技能",
  "analysis.activity.narrative": "智能體敘述",
  "analysis.activity.chapter": "撰寫章節",
  "analysis.activity.publish": "章節定稿",
  "analysis.activity.chart": "產生圖表",
  "analysis.activity.dispatch": "派遣子智能體",
  "analysis.activity.probe": "資料探測",
  "analysis.activity.external_tool": "呼叫外部工具",
  "analysis.runEnded": "分析執行已結束",
  "analysis.missingArtifacts": "分析執行未傳回呈現產物",
  "analysis.cancelled": "深度分析已取消",

  // Checkpointer
  "checkpointer.newConversation": "新對話",
  "checkpointer.noAccess": "無權訪問该會話",

  // ABC logger
  "abc.idle": "準備中",
  "abc.split": "理解問題",
  "abc.abcAnalysis": "分析中",
  "abc.data": "查詢數據",
  "abc.conclusion": "總結結論",
  "abc.success": "完成",
  "abc.failed": "失败",
  "abc.cancelled": "已取消",
  "abc.exception": (params) => `異常：${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `已取消：${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `子問題 ${params?.n ?? 0}：${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `收到第 ${params?.n ?? 0} 組數據結果`,
  "abc.dataLogReceivedTotal": (params) =>
    `收到第 ${params?.n ?? 0} 組數據結果（共 ${params?.total ?? 0} 組）`,

  // API route messages
  "api.analysisAgentNotFound": "智慧代理不存在",
  "api.dimensionNotFound": "維度不存在",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `缺少必填字段：${params?.fields ?? ""}`,
  "api.cardNotFound": "卡片不存在",
  "api.invalidStatusValue": "無效的狀態值，必須為 PENDING_REVIEW / PUBLISHED / UNUSED",
  "api.businessDescriptionMustBeString": "businessDescription 必須是字符串",
  "api.analysisTaskNotFound": "分析任務不存在",
  "api.noAccessToTask": "無權訪問该任務",
  "api.taskIsRunning": "任務正在執行中",
  "api.taskAlreadyCancelled": "任務已取消",
  "api.dslCannotBeEmpty": "DSL 不能為空",
  "api.backendExecutionTimeout": "後端執行超時",
  "api.backendNotConfigured": "未配置後端地址(DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "反饋已提交",
  "api.loadConfigFailed": "獲取配置失败",
  "api.saveConfigFailed": "保存配置失败",
  "api.modelTestFailed": "模型測試失败",
  "api.noAvailableDashboardData":
    "當前分析結果暂無可用數據。請先確認查詢結果中有錶格數據後再重試。",
  "api.dashboardNotFound": "儀錶盤不存在",
  "api.cannotGenerateChartInterpretation": "暂時無法生成結構優化圖錶解讀",
  "api.checkpointerNotInitialized": "Checkpointer 未初始優化",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `請求後端失败：${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "dsls 不能為空",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `獲取條件失败：${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `執行失败：${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `DSL 執行失败: ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "我可以幫助你回答業務知識問題，或者你也可以直接告訴我想查詢、分析或可視優化什么數據。",
  "reply.defaultErrorMsg": "抱歉，我暂時無法处理你的請求，請稍後再試。",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `回複生成失败: ${params?.error ?? ""}`,
  "knowledge.created": "✅ 已生成業務知識：",
  "knowledge.creating": "正在生成業務知識…",
  "knowledge.creationFailed": "業務知識生成失败，請稍後再試。",

  // Planner node
  "planner.planningExecution": "正在規劃執行節點...",

  // Analysis node
  "skill.keywordMatch": "關鍵词匹配",
  "skill.llmMatch": "LLM匹配",
  "skill.default": "默認",
  "analysisNode.matchingComputeSkills": "正在匹配計算型分析技能...",
  "analysisNode.skillMatchDone": "✓ 匹配計算型技能",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `正在執行 ${params?.skill ?? ""} 計算...`,
  "analysisNode.computeDone": "✓ 執行計算",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ ${params?.skill ?? ""} 執行失败: ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ 应用分析方法",
  "analysisNode.generatingAnswer": "正在生成分析回答...",
  "analysisNode.answerGenerated": "✓ 生成分析回答",
  "analysisNode.analysisComplete": "✓ 數據分析完成",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ 分析失败: ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "準備數據",
  "viz.matchingSkills": "匹配技能",
  "viz.analyzingData": "分析數據",
  "viz.generatingChart": "生成圖錶",
  "viz.preparingVisualization": "正在準備可視優化",
  "viz.noRenderSkillsAvailable": "没有可用的渲染技能",
  "viz.initializationFailed": "可視優化初始優化失败",
  "viz.noRenderSkillsAvailableCheck": "没有可用的可視優化渲染技能，請檢查技能是否啟用",
  "viz.missingData": "缺少數據",
  "viz.dataReady": "數據準備完成",
  "viz.matchingVisSkills": "正在匹配可視優化技能",
  "viz.fetchingData": "正在獲取數據...",
  "viz.skillMatchComplete": "技能匹配完成",
  "viz.analyzingDataStructure": "正在分析數據結構",
  "viz.dataAnalysisComplete": "數據分析完成",
  "viz.chart": "圖錶",
  "viz.chartGenerationComplete": "圖錶生成完成",
  "viz.visualizationComplete": "可視優化完成",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ 已生成 ${params?.type ?? ""}：${params?.title ?? ""}`,
  "viz.visualizationFailed": "可視優化生成失败",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `可視優化生成失败: ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "未生成 HTML",
  "viz.chartGenerationFailed": "圖錶生成失败",
  "viz.generationFailedNoHtml": "可視優化生成失败：未生成 HTML",

  // Response node
  "response.generationComplete": "✓ 回複生成完成",

  // Analysis agent node (additional)
  "analysis.nullValue": "空值",
  "analysis.parallelQueryStarting": "開始並行查詢（固定指標 / 動態指標 / ABC）",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `查詢完成，共 ${params?.count ?? 0} 條記錄`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `開始查詢維度：${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `維度 ${params?.name ?? ""} 查詢完成`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## 報告生成失败\n\n錯誤：${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `智慧代理不存在：${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `智慧代理 "${params?.agentName ?? ""}" 既未配置維度，也未配置分析維度提示词，無法生成分析計劃。`,
  "analysis.noExecutableDimensions": "未生成可執行的分析維度，請調整分析維度提示词或补充維度配置",

  // Data resolver
  "dataResolver.cannotGetData": "無法獲取數據，請提供數據或要求使用模拟數據",

  // Default agent
  "service.defaultAgentName": "通用智慧代理",
  "service.defaultAgentDescription":
    "適用於各類業務場景的通用智慧代理，能够自動拆解問題維度並生成專業分析報告",
  "api.noFileUploaded": "未上傳文件",
  "api.onlyZipSupported": "只支持 .zip 格式的文件",
  "api.testBatchRunning": "測試批次正在运行，請先停止測試",
  "api.threadNoDataDownload": "未找到可下载的數據明細",
  "api.threadNoDslDownload": "未找到可下载的 DSL",
  "api.noReportToExport": "没有可導入出的分析報告",

  // Visualization messages
  "viz.noValidConfigJson": "LLM 未返回有效的配置 JSON",
  "viz.missingChartConfig": "LLM 返回的配置缺少必要字段(chartType, title)",
  "viz.missingAxisConfig": "LLM 返回的配置缺少必要字段(xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `饼圖/玫瑰圖不适合展示超過10條數據（當前 ${params?.count ?? 0} 條），請選擇其他圖錶類型`,
  "viz.generating": (params?: Record<string, any>) => `正在生成 ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "未找到可用的可視優化技能",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "缺少查詢數據，無法进行分析。請先執行數據查詢或使用分析智能體模式。",
  "analysis.matchingMethodology": "正在匹配分析方法論...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "儀錶盤不存在或無權限",
  "query.datasetFallbackTitle": (params?: Record<string, any>) => `數據集 ${params?.index ?? 1}`,
  "query.display.empty": "目前沒有可展示的數據（可嘗試調整篩選條件或稍後再試）",
  "query.display.groupColumn": "分組",
  "query.harness.processHeading": "查詢過程",
  "query.harness.dataHeading": "數據結果",
  "query.harness.scopeHeading": "口徑說明",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) => `❌ 規劃失败: ${params?.error ?? ""}`,
  "report.defaultTitle": "分析報告",

  // Autotest verdict
  "autotest.verdict.correct": "正確",
  "autotest.verdict.wrong": "錯誤",
  "autotest.verdict.abnormal": "異常",
  "autotest.verdict.reason.cancelled": "已取消",
  "autotest.verdict.reason.execAbnormal": "執行異常",
  "autotest.verdict.reason.execFailed": "執行失败",
  "autotest.verdict.reason.execIncomplete": "執行未完成",
  "autotest.verdict.reason.missingEval": "缺少評測結論",
  "autotest.verdict.reason.evalAbnormal": "評測異常",
  "autotest.verdict.reason.evalWrong": "評測判定為錯誤",
} satisfies import("../index").TranslationMessages;

export const zhTWLocaleMeta = {
  languageName: '繁體中文',
  outputInstruction: '請使用繁體中文撰寫報告。不要使用其他語言。',
  conclusionPrefix: '📌 結論：',
};
