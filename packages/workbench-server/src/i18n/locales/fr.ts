export const fr = {
  // Branch labels
  "query.branch.static": "Données Chaudes de Métriques Fixes",
  "query.branch.hot": "Données Chaudes de Métriques Dynamiques",
  "query.branch.abc": "Décomposition ABC",

  // Status labels
  "query.status.retrieving": "Récupération",
  "query.status.decomposing": "Décomposition",
  "query.status.notFound": "Non Trouvé",
  "query.status.cancelled": "Annulé",
  "query.status.completed": "Terminé",
  "query.status.notConfigured": "Non Configuré",
  "query.status.insufficientCoverage": "Couverture Insuffisante",
  "query.status.noAvailableData": "Aucune Donnée Disponible Récupérée",

  // Thinking logs - parallel execution
  "query.thinking.parallelStart":
    "🧭 Exécution en parallèle : Métriques Fixes / Métriques Dynamiques / Décomposition ABC…",

  // Thinking logs - static branch
  "query.thinking.staticChecking":
    "Vérification des données chaudes de métriques fixes pour voir si elles couvrent cette question…",
  "query.thinking.staticNotFound":
    "Aucune donnée chaude de métriques fixes trouvée, en attente des autres branches.",
  "query.thinking.staticNotAvailable":
    "Résultats récupérés non disponibles, en attente des autres branches.",
  "query.thinking.staticKnowledgeSupplement":
    "Ajout du contexte de connaissances métier (pour vérification).",
  "query.thinking.staticKnowledgeFailed":
    "Échec de l'ajout de connaissances métier (ignoré, poursuite de la vérification).",
  "query.thinking.staticHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} éléments trouvés, vérification de la couverture.`,
  "query.thinking.staticInsufficient": "Couverture insuffisante, en attente des autres branches.",
  "query.thinking.staticSufficient":
    "Couverture suffisante, début de la récupération des détails et de la génération des conclusions.",
  "query.thinking.staticCardLocated":
    "📊 Source de données chaudes de métriques fixes localisée, affichage du contenu de la carte :\n\n",

  // Thinking logs - hot branch
  "query.thinking.hotSearching":
    "Recherche de données chaudes de métriques dynamiques, visant à fournir des conclusions directement…",
  "query.thinking.hotNotFound":
    "Aucune donnée chaude de métriques dynamiques trouvée, en attente de la décomposition ABC.",
  "query.thinking.hotNotAvailable":
    "Résultats récupérés non disponibles, en attente de la décomposition ABC.",
  "query.thinking.hotKnowledgeSupplement":
    "Ajout du contexte de connaissances métier (pour vérification).",
  "query.thinking.hotKnowledgeFailed":
    "Échec de l'ajout de connaissances métier (ignoré, poursuite de la vérification).",
  "query.thinking.hotHitVerifying": (params?: Record<string, any>) =>
    `${params?.count ?? 0} éléments connexes trouvés, vérification de la couverture.`,
  "query.thinking.hotInsufficient": "Couverture insuffisante, en attente de la décomposition ABC.",
  "query.thinking.hotSufficient":
    "Couverture suffisante, début de la récupération des détails et de la génération des conclusions.",
  "query.thinking.hotCardLocated":
    "📊 Source de données chaudes de métriques dynamiques localisée, affichage du contenu de la carte :\n\n",

  // Thinking logs - abc branch
  "query.thinking.abcDecomposing":
    "Décomposition de la question et génération des étapes de requête…",
  "query.thinking.abcCompleted": (params?: Record<string, any>) =>
    `Requête terminée, ${params?.count ?? 0} ensembles de données au total`,

  // Query node messages
  "query.node.parallelProgress":
    "Exécution des requêtes de données en parallèle (Métriques Fixes / Métriques Dynamiques / Décomposition ABC)...",
  "query.node.noValidResult": "Tous les chemins de requête n'ont pas renvoyé de résultats valides",
  "query.node.completedViaBranch": (params?: Record<string, any>) =>
    `Requête de données terminée (via ${params?.branchName ?? ""}), les résultats sont prêts pour une analyse approfondie.`,
  "query.node.thinkingSummary": (params?: Record<string, any>) =>
    `Requête de données terminée (via ${params?.branchName ?? ""})`,

  // Hot data utils messages
  "query.hotData.foundCount": (params?: Record<string, any>) =>
    `${params?.count ?? 0} éléments de données chaudes trouvés`,
  "query.hotData.noAvailableHotData": "Aucune donnée chaude disponible récupérée",
  "query.hotData.insufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} éléments trouvés, mais couverture insuffisante (${params?.cards ?? 0} cartes disponibles)`,
  "query.hotData.sufficientCoverage": (params?: Record<string, any>) =>
    `${params?.docs ?? 0} éléments trouvés, ${params?.cards ?? 0} cartes avec une couverture suffisante`,
  "query.hotData.tableFoldSummary": (params?: Record<string, any>) =>
    `${params?.hidden ?? 0} lignes supplémentaires, cliquez pour tout afficher (${params?.total ?? 0} lignes au total)`,

  // Conclusion messages
  "query.conclusion.noDataFound":
    '📌 <strong class="ai-conclusion">Conclusion</strong> : Aucun enregistrement de données pertinent trouvé selon les conditions de requête actuelles.',
  "query.conclusion.errorFallback":
    '📌 <strong class="ai-conclusion">Conclusion</strong> : Requête de données terminée, mais un problème est survenu lors de la génération de la conclusion.',

  // ABC analysis transitions
  "query.abc.transition.analysis": (params?: Record<string, any>) =>
    `Autour de <strong>"${params?.sq ?? ""}"</strong>, en suivant A → B → C étape par étape :`,
  "query.abc.transition.result": (params?: Record<string, any>) =>
    `Sur la base des étapes ci-dessus, les résultats de données pour <strong>"${params?.sq ?? ""}"</strong> sont les suivants :`,

  // Subgraph / node labels
  "query.subgraph.label": "Sous-graphe",
  "query.nodeTable.none": "Aucun",

  // QC result label
  "query.qcResult.label": "Résultat CQ",
  "query.qcProcess.label": "Processus CQ",

  // ABC / query progress
  "query.progress.splitting": "Décomposition de la question...",
  "query.progress.splitDone": (params) =>
    `Décomposition terminée, ${params?.n ?? 0} sous-questions au total`,
  "query.progress.querying": "Interrogation des données...",
  "query.progress.dataReceived": (params) => `Données du groupe ${params?.n ?? 0} reçues`,
  "query.progress.dataDone": (params) =>
    `Requête de données terminée, ${params?.n ?? 0} groupes au total`,
  "query.progress.abcAnalyzing": (params) => `Analyse de la sous-question ${params?.n ?? 0}`,
  "query.progress.queryingData": (params) =>
    `Interrogation des données du groupe ${params?.n ?? 0}`,

  // Status
  "query.status.queryCompleted": "Requête Terminée",
  "query.status.queryFailed": "Échec de la Requête",
  "query.status.queryCancelled": "Requête Arrêtée",
  "query.error.apiNotConfigured":
    "API non configurée, veuillez vérifier DATA_QUERY_BASE_URL dans le fichier .env",
  "query.error.noSubQuestions":
    "Échec de la décomposition de la question, aucune sous-question générée",
  "query.error.queryFailed": (params) =>
    `Échec de la requête : ${params?.error ?? "Erreur inconnue"}. Veuillez vérifier la configuration de l'API ou essayer une autre question.`,
  "query.error.unknownError": "Erreur Inconnue",
  "query.error.backendFailedWithoutReason":
    "Le serveur a signalé un échec sans en indiquer la raison",
  "query.error.responseNotJson": "Le corps de la réponse n'est pas un JSON valide",
  "query.error.hotJudgeEmptyReply":
    "La réponse du modèle de jugement est vide. Réponse brute : {preview}",
  "query.error.hotJudgeNotJson":
    "La réponse du modèle de jugement ne contient pas de JSON analysable. Réponse brute : {preview}",
  "query.error.hotJudgeAnswerableNotBoolean":
    "isAnswerable dans la réponse du modèle de jugement n'est pas un booléen. Réponse brute : {preview}",
  "query.error.hotJudgeNoValidCards":
    "Le modèle de jugement a indiqué que la question est répondable, mais usedCards ne contient aucune carte valide. Réponse brute : {preview}",

  // Success summaries
  "query.summary.success": "Requête Réussie !",
  "query.summary.subQuestionCount": (params) => `Sous-questions : ${params?.n ?? 0}`,
  "query.summary.datasetCount": (params) => `Ensembles de données : ${params?.n ?? 0}`,
  "query.summary.totalRows": (params) => `Lignes Totales : ${params?.n ?? 0}`,
  "query.summary.mainColumns": (params) => `Colonnes Principales : ${params?.cols ?? ""}`,
  "query.summary.readyMessage": "Les données sont prêtes pour l'analyse ou la visualisation.",
  "query.summary.dataChunk": (params) => `Bloc de Données ${params?.n ?? ""}`,

  // Response node
  "response.comprehensiveSummary": "Résumé Complet",
  "response.dataTable": (params) => `Tableau de Données_${params?.n ?? 1}`,
  "response.queryData": "Interroger les Données",
  "response.analyzeData": "Analyser les Données",
  "response.generateChart": "Générer un Graphique",
  "response.clarification": "Je comprends que vous pourriez demander l'une des choses suivantes :",
  "response.generatingReply": "Génération de la réponse finale...",

  // Analysis agent
  "analysis.noValidData": "Aucune donnée valide récupérée pour cette sous-question",
  "analysis.recordCount": (params) =>
    `${params?.n ?? 0} enregistrements de données trouvés au total`,
  "analysis.structuredTableHint":
    "Tableau structuré généré, utile pour comparer les différences de données entre objets, catégories ou points temporels",
  "analysis.datasetNoData": "Aucune donnée valide récupérée pour cet ensemble de données",
  "analysis.progress.framework": "Génération du cadre",
  "analysis.progress.collection": "Collecte des indicateurs",
  "analysis.progress.analysis": "Analyse des données",
  "analysis.progress.report": "Génération du rapport",
  "analysis.activity.plan": "Génération cadre",
  "analysis.activity.evidence": "Collecte de données",
  "analysis.activity.skill": "Exécuter une compétence",
  "analysis.activity.narrative": "Narration de l'agent",
  "analysis.activity.chapter": "Rédaction du chapitre",
  "analysis.activity.publish": "Chapitre validé",
  "analysis.activity.chart": "Génération de graphique",
  "analysis.activity.dispatch": "Envoi de sous-agent",
  "analysis.activity.probe": "Exploration des données",
  "analysis.activity.external_tool": "Appel d'outil externe",
  "analysis.runEnded": "Le traitement d’analyse est terminé.",
  "analysis.missingArtifacts":
    "Le traitement d’analyse n’a renvoyé aucun résultat de présentation.",
  "analysis.cancelled": "Analyse approfondie annulée",

  // Checkpointer
  "checkpointer.newConversation": "Nouvelle Conversation",
  "checkpointer.noAccess": "Pas d'accès à cette session",

  // ABC logger
  "abc.idle": "Préparation",
  "abc.split": "Compréhension de la Question",
  "abc.abcAnalysis": "Analyse",
  "abc.data": "Interrogation des Données",
  "abc.conclusion": "Résumé",
  "abc.success": "Terminé",
  "abc.failed": "Échoué",
  "abc.cancelled": "Annulé",
  "abc.exception": (params) => `Exception : ${params?.msg ?? ""}`,
  "abc.cancelledWithMsg": (params) => `Annulé : ${params?.msg ?? ""}`,
  "abc.subQuestion": (params) => `Sous-question ${params?.n ?? 0} : ${params?.text ?? ""}`,
  "abc.dataLogReceived": (params) => `Résultat des données du groupe ${params?.n ?? 0} reçu`,
  "abc.dataLogReceivedTotal": (params) =>
    `Résultat des données du groupe ${params?.n ?? 0} reçu (${params?.total ?? 0} au total)`,

  // API route messages
  "api.analysisAgentNotFound": "Agent introuvable",
  "api.dimensionNotFound": "Dimension introuvable",
  "api.missingRequiredFields": (params?: Record<string, any>) =>
    `Champs obligatoires manquants : ${params?.fields ?? ""}`,
  "api.cardNotFound": "Carte introuvable",
  "api.invalidStatusValue":
    "Valeur de statut invalide, doit être PENDING_REVIEW / PUBLISHED / UNUSED",
  "api.businessDescriptionMustBeString": "businessDescription doit être une chaîne de caractères",
  "api.analysisTaskNotFound": "Tâche d'analyse introuvable",
  "api.noAccessToTask": "Pas d'accès à cette tâche",
  "api.taskIsRunning": "La tâche est en cours d'exécution",
  "api.taskAlreadyCancelled": "Tâche déjà annulée",
  "api.dslCannotBeEmpty": "Le DSL ne peut pas être vide",
  "api.backendExecutionTimeout": "Délai d'exécution backend dépassé",
  "api.backendNotConfigured": "Backend non configuré (DATA_QUERY_BASE_URL)",
  "api.feedbackSubmitted": "Commentaire soumis",
  "api.loadConfigFailed": "Échec du chargement de la configuration",
  "api.saveConfigFailed": "Échec de l'enregistrement de la configuration",
  "model.roleNotConfigured": "Aucun modèle configuré pour le rôle '{role}', veuillez le configurer dans les paramètres du modèle",
  "model.role.query": "Requête",
  "model.role.coding": "Code et calcul",
  "model.role.general": "Général",
  "model.role.diagnosis": "Agent d'opérations",
  "model.role.knowledgeGovernance": "Agent de gouvernance des connaissances",
  "api.modelTestFailed": "Échec du test du modèle",
  "api.noAvailableDashboardData":
    "Aucune donnée disponible dans les résultats d'analyse actuels. Veuillez vérifier que les résultats de requête contiennent des données tabulaires avant de réessayer.",
  "api.dashboardNotFound": "Tableau de bord introuvable",
  "api.cannotGenerateChartInterpretation":
    "Impossible de générer une interprétation structurée du graphique pour le moment",
  "api.checkpointerNotInitialized": "Checkpointer non initialisé",
  "api.backendRequestFailed": (params?: Record<string, any>) =>
    `Échec de la requête backend : ${params?.message ?? ""}`,
  "api.dslsCannotBeEmpty": "Les DSLs ne peuvent pas être vides",
  "api.getConditionsFailed": (params?: Record<string, any>) =>
    `Échec de l'obtention des conditions : ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.executionFailed": (params?: Record<string, any>) =>
    `Échec de l'exécution : ${params?.status ?? ""}${params?.detail ? ` | ${String(params.detail).slice(0, 500)}` : ""}`,
  "api.dslExecutionFailed": (params?: Record<string, any>) =>
    `Échec de l'exécution DSL : ${params?.status ?? ""}`,

  // Reply node
  "reply.defaultWelcomeMsg":
    "Je peux vous aider avec des questions de connaissances métier, ou vous pouvez me dire directement quelles données vous souhaitez interroger, analyser ou visualiser.",
  "reply.defaultErrorMsg":
    "Désolé, je ne peux pas traiter votre demande pour le moment. Veuillez réessayer plus tard.",
  "reply.generationFailed": (params?: Record<string, any>) =>
    `Échec de la génération de la réponse : ${params?.error ?? ""}`,
  "knowledge.created": "✅ Connaissances métier générées :",
  "knowledge.creating": "Génération des connaissances métier en cours…",
  "knowledge.creationFailed":
    "Échec de la génération des connaissances métier. Veuillez réessayer plus tard.",

  // Planner node
  "planner.planningExecution": "Planification des nœuds d'exécution...",

  // Analysis node
  "skill.keywordMatch": "Correspondance par mot-clé",
  "skill.llmMatch": "Correspondance LLM",
  "skill.default": "Par Défaut",
  "analysisNode.matchingComputeSkills": "Correspondance des compétences d'analyse de calcul...",
  "analysisNode.skillMatchDone": "✓ Compétence de calcul correspondante trouvée",
  "analysisNode.executingCompute": (params?: Record<string, any>) =>
    `Exécution du calcul ${params?.skill ?? ""}...`,
  "analysisNode.computeDone": "✓ Calcul terminé",
  "analysisNode.executionFailed": (params?: Record<string, any>) =>
    `⚠️ Échec de l'exécution ${params?.skill ?? ""} : ${params?.error ?? ""}`,
  "analysisNode.applyingMethod": "✓ Méthode d'analyse appliquée",
  "analysisNode.generatingAnswer": "Génération de la réponse d'analyse...",
  "analysisNode.answerGenerated": "✓ Réponse d'analyse générée",
  "analysisNode.analysisComplete": "✓ Analyse terminée",
  "analysisNode.analysisFailed": (params?: Record<string, any>) =>
    `❌ Échec de l'analyse : ${params?.error ?? ""}`,

  // Visualization node
  "viz.preparingData": "Préparation des données",
  "viz.matchingSkills": "Correspondance des compétences",
  "viz.analyzingData": "Analyse des données",
  "viz.generatingChart": "Génération du graphique",
  "viz.preparingVisualization": "Préparation de la visualisation",
  "viz.noRenderSkillsAvailable": "Aucune compétence de rendu disponible",
  "viz.initializationFailed": "Échec de l'initialisation de la visualisation",
  "viz.noRenderSkillsAvailableCheck":
    "Aucune compétence de rendu visuel disponible, veuillez vérifier si les compétences sont activées",
  "viz.missingData": "Données manquantes",
  "viz.dataReady": "Données prêtes",
  "viz.matchingVisSkills": "Correspondance des compétences de visualisation",
  "viz.fetchingData": "Récupération des données...",
  "viz.skillMatchComplete": "Correspondance des compétences terminée",
  "viz.analyzingDataStructure": "Analyse de la structure des données",
  "viz.dataAnalysisComplete": "Analyse des données terminée",
  "viz.chart": "Graphique",
  "viz.chartGenerationComplete": "Génération du graphique terminée",
  "viz.visualizationComplete": "Visualisation terminée",
  "viz.generatedViz": (params?: Record<string, any>) =>
    `✓ ${params?.type ?? ""} généré : ${params?.title ?? ""}`,
  "viz.visualizationFailed": "Échec de la génération de la visualisation",
  "viz.generationFailed": (params?: Record<string, any>) =>
    `Échec de la génération de la visualisation : ${params?.error ?? ""}`,
  "viz.noHtmlGenerated": "Aucun HTML généré",
  "viz.chartGenerationFailed": "Échec de la génération du graphique",
  "viz.generationFailedNoHtml": "Échec de la génération de la visualisation : aucun HTML généré",

  // Response node
  "response.generationComplete": "✓ Génération de la réponse terminée",

  // Analysis agent node (additional)
  "analysis.nullValue": "Valeur nulle",
  "analysis.parallelQueryStarting":
    "Démarrage de la requête parallèle (Métriques Fixes / Métriques Dynamiques / ABC)",
  "analysis.queryComplete": (params?: Record<string, any>) =>
    `Requête terminée, ${params?.count ?? 0} enregistrements au total`,
  "analysis.dimensionQueryStarting": (params?: Record<string, any>) =>
    `Démarrage de la requête pour la dimension : ${params?.name ?? ""}`,
  "analysis.dimensionQueryComplete": (params?: Record<string, any>) =>
    `Requête pour la dimension ${params?.name ?? ""} terminée`,
  "analysis.reportGenerationFailed": (params?: Record<string, any>) =>
    `## Échec de la génération du rapport\n\nErreur : ${params?.error ?? ""}`,
  "analysis.agentNotFound": (params?: Record<string, any>) =>
    `Agent introuvable : ${params?.agentId ?? ""}`,
  "analysis.noDimensionsOrPrompt": (params?: Record<string, any>) =>
    `L'agent "${params?.agentName ?? ""}" n'a ni dimensions configurées ni prompt de dimension d'analyse, impossible de générer un plan d'analyse.`,
  "analysis.noExecutableDimensions":
    "Aucune dimension d'analyse exécutable générée, veuillez ajuster le prompt de dimension ou ajouter une configuration de dimension",

  // Data resolver
  "dataResolver.cannotGetData":
    "Impossible d'obtenir les données, veuillez fournir des données ou demander des données simulées",

  // Default agent
  "service.defaultAgentName": "Agent Général",
  "service.defaultAgentDescription":
    "Un agent polyvalent adapté à divers scénarios métier, capable de décomposer automatiquement les dimensions des questions et de générer des rapports d'analyse professionnels",
  "api.noFileUploaded": "Aucun fichier téléchargé",
  "api.onlyZipSupported": "Seuls les fichiers .zip sont pris en charge",
  "api.testBatchRunning": "Le lot de tests est en cours d'exécution, veuillez d'abord l'arrêter",
  "api.threadNoDataDownload": "Aucune donnée téléchargeable trouvée",
  "api.threadNoDslDownload": "Aucun DSL téléchargeable trouvé",
  "api.noReportToExport": "Aucun rapport d'analyse à exporter",

  // Visualization messages
  "viz.noValidConfigJson": "Le LLM n'a pas renvoyé de JSON de configuration valide",
  "viz.missingChartConfig": "Configuration LLM : champs obligatoires manquants (chartType, title)",
  "viz.missingAxisConfig": "Configuration LLM : champs obligatoires manquants (xField, yField)",
  "viz.pieDataTooLarge": (params?: Record<string, any>) =>
    `Les graphiques en secteurs/rosaces ne conviennent pas à plus de 10 points de données (actuel : ${params?.count ?? 0}), veuillez choisir un autre type de graphique`,
  "viz.generating": (params?: Record<string, any>) => `Génération du ${params?.type ?? ""}...`,
  "viz.noRenderSkill": "Aucune compétence de visualisation disponible trouvée",

  // Additional analysis/query messages
  "analysis.noDataForAnalysis":
    "Aucune donnée disponible pour l'analyse. Veuillez d'abord exécuter une requête de données ou utiliser le mode agent d'analyse.",
  "analysis.matchingMethodology": "Correspondance de la méthodologie d'analyse...",

  // Dashboard / planning / dimension
  "dashboard.notFoundOrNoPerm": "Tableau de bord introuvable ou pas d'autorisation",
  "query.datasetFallbackTitle": (params?: Record<string, any>) =>
    `Ensemble de Données ${params?.index ?? 1}`,
  "query.display.empty":
    "Aucune donnée n'est actuellement disponible. Modifiez les filtres ou réessayez plus tard.",
  "query.display.groupColumn": "Groupe",
  "query.harness.processHeading": "Processus de requête",
  "query.harness.dataHeading": "Résultats des données",
  "query.harness.scopeHeading": "Périmètre et définitions",

  // Planning / clarification / misc
  "planning.failed": (params?: Record<string, any>) =>
    `❌ Échec de la planification : ${params?.error ?? ""}`,
  "report.defaultTitle": "Rapport d'Analyse",

  // Autotest verdict
  "autotest.verdict.correct": "Correct",
  "autotest.verdict.wrong": "Incorrect",
  "autotest.verdict.abnormal": "Anormal",
  "autotest.verdict.reason.cancelled": "Annulé",
  "autotest.verdict.reason.execAbnormal": "Exécution anormale",
  "autotest.verdict.reason.execFailed": "Échec de l'exécution",
  "autotest.verdict.reason.execIncomplete": "Exécution incomplète",
  "autotest.verdict.reason.missingEval": "Conclusion d'évaluation manquante",
  "autotest.verdict.reason.evalAbnormal": "Évaluation anormale",
  "autotest.verdict.reason.evalWrong": "Évaluation déterminée comme incorrecte",
} satisfies import("../index").TranslationMessages;

export const frLocaleMeta = {
  languageName: 'Français',
  outputInstruction: "IMPORTANT : Vous DEVEZ rédiger l'intégralité du rapport en français. N'écrivez PAS en chinois ni dans une autre langue.",
  conclusionPrefix: '📌 Conclusion : ',
};
