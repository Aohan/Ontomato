export const de = {
  // Branch labels
  "query.branch.static": "Feste Metrik-Hotdaten",
  "query.branch.hot": "Dynamische Metrik-Hotdaten",
  "query.branch.abc": "ABC-Zerlegung",

  // Status labels
  "query.status.retrieving": "Abrufen",
  "query.status.decomposing": "Zerlegen",
  "query.status.notFound": "Nicht gefunden",
  "query.status.cancelled": "Abgebrochen",
  "query.status.completed": "Abgeschlossen",
  "query.status.notConfigured": "Nicht konfiguriert",
  "query.status.insufficientCoverage": "Unzureichende Abdeckung",
  "query.status.noAvailableData": "Keine verfügbaren Daten abgerufen",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart":
    "🧭 Parallele Ausführung: Feste Metriken / Dynamische Metriken / ABC-Zerlegung…",

  // Thinking logs - static branch
  "query.thinking.staticChecking": "Prüfe feste Metrik-Hotdaten auf Abdeckung dieser Frage…",
  "query.thinking.staticNotFound":
    "Keine festen Metrik-Hotdaten gefunden, warte auf andere Zweige.",
  "query.thinking.staticNotAvailable":
    "Abgerufene Ergebnisse nicht verfügbar, warte auf andere Zweige.",
  "query.thinking.staticKnowledgeSupplement":
    "Ergänze Geschäftswissen-Kontext (zur Verifizierung).",
  "query.thinking.staticKnowledgeFailed":
    "Ergänzung des Geschäftswissens fehlgeschlagen (ignoriert, setze Verifizierung fort).",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} Treffer, überprüfe Abdeckung.`,
  "query.thinking.staticInsufficient": "Unzureichende Abdeckung, warte auf andere Zweige.",
  "query.thinking.staticSufficient":
    "Ausreichende Abdeckung, beginne Detailabruf und Schlussfolgerungen.",
  "query.thinking.staticCardLocated":
    "📊 Feste Metrik-Hotdatenquelle gefunden, zeige Treffer-Karteninhalt:\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching":
    "Suche dynamische Metrik-Hotdaten, um direkt Schlussfolgerungen zu liefern…",
  "query.thinking.hotNotFound":
    "Keine dynamischen Metrik-Hotdaten gefunden, warte auf ABC-Zerlegung.",
  "query.thinking.hotNotAvailable":
    "Abgerufene Ergebnisse nicht verfügbar, warte auf ABC-Zerlegung.",
  "query.thinking.hotKnowledgeSupplement": "Ergänze Geschäftswissen-Kontext (zur Verifizierung).",
  "query.thinking.hotKnowledgeFailed":
    "Ergänzung des Geschäftswissens fehlgeschlagen (ignoriert, setze Verifizierung fort).",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} verwandte Treffer, überprüfe Abdeckung.`,
  "query.thinking.hotInsufficient": "Unzureichende Abdeckung, warte auf ABC-Zerlegung.",
  "query.thinking.hotSufficient":
    "Ausreichende Abdeckung, beginne Detailabruf und Schlussfolgerungen.",
  "query.thinking.hotCardLocated":
    "📊 Dynamische Metrik-Hotdatenquelle gefunden, zeige Treffer-Karteninhalt:\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing": "Zerlege Frage und generiere Abfrageschritte…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `Abfrage abgeschlossen, ${params?.count ?? 0} Datensätze insgesamt`,

  // Query node messages
  "query.node.parallelProgress":
    "Führe Datenabfragen parallel aus (Feste Metriken / Dynamische Metriken / ABC-Zerlegung)...",
  "query.node.noValidResult": "Alle Abfragepfade konnten keine gültigen Ergebnisse liefern",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `Datenabfrage abgeschlossen (via ${params?.branchName ?? ""}), Ergebnisse bereit für weitere Analyse.`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `Datenabfrage abgeschlossen (via ${params?.branchName ?? ""})`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `${params?.count ?? 0} Hotdaten-Elemente gefunden`,
  "query.hotData.noAvailableHotData": "Keine verfügbaren Hotdaten abgerufen",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} Treffer, aber unzureichende Abdeckung (${params?.cards ?? 0} verfügbare Karten)`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} Treffer, ${params?.cards ?? 0} Karten mit ausreichender Abdeckung`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `${params?.hidden ?? 0} weitere Zeilen, zum Erweitern klicken (insgesamt ${params?.total ?? 0} Zeilen)`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">Fazit</strong>: Keine relevanten Datensätze basierend auf den aktuellen Abfragebedingungen gefunden.',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">Fazit</strong>: Datenabfrage abgeschlossen, aber ein Problem bei der Erstellung der Schlussfolgerung ist aufgetreten.',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `Rund um <strong>"${params?.sq ?? ""}"</strong>, Schritt für Schritt A → B → C:`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `Basierend auf den obigen Schritten sind die Datenergebnisse für <strong>"${params?.sq ?? ""}"</strong> wie folgt:`,

  // Subgraph / node labels
  "query.subgraph.label": "Teilgraph",
  "query.nodeTable.none": "Keine",

  // QC result label
  "query.qcResult.label": "QC-Ergebnis",
  "query.qcProcess.label": "QC-Prozess",

  // ABC / query progress
  "query.progress.splitting": "Zerlege Frage...",
  "query.progress.splitDone": (params) =>
    `Zerlegung abgeschlossen, ${params?.n ?? 0} Teilfragen insgesamt`,
  "query.progress.querying": "Frage Daten ab...",
  "query.progress.dataReceived": (params) => `Gruppe ${params?.n ?? 0} Daten empfangen`,
  "query.progress.dataDone": (params) =>
    `Datenabfrage abgeschlossen, ${params?.n ?? 0} Gruppen insgesamt`,
  "query.progress.abcAnalyzing": (params) => `Analysiere Teilfrage ${params?.n ?? 0}`,
  "query.progress.queryingData": (params) => `Frage Gruppe ${params?.n ?? 0} Daten ab`,

  // Status
  "query.status.queryCompleted": "Abfrage abgeschlossen",
  "query.status.queryFailed": "Abfrage fehlgeschlagen",
  "query.status.queryCancelled": "Abfrage abgebrochen",
  "query.error.apiNotConfigured":
    "API nicht konfiguriert, bitte DATA_QUERY_BASE_URL in .env-Datei überprüfen",
  "query.error.noSubQuestions": "Fragenzerlegung fehlgeschlagen, keine Teilfragen generiert",
  "query.error.queryFailed": (params) =>
    `Abfrage fehlgeschlagen: ${params?.error ?? "Unbekannter Fehler"}. Bitte API-Konfiguration prüfen oder andere Frage versuchen.`,
  "query.error.unknownError": "Unbekannter Fehler",
  "query.error.backendFailedWithoutReason":
    "Das Backend hat einen Fehler gemeldet, aber keinen Grund angegeben",
  "query.error.responseNotJson": "Der Antworttext ist kein gültiges JSON",
  "query.error.hotJudgeEmptyReply":
    "Die Antwort des Beurteilungsmodells ist leer. Originalantwort: {preview}",
  "query.error.hotJudgeNotJson":
    "Die Antwort des Beurteilungsmodells lässt sich nicht als JSON lesen. Originalantwort: {preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "isAnswerable in der Antwort des Beurteilungsmodells ist kein boolescher Wert. Originalantwort: {preview}",
  "query.error.hotJudgeNoValidCards":
    "Das Beurteilungsmodell hat die Frage als beantwortbar eingestuft, aber usedCards enthält keine gültige Karte. Originalantwort: {preview}",

  // Success summaries
  "query.summary.success": "Abfrage erfolgreich!",
  "query.summary.subQuestionCount": (params) => `Teilfragen: ${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `Datensätze: ${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `Zeilen insgesamt: ${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `Hauptspalten: ${params?.cols ?? ""}`,
  "query.summary.readyMessage": "Daten sind bereit für Analyse oder Visualisierung.",
  "query.summary.dataChunk": (params) => `Datenblock ${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "Umfassende Zusammenfassung",
  "response.dataTable": (params) => `Datentabelle_${params?.n ?? 1}`,
  "response.queryData": "Daten abfragen",
  "response.analyzeData": "Daten analysieren",
  "response.generateChart": "Diagramm erstellen",
  "response.clarification":
    "Ich verstehe, dass Sie möglicherweise eine der folgenden Fragen stellen:",
  "response.generatingReply": "Erstelle endgültige Antwort...",

  // Analysis agent
  "analysis.noValidData": "Keine gültigen Daten für diese Teilfrage abgerufen",
  "analysis.recordCount": (params) => `Insgesamt ${params?.n ?? 0} Datensätze gefunden`,
  "analysis.structuredTableHint":
    "Strukturierte Tabelle generiert, nützlich zum Vergleichen von Datenunterschieden zwischen Objekten, Kategorien oder Zeitpunkten",
  "analysis.datasetNoData": "Keine gültigen Daten für diesen Datensatz abgerufen",
  "analysis.progress.framework": "Framework erstellen",
  "analysis.progress.collection": "Kennzahlen erfassen",
  "analysis.progress.analysis": "Daten analysieren",
  "analysis.progress.report": "Bericht erstellen",
  "analysis.activity.plan": "Framework-Generierung",
  "analysis.activity.evidence": "Datenerhebung",
  "analysis.activity.skill": "Skill ausführen",
  "analysis.activity.narrative": "Erläuterung des Agenten",
  "analysis.activity.chapter": "Kapitel schreiben",
  "analysis.activity.publish": "Kapitel freigegeben",
  "analysis.activity.chart": "Diagrammerstellung",
  "analysis.activity.dispatch": "Subagent-Einsatz",
  "analysis.activity.probe": "Datenerkundung",
  "analysis.activity.external_tool": "Externer Werkzeugaufruf",
  "analysis.runEnded": "Der Analyselauf ist beendet.",
  "analysis.missingArtifacts": "Der Analyselauf hat keine Darstellungsartefakte zurückgegeben.",
  "analysis.cancelled": "Tiefenanalyse abgebrochen",

  // Checkpointer
  "checkpointer.newConversation": "Neue Konversation",
  "checkpointer.noAccess": "Kein Zugriff auf diese Sitzung",

  // ABC logger
  "abc.idle": "Vorbereiten",
  "abc.split": "Frage verstehen",
  "abc.abcAnalysis": "Analysieren",
  "abc.data": "Daten abfragen",
  "abc.conclusion": "Zusammenfassen",
  "abc.success": "Abgeschlossen",
  "abc.failed": "Fehlgeschlagen",
  "abc.cancelled": "Abgebrochen",
  "abc.exception": (params) => `Ausnahme: ${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `Abgebrochen: ${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `Teilfrage ${params?.n ?? 0}: ${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `Datenergebnis Gruppe ${params?.n ?? 0} empfangen`,
  "abc.dataLogReceivedTotal": (params) =>
    `Datenergebnis Gruppe ${params?.n ?? 0} empfangen (${params?.total ?? 0} insgesamt)`,

  // API route messages
  "api.analysisAgentNotFound": "Agent nicht gefunden",
  "api.dimensionNotFound": "Dimension nicht gefunden",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `Erforderliche Felder fehlen: ${params?.fields ?? ""}`,
  "api.cardNotFound": "Karte nicht gefunden",
  "api.invalidStatusValue": "Ungültiger Statuswert, muss PENDING_REVIEW / PUBLISHED / UNUSED sein",
  "api.businessDescriptionMustBeString": "businessDescription muss ein String sein",
  "api.analysisTaskNotFound": "Analyseaufgabe nicht gefunden",
  "api.noAccessToTask": "Kein Zugriff auf diese Aufgabe",
  "api.taskIsRunning": "Aufgabe läuft",
  "api.taskAlreadyCancelled": "Aufgabe bereits abgebrochen",
  "api.dslCannotBeEmpty": "DSL darf nicht leer sein",
  "api.backendExecutionTimeout": "Backend-Ausführungs-Timeout",
  "api.backendNotConfigured": "Backend nicht konfiguriert (DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "Feedback eingereicht",
  "api.loadConfigFailed": "Konfiguration konnte nicht geladen werden",
  "api.saveConfigFailed": "Konfiguration konnte nicht gespeichert werden",
  "model.roleNotConfigured": "Kein Modell für Rolle '{role}' konfiguriert, bitte in den Modelleinstellungen auswählen",
  "model.role.query": "Abfrage",
  "model.role.coding": "Code & Berechnung",
  "model.role.general": "Allgemein",
  "model.role.diagnosis": "Betriebs-Agent",
  "model.role.knowledgeGovernance": "Knowledge-Governance-Agent",
  "api.modelTestFailed": "Modelltest fehlgeschlagen",
  "api.noAvailableDashboardData":
    "Keine verfügbaren Daten in den aktuellen Analyseergebnissen. Bitte stellen Sie sicher, dass die Abfrageergebnisse Tabellendaten enthalten, bevor Sie es erneut versuchen.",
  "api.dashboardNotFound": "Dashboard nicht gefunden",
  "api.cannotGenerateChartInterpretation":
    "Strukturierte Diagramminterpretation kann derzeit nicht generiert werden",
  "api.checkpointerNotInitialized": "Checkpointer nicht initialisiert",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `Backend-Anfrage fehlgeschlagen: ${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "DSLs dürfen nicht leer sein",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `Abrufen der Bedingungen fehlgeschlagen: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `Ausführung fehlgeschlagen: ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `DSL-Ausführung fehlgeschlagen: ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "Ich kann Ihnen bei Geschäftswissensfragen helfen oder Sie können mir direkt mitteilen, welche Daten Sie abfragen, analysieren oder visualisieren möchten.",
  "reply.defaultErrorMsg":
    "Entschuldigung, ich kann Ihre Anfrage momentan nicht verarbeiten. Bitte versuchen Sie es später erneut.",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `Antworterstellung fehlgeschlagen: ${params?.error ?? ""}`,
  "knowledge.created": "✅ Geschäftswissen wurde generiert:",
  "knowledge.creating": "Geschäftswissen wird generiert…",
  "knowledge.creationFailed":
    "Geschäftswissen konnte nicht generiert werden. Bitte versuchen Sie es später erneut.",

  // Planner node
  "planner.planningExecution": "Plane Ausführungsknoten...",

  // Analysis node
  "skill.keywordMatch": "Schlüsselwort-Übereinstimmung",
  "skill.llmMatch": "LLM-Übereinstimmung",
  "skill.default": "Standard",
  "analysisNode.matchingComputeSkills": "Suche passende Berechnungsanalyse-Fähigkeiten...",
  "analysisNode.skillMatchDone": "✓ Berechnungsfähigkeit gefunden",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `Führe ${params?.skill ?? ""} Berechnung aus...`,
  "analysisNode.computeDone": "✓ Berechnung abgeschlossen",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ ${params?.skill ?? ""} Ausführung fehlgeschlagen: ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ Analysemethode angewendet",
  "analysisNode.generatingAnswer": "Erstelle Analyseantwort...",
  "analysisNode.answerGenerated": "✓ Analyseantwort generiert",
  "analysisNode.analysisComplete": "✓ Analyse abgeschlossen",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ Analyse fehlgeschlagen: ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "Bereite Daten vor",
  "viz.matchingSkills": "Suche passende Fähigkeiten",
  "viz.analyzingData": "Analysiere Daten",
  "viz.generatingChart": "Erstelle Diagramm",
  "viz.preparingVisualization": "Bereite Visualisierung vor",
  "viz.noRenderSkillsAvailable": "Keine Rendering-Fähigkeiten verfügbar",
  "viz.initializationFailed": "Visualisierungsinitialisierung fehlgeschlagen",
  "viz.noRenderSkillsAvailableCheck":
    "Keine visuellen Rendering-Fähigkeiten verfügbar, bitte prüfen, ob Fähigkeiten aktiviert sind",
  "viz.missingData": "Fehlende Daten",
  "viz.dataReady": "Daten bereit",
  "viz.matchingVisSkills": "Suche passende Visualisierungsfähigkeiten",
  "viz.fetchingData": "Rufe Daten ab...",
  "viz.skillMatchComplete": "Fähigkeitsabgleich abgeschlossen",
  "viz.analyzingDataStructure": "Analysiere Datenstruktur",
  "viz.dataAnalysisComplete": "Datenanalyse abgeschlossen",
  "viz.chart": "Diagramm",
  "viz.chartGenerationComplete": "Diagrammerstellung abgeschlossen",
  "viz.visualizationComplete": "Visualisierung abgeschlossen",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ ${params?.type ?? ""} erstellt: ${params?.title ?? ""}`,
  "viz.visualizationFailed": "Visualisierungserstellung fehlgeschlagen",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `Visualisierungserstellung fehlgeschlagen: ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "Kein HTML generiert",
  "viz.chartGenerationFailed": "Diagrammerstellung fehlgeschlagen",
  "viz.generationFailedNoHtml": "Visualisierungserstellung fehlgeschlagen: kein HTML generiert",

  // Response node
  "response.generationComplete": "✓ Antworterstellung abgeschlossen",

  // Analysis agent node (additional)
  "analysis.nullValue": "Nullwert",
  "analysis.parallelQueryStarting":
    "Starte parallele Abfrage (Feste Metriken / Dynamische Metriken / ABC)",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `Abfrage abgeschlossen, ${params?.count ?? 0} Datensätze insgesamt`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `Starte Abfrage für Dimension: ${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `Dimension ${params?.name ?? ""} Abfrage abgeschlossen`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## Berichterstellung fehlgeschlagen\n\nFehler: ${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `Agent nicht gefunden: ${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `Agent "${params?.agentName ?? ""}" hat weder konfigurierte Dimensionen noch einen Analysedimension-Prompt, kann keinen Analyseplan generieren.`,
  "analysis.noExecutableDimensions":
    "Keine ausführbaren Analysedimensionen generiert, bitte passen Sie den Dimensions-Prompt an oder fügen Sie eine Dimensionskonfiguration hinzu",

  // Data resolver
  "dataResolver.cannotGetData":
    "Daten können nicht abgerufen werden, bitte stellen Sie Daten bereit oder fordern Sie Beispieldaten an",

  // Default agent
  "service.defaultAgentName": "Allgemeiner Agent",
  "service.defaultAgentDescription":
    "Ein universeller Agent, geeignet für verschiedene Geschäftsszenarien, der automatisch Fragedimensionen zerlegen und professionelle Analyseberichte erstellen kann",
  "api.noFileUploaded": "Keine Datei hochgeladen",
  "api.onlyZipSupported": "Nur .zip-Dateien werden unterstützt",
  "api.testBatchRunning": "Teststapel läuft, bitte zuerst anhalten",
  "api.threadNoDataDownload": "Keine herunterladbaren Daten gefunden",
  "api.threadNoDslDownload": "Kein herunterladbarer DSL gefunden",
  "api.noReportToExport": "Kein Analysebericht zum Exportieren",

  // Visualization messages
  "viz.noValidConfigJson": "LLM hat kein gültiges Konfigurations-JSON zurückgegeben",
  "viz.missingChartConfig": "LLM-Konfiguration fehlen erforderliche Felder (chartType, title)",
  "viz.missingAxisConfig": "LLM-Konfiguration fehlen erforderliche Felder (xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `Kreis-/Rosendiagramme nicht für mehr als 10 Datenpunkte geeignet (aktuell: ${params?.count ?? 0}), bitte wählen Sie einen anderen Diagrammtyp`,
  "viz.generating": (params?: Record<string, any>) => `Erstelle ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "Keine verfügbaren Visualisierungsfähigkeiten gefunden",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "Keine Daten für die Analyse verfügbar. Bitte führen Sie zuerst eine Datenabfrage aus oder verwenden Sie den Analyseagent-Modus.",
  "analysis.matchingMethodology": "Suche passende Analysemethodik...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "Dashboard nicht gefunden oder keine Berechtigung",
  "query.datasetFallbackTitle": (params?: Record<string, any>) => `Datensatz ${params?.index ?? 1}`,
  "query.display.empty":
    "Derzeit sind keine Daten verfügbar. Passen Sie die Filter an oder versuchen Sie es später erneut.",
  "query.display.groupColumn": "Gruppe",
  "query.harness.processHeading": "Abfrageprozess",
  "query.harness.dataHeading": "Datenergebnisse",
  "query.harness.scopeHeading": "Umfang und Definitionen",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) =>
    `❌ Planung fehlgeschlagen: ${params?.error ?? ""}`,
  "report.defaultTitle": "Analysebericht",

  // Autotest verdict
  "autotest.verdict.correct": "Korrekt",
  "autotest.verdict.wrong": "Falsch",
  "autotest.verdict.abnormal": "Anormal",
  "autotest.verdict.reason.cancelled": "Abgebrochen",
  "autotest.verdict.reason.execAbnormal": "Ausführung anormal",
  "autotest.verdict.reason.execFailed": "Ausführung fehlgeschlagen",
  "autotest.verdict.reason.execIncomplete": "Ausführung unvollständig",
  "autotest.verdict.reason.missingEval": "Fehlende Bewertungsschlussfolgerung",
  "autotest.verdict.reason.evalAbnormal": "Bewertung anormal",
  "autotest.verdict.reason.evalWrong": "Bewertung als falsch eingestuft",
} satisfies import("../index").TranslationMessages;

export const deLocaleMeta = {
  languageName: 'Deutsch',
  outputInstruction: 'WICHTIG: Sie MÜSSEN den gesamten Bericht auf Deutsch verfassen. Schreiben Sie NICHT auf Chinesisch oder in einer anderen Sprache.',
  conclusionPrefix: '📌 Fazit: ',
};
