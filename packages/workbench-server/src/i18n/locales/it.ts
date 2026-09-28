export const it = {
  // Branch labels
  "query.branch.static": "Dati Caldi Metriche Fisse",
  "query.branch.hot": "Dati Caldi Metriche Dinamiche",
  "query.branch.abc": "Scomposizione ABC",

  // Status labels
  "query.status.retrieving": "Recupero",
  "query.status.decomposing": "Scomposizione",
  "query.status.notFound": "Non Trovato",
  "query.status.cancelled": "Annullato",
  "query.status.completed": "Completato",
  "query.status.notConfigured": "Non Configurato",
  "query.status.insufficientCoverage": "Copertura Insufficiente",
  "query.status.noAvailableData": "Nessun Dato Disponibile Recuperato",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart":
    "🧭 Esecuzione in parallelo: Metriche Fisse / Metriche Dinamiche / Scomposizione ABC…",

  // Thinking logs - static branch
  "query.thinking.staticChecking":
    "Verifica se i dati caldi delle metriche fisse coprono questa domanda…",
  "query.thinking.staticNotFound":
    "Nessun dato caldo di metriche fisse trovato, in attesa di altri rami.",
  "query.thinking.staticNotAvailable":
    "Risultati recuperati non disponibili, in attesa di altri rami.",
  "query.thinking.staticKnowledgeSupplement":
    "Integrazione del contesto di conoscenza aziendale (per verifica).",
  "query.thinking.staticKnowledgeFailed":
    "Integrazione conoscenza aziendale fallita (ignorata, verifica in corso).",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} elementi trovati, verifica copertura.`,
  "query.thinking.staticInsufficient": "Copertura insufficiente, in attesa di altri rami.",
  "query.thinking.staticSufficient":
    "Copertura sufficiente, avvio recupero dettagli e generazione conclusioni.",
  "query.thinking.staticCardLocated":
    "📊 Individuata fonte dati caldi metriche fisse, visualizzazione contenuto scheda:\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching":
    "Ricerca dati caldi metriche dinamiche, tentativo di fornire conclusioni direttamente…",
  "query.thinking.hotNotFound":
    "Nessun dato caldo di metriche dinamiche trovato, in attesa della scomposizione ABC.",
  "query.thinking.hotNotAvailable":
    "Risultati recuperati non disponibili, in attesa della scomposizione ABC.",
  "query.thinking.hotKnowledgeSupplement":
    "Integrazione del contesto di conoscenza aziendale (per verifica).",
  "query.thinking.hotKnowledgeFailed":
    "Integrazione conoscenza aziendale fallita (ignorata, verifica in corso).",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} elementi correlati trovati, verifica copertura.`,
  "query.thinking.hotInsufficient": "Copertura insufficiente, in attesa della scomposizione ABC.",
  "query.thinking.hotSufficient":
    "Copertura sufficiente, avvio recupero dettagli e generazione conclusioni.",
  "query.thinking.hotCardLocated":
    "📊 Individuata fonte dati caldi metriche dinamiche, visualizzazione contenuto scheda:\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing":
    "Scomposizione della domanda e generazione dei passaggi di query…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `Query completata, ${params?.count ?? 0} dataset in totale`,

  // Query node messages
  "query.node.parallelProgress":
    "Esecuzione query dati in parallelo (Metriche Fisse / Metriche Dinamiche / Scomposizione ABC)...",
  "query.node.noValidResult": "Tutti i percorsi di query non hanno restituito risultati validi",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `Query dati completata (tramite ${params?.branchName ?? ""}), risultati pronti per ulteriori analisi.`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `Query dati completata (tramite ${params?.branchName ?? ""})`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `Trovati ${params?.count ?? 0} elementi dati caldi`,
  "query.hotData.noAvailableHotData": "Nessun dato caldo disponibile recuperato",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} elementi trovati, ma copertura insufficiente (${params?.cards ?? 0} schede disponibili)`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} elementi trovati, ${params?.cards ?? 0} schede con copertura sufficiente`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `${params?.hidden ?? 0} righe in più, clicca per espandere e visualizzare tutto (${params?.total ?? 0} righe totali)`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">Conclusione</strong>: Nessun record dati pertinente trovato in base alle condizioni di query correnti.',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">Conclusione</strong>: Query dati completata, ma si è verificato un problema nella generazione della conclusione.',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `Intorno a <strong>"${params?.sq ?? ""}"</strong>, seguendo A → B → C passo dopo passo:`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `Sulla base dei passaggi precedenti, i risultati dati per <strong>"${params?.sq ?? ""}"</strong> sono i seguenti:`,

  // Subgraph / node labels
  "query.subgraph.label": "Sottografo",
  "query.nodeTable.none": "Nessuno",

  // QC result label
  "query.qcResult.label": "Risultato QC",
  "query.qcProcess.label": "Processo QC",

  // ABC / query progress
  "query.progress.splitting": "Scomposizione domanda...",
  "query.progress.splitDone": (params) =>
    `Scomposizione completata, ${params?.n ?? 0} sotto-domande in totale`,
  "query.progress.querying": "Interrogazione dati...",
  "query.progress.dataReceived": (params) => `Ricevuti dati gruppo ${params?.n ?? 0}`,
  "query.progress.dataDone": (params) =>
    `Query dati completata, ${params?.n ?? 0} gruppi in totale`,
  "query.progress.abcAnalyzing": (params) => `Analisi sotto-domanda ${params?.n ?? 0}`,
  "query.progress.queryingData": (params) => `Interrogazione dati gruppo ${params?.n ?? 0}`,

  // Status
  "query.status.queryCompleted": "Query Completata",
  "query.status.queryFailed": "Query Fallita",
  "query.status.queryCancelled": "Query Terminata",
  "query.error.apiNotConfigured":
    "API non configurata, verificare DATA_QUERY_BASE_URL nel file .env",
  "query.error.noSubQuestions": "Scomposizione domanda fallita, nessuna sotto-domanda generata",
  "query.error.queryFailed": (params) =>
    `Query fallita: ${params?.error ?? "Errore sconosciuto"}. Verificare la configurazione API o provare un'altra domanda.`,
  "query.error.unknownError": "Errore Sconosciuto",
  "query.error.backendFailedWithoutReason":
    "Il backend ha segnalato un errore senza indicarne il motivo",
  "query.error.responseNotJson": "Il corpo della risposta non è un JSON valido",
  "query.error.hotJudgeEmptyReply":
    "La risposta del modello di giudizio è vuota. Risposta originale: {preview}",
  "query.error.hotJudgeNotJson":
    "La risposta del modello di giudizio non contiene JSON analizzabile. Risposta originale: {preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "isAnswerable nella risposta del modello di giudizio non è un booleano. Risposta originale: {preview}",
  "query.error.hotJudgeNoValidCards":
    "Il modello di giudizio ha indicato che la domanda è rispondibile, ma usedCards non contiene alcuna scheda valida. Risposta originale: {preview}",

  // Success summaries
  "query.summary.success": "Query Riuscita!",
  "query.summary.subQuestionCount": (params) => `Sotto-domande: ${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `Dataset: ${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `Righe Totali: ${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `Colonne Principali: ${params?.cols ?? ""}`,
  "query.summary.readyMessage": "I dati sono pronti per l'analisi o la visualizzazione.",
  "query.summary.dataChunk": (params) => `Blocco Dati ${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "Riepilogo Completo",
  "response.dataTable": (params) => `Tabella Dati_${params?.n ?? 1}`,
  "response.queryData": "Interroga Dati",
  "response.analyzeData": "Analizza Dati",
  "response.generateChart": "Genera Grafico",
  "response.clarification": "Comprendo che potresti chiedere una delle seguenti:",
  "response.generatingReply": "Generazione risposta finale...",

  // Analysis agent
  "analysis.noValidData": "Nessun dato valido recuperato per questa sotto-domanda",
  "analysis.recordCount": (params) => `Trovati ${params?.n ?? 0} record dati in totale`,
  "analysis.structuredTableHint":
    "Tabella strutturata generata, utile per confrontare differenze tra oggetti, categorie o punti temporali",
  "analysis.datasetNoData": "Nessun dato valido recuperato per questo dataset",
  "analysis.progress.framework": "Generazione del framework",
  "analysis.progress.collection": "Raccolta degli indicatori",
  "analysis.progress.analysis": "Analisi dei dati",
  "analysis.progress.report": "Generazione del report",
  "analysis.activity.plan": "Generazione framework",
  "analysis.activity.evidence": "Raccolta di prove",
  "analysis.activity.skill": "Esegui competenza",
  "analysis.activity.narrative": "Narrazione dell'agente",
  "analysis.activity.chapter": "Stesura del capitolo",
  "analysis.activity.publish": "Capitolo pubblicato",
  "analysis.activity.chart": "Generazione grafico",
  "analysis.activity.dispatch": "Invio sub-agente",
  "analysis.activity.probe": "Esplorazione dati",
  "analysis.activity.external_tool": "Chiamata strumento esterno",
  "analysis.runEnded": "L'esecuzione dell'analisi è terminata.",
  "analysis.missingArtifacts":
    "L'esecuzione dell'analisi non ha restituito risultati da presentare.",
  "analysis.cancelled": "Analisi approfondita annullata",

  // Checkpointer
  "checkpointer.newConversation": "Nuova Conversazione",
  "checkpointer.noAccess": "Nessun accesso a questa sessione",

  // ABC logger
  "abc.idle": "Preparazione",
  "abc.split": "Comprensione Domanda",
  "abc.abcAnalysis": "Analisi",
  "abc.data": "Interrogazione Dati",
  "abc.conclusion": "Riepilogo",
  "abc.success": "Completato",
  "abc.failed": "Fallito",
  "abc.cancelled": "Annullato",
  "abc.exception": (params) => `Eccezione: ${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `Annullato: ${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `Sotto-domanda ${params?.n ?? 0}: ${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `Ricevuto risultato dati gruppo ${params?.n ?? 0}`,
  "abc.dataLogReceivedTotal": (params) =>
    `Ricevuto risultato dati gruppo ${params?.n ?? 0} (${params?.total ?? 0} in totale)`,

  // API route messages
  "api.analysisAgentNotFound": "Agente non trovato",
  "api.dimensionNotFound": "Dimensione non trovata",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `Campi obbligatori mancanti: ${params?.fields ?? ""}`,
  "api.cardNotFound": "Scheda non trovata",
  "api.invalidStatusValue":
    "Valore di stato non valido, deve essere PENDING_REVIEW / PUBLISHED / UNUSED",
  "api.businessDescriptionMustBeString": "businessDescription deve essere una stringa",
  "api.analysisTaskNotFound": "Attività di analisi non trovata",
  "api.noAccessToTask": "Nessun accesso a questa attività",
  "api.taskIsRunning": "L'attività è in esecuzione",
  "api.taskAlreadyCancelled": "Attività già annullata",
  "api.dslCannotBeEmpty": "DSL non può essere vuoto",
  "api.backendExecutionTimeout": "Timeout esecuzione backend",
  "api.backendNotConfigured": "Backend non configurato (DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "Feedback inviato",
  "api.loadConfigFailed": "Caricamento configurazione fallito",
  "api.saveConfigFailed": "Salvataggio configurazione fallito",
  "api.modelTestFailed": "Test del modello fallito",
  "api.noAvailableDashboardData":
    "Nessun dato disponibile nei risultati di analisi correnti. Verificare che i risultati della query contengano dati tabellari prima di riprovare.",
  "api.dashboardNotFound": "Dashboard non trovata",
  "api.cannotGenerateChartInterpretation":
    "Impossibile generare un'interpretazione strutturata del grafico al momento",
  "api.checkpointerNotInitialized": "Checkpointer non inizializzato",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `Richiesta backend fallita: ${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "I DSL non possono essere vuoti",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `Recupero condizioni fallito: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `Esecuzione fallita: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `Esecuzione DSL fallita: ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "Posso aiutarti con domande di conoscenza aziendale, oppure puoi dirmi direttamente quali dati vuoi interrogare, analizzare o visualizzare.",
  "reply.defaultErrorMsg":
    "Spiacente, non sono in grado di elaborare la tua richiesta al momento. Per favore riprova più tardi.",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `Generazione risposta fallita: ${params?.error ?? ""}`,
  "knowledge.created": "✅ Conoscenza aziendale generata:",
  "knowledge.creating": "Generazione della conoscenza aziendale in corso…",
  "knowledge.creationFailed":
    "Generazione della conoscenza aziendale non riuscita. Riprova più tardi.",

  // Planner node
  "planner.planningExecution": "Pianificazione nodi di esecuzione...",

  // Analysis node
  "skill.keywordMatch": "Corrispondenza parola chiave",
  "skill.llmMatch": "Corrispondenza LLM",
  "skill.default": "Predefinito",
  "analysisNode.matchingComputeSkills": "Ricerca competenze di calcolo corrispondenti...",
  "analysisNode.skillMatchDone": "✓ Competenza di calcolo individuata",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `Esecuzione calcolo ${params?.skill ?? ""}...`,
  "analysisNode.computeDone": "✓ Calcolo completato",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ Esecuzione ${params?.skill ?? ""} fallita: ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ Metodo di analisi applicato",
  "analysisNode.generatingAnswer": "Generazione risposta analisi...",
  "analysisNode.answerGenerated": "✓ Risposta analisi generata",
  "analysisNode.analysisComplete": "✓ Analisi completata",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ Analisi fallita: ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "Preparazione dati",
  "viz.matchingSkills": "Corrispondenza competenze",
  "viz.analyzingData": "Analisi dati",
  "viz.generatingChart": "Generazione grafico",
  "viz.preparingVisualization": "Preparazione visualizzazione",
  "viz.noRenderSkillsAvailable": "Nessuna competenza di rendering disponibile",
  "viz.initializationFailed": "Inizializzazione visualizzazione fallita",
  "viz.noRenderSkillsAvailableCheck":
    "Nessuna competenza di rendering visivo disponibile, verificare che le competenze siano abilitate",
  "viz.missingData": "Dati mancanti",
  "viz.dataReady": "Dati pronti",
  "viz.matchingVisSkills": "Ricerca competenze di visualizzazione",
  "viz.fetchingData": "Recupero dati...",
  "viz.skillMatchComplete": "Corrispondenza competenze completata",
  "viz.analyzingDataStructure": "Analisi struttura dati",
  "viz.dataAnalysisComplete": "Analisi dati completata",
  "viz.chart": "Grafico",
  "viz.chartGenerationComplete": "Generazione grafico completata",
  "viz.visualizationComplete": "Visualizzazione completata",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ Generato ${params?.type ?? ""}: ${params?.title ?? ""}`,
  "viz.visualizationFailed": "Generazione visualizzazione fallita",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `Generazione visualizzazione fallita: ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "Nessun HTML generato",
  "viz.chartGenerationFailed": "Generazione grafico fallita",
  "viz.generationFailedNoHtml": "Generazione visualizzazione fallita: nessun HTML generato",

  // Response node
  "response.generationComplete": "✓ Generazione risposta completata",

  // Analysis agent node (additional)
  "analysis.nullValue": "Valore nullo",
  "analysis.parallelQueryStarting":
    "Avvio query parallela (Metriche Fisse / Metriche Dinamiche / ABC)",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `Query completata, ${params?.count ?? 0} record in totale`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `Avvio query per dimensione: ${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `Query dimensione ${params?.name ?? ""} completata`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## Generazione report fallita\n\nErrore: ${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `Agente non trovato: ${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `L'agente "${params?.agentName ?? ""}" non ha né dimensioni configurate né un prompt di dimensione analisi, impossibile generare un piano di analisi.`,
  "analysis.noExecutableDimensions":
    "Nessuna dimensione di analisi eseguibile generata, modificare il prompt della dimensione o aggiungere una configurazione dimensione",

  // Data resolver
  "dataResolver.cannotGetData":
    "Impossibile ottenere dati, fornire dati o richiedere dati simulati",

  // Default agent
  "service.defaultAgentName": "Agente Generale",
  "service.defaultAgentDescription":
    "Un agente generico adatto a vari scenari aziendali, in grado di scomporre automaticamente le dimensioni delle domande e generare report di analisi professionali",
  "api.noFileUploaded": "Nessun file caricato",
  "api.onlyZipSupported": "Solo file .zip sono supportati",
  "api.testBatchRunning": "Il batch di test è in esecuzione, fermarlo prima",
  "api.threadNoDataDownload": "Nessun dato scaricabile trovato",
  "api.threadNoDslDownload": "Nessun DSL scaricabile trovato",
  "api.noReportToExport": "Nessun report di analisi da esportare",

  // Visualization messages
  "viz.noValidConfigJson": "LLM non ha restituito un JSON di configurazione valido",
  "viz.missingChartConfig": "Configurazione LLM manca dei campi obbligatori (chartType, title)",
  "viz.missingAxisConfig": "Configurazione LLM manca dei campi obbligatori (xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `I grafici a torta/rosa non sono adatti a più di 10 punti dati (attuali: ${params?.count ?? 0}), scegliere un altro tipo di grafico`,
  "viz.generating": (params?: Record<string, any>) => `Generazione ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "Nessuna competenza di visualizzazione disponibile trovata",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "Nessun dato disponibile per l'analisi. Eseguire prima la query dati o utilizzare la modalità agente di analisi.",
  "analysis.matchingMethodology": "Ricerca metodologia di analisi...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "Dashboard non trovata o nessun permesso",
  "query.datasetFallbackTitle": (params?: Record<string, any>) => `Dataset ${params?.index ?? 1}`,
  "query.display.empty":
    "Al momento non ci sono dati da visualizzare. Modifica i filtri o riprova più tardi.",
  "query.display.groupColumn": "Gruppo",
  "query.harness.processHeading": "Processo di query",
  "query.harness.dataHeading": "Risultati dei dati",
  "query.harness.scopeHeading": "Ambito e definizioni",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) =>
    `❌ Pianificazione fallita: ${params?.error ?? ""}`,
  "report.defaultTitle": "Report di Analisi",

  // Autotest verdict
  "autotest.verdict.correct": "Corretto",
  "autotest.verdict.wrong": "Errato",
  "autotest.verdict.abnormal": "Anomalo",
  "autotest.verdict.reason.cancelled": "Annullato",
  "autotest.verdict.reason.execAbnormal": "Esecuzione anomala",
  "autotest.verdict.reason.execFailed": "Esecuzione fallita",
  "autotest.verdict.reason.execIncomplete": "Esecuzione incompleta",
  "autotest.verdict.reason.missingEval": "Conclusione valutazione mancante",
  "autotest.verdict.reason.evalAbnormal": "Valutazione anomala",
  "autotest.verdict.reason.evalWrong": "Valutazione determinata come errata",
} satisfies import("../index").TranslationMessages;

export const itLocaleMeta = {
  languageName: 'Italiano',
  outputInstruction: "IMPORTANTE: DEVI scrivere l'intero rapporto in italiano. NON scrivere in cinese o in altre lingue.",
  conclusionPrefix: '📌 Conclusione: ',
};
