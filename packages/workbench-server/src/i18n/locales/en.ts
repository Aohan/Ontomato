export const en = {
  // Branch labels
  "query.branch.static": "Fixed Metrics Hot Data",
  "query.branch.hot": "Dynamic Metrics Hot Data",
  "query.branch.abc": "ABC Decomposition",

  // Status labels
  "query.status.retrieving": "Retrieving",
  "query.status.decomposing": "Decomposing",
  "query.status.notFound": "Not Found",
  "query.status.cancelled": "Cancelled",
  "query.status.completed": "Completed",
  "query.status.notConfigured": "Not Configured",
  "query.status.insufficientCoverage": "Insufficient Coverage",
  "query.status.noAvailableData": "No Available Data Retrieved",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart":
    "🧭 Executing in parallel: Fixed Metrics / Dynamic Metrics / ABC Decomposition…",

  // Thinking logs - static branch
  "query.thinking.staticChecking":
    "Checking fixed metrics hot data to see if it covers this question…",
  "query.thinking.staticNotFound": "No fixed metrics hot data found, waiting for other branches.",
  "query.thinking.staticNotAvailable":
    "Retrieved results not available, waiting for other branches.",
  "query.thinking.staticKnowledgeSupplement":
    "Supplementing business knowledge context (for verification).",
  "query.thinking.staticKnowledgeFailed":
    "Business knowledge supplement failed (ignored, continuing verification).",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `Hit ${params?.count ?? 0} items, verifying coverage.`,
  "query.thinking.staticInsufficient": "Insufficient coverage, waiting for other branches.",
  "query.thinking.staticSufficient":
    "Sufficient coverage, starting to fetch details and generate conclusions.",
  "query.thinking.staticCardLocated":
    "📊 Located fixed metrics hot data source, showing hit card content:\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching":
    "Searching dynamic metrics hot data, aiming to provide conclusions directly…",
  "query.thinking.hotNotFound": "No dynamic metrics hot data found, waiting for ABC decomposition.",
  "query.thinking.hotNotAvailable":
    "Retrieved results not available, waiting for ABC decomposition.",
  "query.thinking.hotKnowledgeSupplement":
    "Supplementing business knowledge context (for verification).",
  "query.thinking.hotKnowledgeFailed":
    "Business knowledge supplement failed (ignored, continuing verification).",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `Hit ${params?.count ?? 0} related items, verifying coverage.`,
  "query.thinking.hotInsufficient": "Insufficient coverage, waiting for ABC decomposition.",
  "query.thinking.hotSufficient":
    "Sufficient coverage, starting to fetch details and generate conclusions.",
  "query.thinking.hotCardLocated":
    "📊 Located dynamic metrics hot data source, showing hit card content:\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing": "Decomposing question and generating query steps…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `Query completed, ${params?.count ?? 0} datasets in total`,

  // Query node messages
  "query.node.parallelProgress":
    "Executing data queries in parallel (Fixed Metrics / Dynamic Metrics / ABC Decomposition)...",
  "query.node.noValidResult": "All query paths failed to return valid results",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `Data query completed (via ${params?.branchName ?? ""}), results are ready for further analysis.`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `Data query completed (via ${params?.branchName ?? ""})`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `Found ${params?.count ?? 0} hot data items`,
  "query.hotData.noAvailableHotData": "No available hot data retrieved",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `Hit ${params?.docs ?? 0} items, but insufficient coverage (${params?.cards ?? 0} available cards)`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `Hit ${params?.docs ?? 0} items, ${params?.cards ?? 0} cards with sufficient coverage`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `${params?.hidden ?? 0} more rows, click to expand to view all (${params?.total ?? 0} rows total)`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">Conclusion</strong>: No relevant data records found based on the current query conditions.',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">Conclusion</strong>: Data query completed, but encountered an issue generating the conclusion.',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `Around <strong>"${params?.sq ?? ""}"</strong>, following A → B → C step by step:`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `Based on the steps above, the data results for <strong>"${params?.sq ?? ""}"</strong> are as follows:`,

  // Subgraph / node labels
  "query.subgraph.label": "Subgraph",
  "query.nodeTable.none": "None",

  // QC result label
  "query.qcResult.label": "QC Result",
  "query.qcProcess.label": "QC Process",

  // ABC / query progress
  "query.progress.splitting": "Decomposing question...",
  "query.progress.splitDone": (params) =>
    `Decomposition complete, ${params?.n ?? 0} sub-questions total`,
  "query.progress.querying": "Querying data...",
  "query.progress.dataReceived": (params) => `Received group ${params?.n ?? 0} data`,
  "query.progress.dataDone": (params) => `Data query complete, ${params?.n ?? 0} groups total`,
  "query.progress.abcAnalyzing": (params) => `Analyzing sub-question ${params?.n ?? 0}`,
  "query.progress.queryingData": (params) => `Querying group ${params?.n ?? 0} data`,

  // Status
  "query.status.queryCompleted": "Query Completed",
  "query.status.queryFailed": "Query Failed",
  "query.status.queryCancelled": "Query Terminated",
  "query.error.apiNotConfigured":
    "API not configured, please check DATA_QUERY_BASE_URL in .env file",
  "query.error.noSubQuestions": "Question decomposition failed, no sub-questions generated",
  "query.error.queryFailed": (params) =>
    `Query failed: ${params?.error ?? "Unknown error"}. Please check API configuration or try another question.`,
  "query.error.unknownError": "Unknown Error",
  "query.error.backendFailedWithoutReason":
    "The backend reported a failure but did not give a reason",
  "query.error.responseNotJson": "The response body is not valid JSON",
  "query.error.hotJudgeEmptyReply": "The judge model reply is empty. Raw reply: {preview}",
  "query.error.hotJudgeNotJson":
    "The judge model reply cannot be parsed as JSON. Raw reply: {preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "isAnswerable in the judge model reply is not a boolean. Raw reply: {preview}",
  "query.error.hotJudgeNoValidCards":
    "The judge model marked the question answerable, but usedCards has no valid card. Raw reply: {preview}",

  // Success summaries
  "query.summary.success": "Query Successful!",
  "query.summary.subQuestionCount": (params) => `Sub-questions: ${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `Datasets: ${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `Total Rows: ${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `Main Columns: ${params?.cols ?? ""}`,
  "query.summary.readyMessage": "Data is ready for analysis or visualization.",
  "query.summary.dataChunk": (params) => `Data Chunk ${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "Comprehensive Summary",
  "response.dataTable": (params) => `Data Table_${params?.n ?? 1}`,
  "response.queryData": "Query Data",
  "response.analyzeData": "Analyze Data",
  "response.generateChart": "Generate Chart",
  "response.clarification": "I understand you may be asking one of the following:",
  "response.generatingReply": "Generating final response...",

  // Analysis agent
  "analysis.noValidData": "No valid data retrieved for this sub-question",
  "analysis.recordCount": (params) => `Found ${params?.n ?? 0} data records in total`,
  "analysis.structuredTableHint":
    "Generated structured table, useful for comparing data differences across objects, categories, or time points",
  "analysis.datasetNoData": "No valid data retrieved for this dataset",
  "analysis.progress.framework": "Generating framework",
  "analysis.progress.collection": "Collecting metrics",
  "analysis.progress.analysis": "Analyzing data",
  "analysis.progress.report": "Generating report",
  "analysis.activity.plan": "Framework Generation",
  "analysis.activity.evidence": "Evidence Collection",
  "analysis.activity.skill": "Use skill",
  "analysis.activity.narrative": "Agent Narration",
  "analysis.activity.chapter": "Chapter Writing",
  "analysis.activity.publish": "Chapter Published",
  "analysis.activity.chart": "Chart Generation",
  "analysis.activity.dispatch": "Sub-agent Dispatch",
  "analysis.activity.probe": "Data Probe",
  "analysis.activity.external_tool": "External Tool Call",
  "analysis.runEnded": "The analysis run has ended.",
  "analysis.missingArtifacts": "The analysis run returned no presentation artifacts.",
  "analysis.cancelled": "Deep analysis cancelled",

  // Checkpointer
  "checkpointer.newConversation": "New Conversation",
  "checkpointer.noAccess": "No access to this session",

  // ABC logger
  "abc.idle": "Preparing",
  "abc.split": "Understanding Question",
  "abc.abcAnalysis": "Analyzing",
  "abc.data": "Querying Data",
  "abc.conclusion": "Summarizing",
  "abc.success": "Completed",
  "abc.failed": "Failed",
  "abc.cancelled": "Cancelled",
  "abc.exception": (params) => `Exception: ${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `Cancelled: ${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `Sub-question ${params?.n ?? 0}: ${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `Received group ${params?.n ?? 0} data result`,
  "abc.dataLogReceivedTotal": (params) =>
    `Received group ${params?.n ?? 0} data result (${params?.total ?? 0} total)`,

  // API route messages
  "api.analysisAgentNotFound": "Agent not found",
  "api.dimensionNotFound": "Dimension not found",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `Missing required fields: ${params?.fields ?? ""}`,
  "api.cardNotFound": "Card not found",
  "api.invalidStatusValue": "Invalid status value, must be PENDING_REVIEW / PUBLISHED / UNUSED",
  "api.businessDescriptionMustBeString": "businessDescription must be a string",
  "api.analysisTaskNotFound": "Analysis task not found",
  "api.noAccessToTask": "No access to this task",
  "api.taskIsRunning": "Task is running",
  "api.taskAlreadyCancelled": "Task already cancelled",
  "api.dslCannotBeEmpty": "DSL cannot be empty",
  "api.backendExecutionTimeout": "Backend execution timeout",
  "api.backendNotConfigured": "Backend not configured (DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "Feedback submitted",
  "api.loadConfigFailed": "Failed to load configuration",
  "api.saveConfigFailed": "Failed to save configuration",
  "api.modelTestFailed": "Model test failed",
  "model.roleNotConfigured": "No model configured for role '{role}', please configure it in model settings",
  "model.role.query": "Query",
  "model.role.coding": "Coding and Computing",
  "model.role.general": "General",
  "model.role.diagnosis": "Operations Agent",
  "model.role.knowledgeGovernance": "Knowledge Governance Agent",
  "api.noAvailableDashboardData":
    "No available data in current analysis results. Please verify that the query results contain table data before retrying.",
  "api.dashboardNotFound": "Dashboard not found",
  "api.cannotGenerateChartInterpretation":
    "Unable to generate structured chart interpretation at this time",
  "api.checkpointerNotInitialized": "Checkpointer not initialized",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `Backend request failed: ${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "DSLs cannot be empty",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `Failed to get conditions: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `Execution failed: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `DSL execution failed: ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "I can help you with business knowledge questions, or you can directly tell me what data you want to query, analyze, or visualize.",
  "reply.defaultErrorMsg":
    "Sorry, I am unable to process your request at this moment. Please try again later.",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `Reply generation failed: ${params?.error ?? ""}`,
  "knowledge.created": "✅ Business knowledge generated:",
  "knowledge.creating": "Generating business knowledge…",
  "knowledge.creationFailed": "Failed to generate business knowledge. Please try again later.",

  // Planner node
  "planner.planningExecution": "Planning execution nodes...",

  // Analysis node
  "skill.keywordMatch": "Keyword match",
  "skill.llmMatch": "LLM match",
  "skill.default": "Default",
  "analysisNode.matchingComputeSkills": "Matching compute analysis skills...",
  "analysisNode.skillMatchDone": "✓ Matched compute skill",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `Executing ${params?.skill ?? ""} computation...`,
  "analysisNode.computeDone": "✓ Computation done",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ ${params?.skill ?? ""} execution failed: ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ Applied analysis method",
  "analysisNode.generatingAnswer": "Generating analysis answer...",
  "analysisNode.answerGenerated": "✓ Analysis answer generated",
  "analysisNode.analysisComplete": "✓ Analysis complete",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ Analysis failed: ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "Preparing data",
  "viz.matchingSkills": "Matching skills",
  "viz.analyzingData": "Analyzing data",
  "viz.generatingChart": "Generating chart",
  "viz.preparingVisualization": "Preparing visualization",
  "viz.noRenderSkillsAvailable": "No render skills available",
  "viz.initializationFailed": "Visualization initialization failed",
  "viz.noRenderSkillsAvailableCheck":
    "No visual rendering skills available, please check if skills are enabled",
  "viz.missingData": "Missing data",
  "viz.noDataChartTitle": "No chart generated",
  "viz.noDataChartMessage": "The query returned no rows for the selected conditions.",
  "viz.dataReady": "Data ready",
  "viz.matchingVisSkills": "Matching visualization skills",
  "viz.fetchingData": "Fetching data...",
  "viz.skillMatchComplete": "Skill match complete",
  "viz.analyzingDataStructure": "Analyzing data structure",
  "viz.dataAnalysisComplete": "Data analysis complete",
  "viz.chart": "Chart",
  "viz.chartGenerationComplete": "Chart generation complete",
  "viz.visualizationComplete": "Visualization complete",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ Generated ${params?.type ?? ""}: ${params?.title ?? ""}`,
  "viz.visualizationFailed": "Visualization generation failed",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `Visualization generation failed: ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "No HTML generated",
  "viz.chartGenerationFailed": "Chart generation failed",
  "viz.generationFailedNoHtml": "Visualization generation failed: no HTML generated",

  // Response node
  "response.generationComplete": "✓ Reply generation complete",

  // Analysis agent node (additional)
  "analysis.nullValue": "Null value",
  "analysis.parallelQueryStarting":
    "Starting parallel query (Fixed Metrics / Dynamic Metrics / ABC)",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `Query complete, ${params?.count ?? 0} records total`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `Starting query for dimension: ${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `Dimension ${params?.name ?? ""} query completed`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## Report generation failed\n\nError: ${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `Agent not found: ${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `Agent "${params?.agentName ?? ""}" has neither configured dimensions nor an analysis dimension prompt, unable to generate an analysis plan.`,
  "analysis.noExecutableDimensions":
    "No executable analysis dimensions generated, please adjust the dimension prompt or add dimension configuration",

  // Data resolver
  "dataResolver.cannotGetData": "Unable to get data, please provide data or request mock data",

  // Default agent
  "service.defaultAgentName": "General Agent",
  "service.defaultAgentDescription":
    "A general-purpose agent suitable for various business scenarios, capable of automatically decomposing question dimensions and generating professional analysis reports",
  "api.noFileUploaded": "No file uploaded",
  "api.onlyZipSupported": "Only .zip files are supported",
  "api.testBatchRunning": "Test batch is running, please stop it first",
  "api.threadNoDataDownload": "No downloadable data found",
  "api.threadNoDslDownload": "No downloadable DSL found",
  "api.noReportToExport": "No analysis report to export",

  // Visualization messages
  "viz.noValidConfigJson": "LLM did not return valid config JSON",
  "viz.missingChartConfig": "LLM config missing required fields (chartType, title)",
  "viz.missingAxisConfig": "LLM config missing required fields (xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `Pie/rose charts not suitable for more than 10 data points (current: ${params?.count ?? 0}), please choose another chart type`,
  "viz.generating": (params?: Record<string, any>) => `Generating ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "No available visualization skills found",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "No data available for analysis. Please execute data query first or use analysis agent mode.",
  "analysis.matchingMethodology": "Matching analysis methodology...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "Dashboard not found or no permission",
  "query.datasetFallbackTitle": (params?: Record<string, any>) => `Dataset ${params?.index ?? 1}`,
  "query.display.empty":
    "There is currently no data to display. Try adjusting the filters or retry later.",
  "query.display.groupColumn": "Group",
  "query.harness.processHeading": "Query process",
  "query.harness.dataHeading": "Data results",
  "query.harness.scopeHeading": "Scope and definitions",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) => `❌ Planning failed: ${params?.error ?? ""}`,
  "report.defaultTitle": "Analysis Report",

  // Autotest verdict
  "autotest.verdict.correct": "Correct",
  "autotest.verdict.wrong": "Wrong",
  "autotest.verdict.abnormal": "Abnormal",
  "autotest.verdict.reason.cancelled": "Cancelled",
  "autotest.verdict.reason.execAbnormal": "Execution abnormal",
  "autotest.verdict.reason.execFailed": "Execution failed",
  "autotest.verdict.reason.execIncomplete": "Execution incomplete",
  "autotest.verdict.reason.missingEval": "Missing evaluation conclusion",
  "autotest.verdict.reason.evalAbnormal": "Evaluation abnormal",
  "autotest.verdict.reason.evalWrong": "Evaluation determined as wrong",
} satisfies import("../index").TranslationMessages;

export const enLocaleMeta = {
  languageName: "English",
  outputInstruction:
    "IMPORTANT: You MUST write the entire report in English. Do NOT write in Chinese or any other language.",
  conclusionPrefix: "📌 Conclusion: ",
};
