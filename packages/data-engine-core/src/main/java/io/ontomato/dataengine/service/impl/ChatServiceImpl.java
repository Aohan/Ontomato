package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation.Illegal;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.abcQuestion.ABCSubQueryTask;
import io.ontomato.dataengine.bean.abcQuestion.ABCTask;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.OriginCheckResult;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.logging.DiagnosticEventLogger;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AfterCalculateService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ChatService;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.JSONCorrector;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.PythonCalculatorService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.*;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@Slf4j
@Service
public class ChatServiceImpl implements ChatService {
    
    @Autowired
    DataRagConfig dataRagConfig;

    @Autowired
    private DataAdapterRegistry dataAdapterRegistry;
    
    @Autowired
	private BusinessConfigService businessConfigService;
    
    @Autowired
    AdminService adminService;
    
    @Autowired
    private PythonCalculatorService pythonCalculatorService;
    
    @Autowired
    private AfterCalculateService afterCalculateService;
    
    @Autowired
    CheckService checkService;
    
    @Autowired
    private FunctionService functionService;
    
    @Autowired
    private MetricViewService metricViewService;
    
    @Autowired
    private JSONCorrector jsonCorrector;
    
    @Autowired
    private LangService langService;
    
	@Autowired
	private KnowledgeDao knowledgeDao;

	@Autowired
	private BussinessExampleDao bussinessExampleDao;
	
	@Autowired
	private BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Autowired
	private ABCTaskDao abcTaskDao;
	
	@Autowired
	private ABCSubQueryTaskDao abcSubQueryTaskDao;

	@Autowired
    private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;
	
	private ExecutorService subQueryExecutorService = Executors.newFixedThreadPool(25);
	private ExecutorService saveCardExecutorService = Executors.newFixedThreadPool(2);

	Pattern QUESTION_PATTERN = Pattern.compile("\\{[\\s\\S]+?\\}" );

	/** Cooperative cleanup grace period after a try thread interrupt: enough for only one interrupt response and stack unwinding, not a second execution budget; when reached normally the thread has already ended, so the wait costs zero time. */
	private static final long TRY_THREAD_JOIN_TIMEOUT_MS = 5000L;
	
	@PostConstruct
	public void initService() {
		// ABC task cleanup thread
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<ABCTask> tasks = abcTaskDao.queryList();
						log.info("now taskInfoMap.size: " + tasks.size());
						int removeCount = 0;
						for (ABCTask task : tasks) {
							if (now - task.getCreateTimestamp() > timeoutTimeRange) {
								abcTaskDao.delete(task.getSessionId());
								abcSubQueryTaskDao.deleteBySessionId(task.getSessionId());
								removeCount++;
							}
						}
						log.info("after removed taskInfoMap.size: " + (tasks.size() - removeCount));
						Thread.sleep(5 * 60 * 1000);
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
				}
			}
		}).start();
		
		// Timed-out sub-query cache cleanup thread
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						File dir = new File("conf/" + afterCalculateService.getSubQueryCacheDirName());
						File[] cacheFiles = dir.listFiles();
						if (cacheFiles != null) {
							for (File cacheFile : cacheFiles) {
								try {
									if (cacheFile.exists() && now - cacheFile.lastModified() > timeoutTimeRange) {
										cacheFile.delete();
									}
								} catch (Exception e) {}
							}
						}
						Thread.sleep(5 * 60 * 1000);
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
				}
			}
		}).start();
	}
    
    @Override
    public JSONArray chat(String sessionId, Long timeout, String domainId) {
    	Long now = System.currentTimeMillis();
    	JSONArray answers = new JSONArray();
    	Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
    	
    	try {
    		while (true) {
    			if (BackendSessionEntrance.isCancelled(sessionId)) {
    				throw new SessionCancelledException(sessionId);
    			}
    			ABCTask taskInfo0 = abcTaskDao.queryById(sessionId);
    			
            	if (taskInfo0 == null) {
            		break;
            	} else {
            		List<ABCSubQueryTask> subQueryTasks = abcSubQueryTaskDao.queryBySessionId(sessionId, false, false);
            		if (subQueryTasks.size() > 0) {
                		for (int i = 0; i < subQueryTasks.size(); i++) {
                			ABCSubQueryTask subQueryTask = subQueryTasks.get(i);
                			if (!subQueryTask.getReturnSSE() && subQueryTask.getRowPermissionDataMap() != null) {
                				ABCSubQueryTask subQueryTaskWithAllData = abcSubQueryTaskDao.queryById(subQueryTask.getId(), true, true);
                				JSONObject rowPermissionDataMap = subQueryTaskWithAllData.getRowPermissionDataMap();
                				rowPermissionDataMap.put("index", subQueryTask.getIndex());
                				UserDataPermission permission = subQueryTask.getPermission();
                				if (ABCSubQueryTask.DSL_TYPE.equals(subQueryTask.getType())) { // DSL sub-query
                					JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(rowPermissionDataMap, permission, classDefs);
                					JSONArray data = rowColPermissionDataMap.getJSONArray("data");
                					if (data == null) {
                						data = new JSONArray();
                					}
                					if (data.size() == 0) {
                						JSONObject datum = new JSONObject();
                						datum.put("answer", new JSONArray());
                						data.add(datum);
                					}
                					rowColPermissionDataMap.put("data", data);
                					SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(rowColPermissionDataMap, Feature.WriteMapNullValue));
                				} else if (ABCSubQueryTask.AFTER_CALCULATE_TYPE.equals(subQueryTask.getType())) { // post-calculation sub-query
                					JSONObject rowColPermissionDataMap = DslPermissionUtil.dealAfterCalculateAnswerWithPermission(
                							rowPermissionDataMap, 
                							subQueryTask.getDslConsanguinityMapList(), 
                							subQueryTask.getAfterCalculatorConsanguinityList(), 
                							permission
                					);
                					rowColPermissionDataMap.put("afterCalculatorConsanguinityList", subQueryTask.getAfterCalculatorConsanguinityList());
                					List<Map<String, Object>> schemaDefs = new ArrayList<Map<String, Object>>();
                					for (int j = 0; j < subQueryTasks.size() - 1; j++) {
                						ABCSubQueryTask sqt = subQueryTasks.get(j);
                        				schemaDefs.add(sqt.getCacheSchemaDef());
                					}
                    				rowColPermissionDataMap.put("schemaDefs", schemaDefs);
                					SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(rowColPermissionDataMap, Feature.WriteMapNullValue));
                				}
                    			subQueryTask.setReturnSSE(true);
                    			abcSubQueryTaskDao.save(subQueryTask, false);
                				break;
                			}
                		}
                	}
            	}
            	
            	ABCTask taskInfo1 = abcTaskDao.queryById(sessionId);
            	List<ABCSubQueryTask> subQueryTasks = abcSubQueryTaskDao.queryBySessionId(sessionId, false, false);
            	boolean breakable = true;
            	if (taskInfo1 == null) {
            		break;
            	} else {
            		for (ABCSubQueryTask subQueryTask : subQueryTasks) {
            			if (!subQueryTask.getReturnSSE()) {
            				breakable = false;
            				break;
            			}
            		}
            	}
            	
            	if (breakable && taskInfo1.isAskFinished()) {
            		List<Map<String, Object>> schemaDefs = new ArrayList<Map<String, Object>>();
            		for (int i = 0; i < subQueryTasks.size(); i++) {
            			ABCSubQueryTask subQueryTask = subQueryTasks.get(i);
            			ABCSubQueryTask subQueryTaskWithAllData = abcSubQueryTaskDao.queryById(subQueryTask.getId(), true, true);
            			JSONObject rowPermissionDataMap = subQueryTaskWithAllData.getRowPermissionDataMap();
            			UserDataPermission permission = subQueryTask.getPermission();
            			if (ABCSubQueryTask.DSL_TYPE.equals(subQueryTask.getType())) { // DSL sub-query
            				JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(rowPermissionDataMap, permission, classDefs);
            				answers.add(rowColPermissionDataMap);
            				Map<String, Object> schemaDef = subQueryTask.getCacheSchemaDef();
            				schemaDefs.add(schemaDef);
            			} else if (ABCSubQueryTask.AFTER_CALCULATE_TYPE.equals(subQueryTask.getType())) { // post-calculation sub-query
            				JSONObject rowColPermissionDataMap = DslPermissionUtil.dealAfterCalculateAnswerWithPermission(
        							rowPermissionDataMap, 
        							subQueryTask.getDslConsanguinityMapList(), 
        							subQueryTask.getAfterCalculatorConsanguinityList(), 
        							permission
        					);
            				rowColPermissionDataMap.put("afterCalculatorConsanguinityList", subQueryTask.getAfterCalculatorConsanguinityList());
            				rowColPermissionDataMap.put("schemaDefs", schemaDefs);
            				answers.add(rowColPermissionDataMap);
            			}
            		}
            		abcTaskDao.delete(sessionId);
            		abcSubQueryTaskDao.deleteBySessionId(sessionId);
            		break;
            	} else {
            		Thread.sleep(1000);
            	}
            	if (timeout != null && timeout > 0) {
            		if (System.currentTimeMillis() - now > timeout) {
            			break;
            		}
            	}
    		}
    	} catch (SessionCancelledException e) {
    		throw e;
    	} catch (Exception e) {
    		log.error("[" + sessionId + "] " + e.getMessage(), e);
    	}
    	
    	log.info("[" + sessionId + "] chat finish!!!");
    	return answers;
    }
    
    @Override
    public DslCookerEvaluation generateDsl(String question, int subQueryIndex, JSONObject subQuery, String sessionId, String originSessionId, String domainId) {
    	DslCookerEvaluation evaluation = new DslCookerEvaluation();
    	evaluation.setSessionId(originSessionId);
    	evaluation.setQuestion(question);
    	
    	List<String> classes = new ArrayList<String>();
		for (int j = 0; j < subQuery.getJSONArray("classes").size(); j++) {
			classes.add(subQuery.getJSONArray("classes").getString(j));
		}
		// [subgraph + C_Step] version question
		JSONObject subGraph = subQuery.getJSONObject("subgraph");
		String subGraphTable = "| Path ID | Source object | Relationship | Target object |\n"
				+ "| ---- | ---- | ---- | ---- |\n";
		JSONArray paths = subGraph.getJSONArray("path");
		if (paths != null) {
			for (int i = 0; i < paths.size(); i++) {
				JSONObject path = paths.getJSONObject(i);
				subGraphTable += "| P" + (i + 1) + " | " + path.getString("source") + " | " + path.getString("relation") + " | " + path.getString("target") + " |\n";
			}
		}
		String filterSelectTable = "| Object class | Filter conditions | Extracted fields | Condition source | Extraction reason |\n"
				+ "| ---- | ---- | ---- | ---- | ---- |\n";
		JSONArray nodes = subGraph.getJSONArray("nodes");
		if (nodes != null) {
			for (int i = 0; i < nodes.size(); i++) {
				JSONObject node = nodes.getJSONObject(i);
				filterSelectTable += "| " + node.getString("node") + " | " + node.getString("filters") + " | " + node.getString("select") + " | " + node.getString("filter_source") + " | " + node.getString("select_reason") + " |\n";
			}
		}
		String abcStep = "**A_Step: path table**\n\n" 
						+ subGraphTable + "\n\n" 
						+ "**B_Step: nodes table**\n\n"
						+ filterSelectTable + "\n\n";
		if (subQuery.containsKey("C_Step") && subQuery.get("C_Step") != null && !"".equals(subQuery.getString("C_Step").trim())) {
			abcStep += "** C_Step: " + subQuery.getString("C_Step") + " **\n";
		}
		
		String q = subQuery.getString("subQuestion") + "\n\n" + abcStep;
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);

		Long dslCookerStart = System.currentTimeMillis();
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(originSessionId);
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String dslCookerExample = adminService.getDslCookerExample(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		// One workspace per try session; cleaned up uniformly after the run ends (including on exception), and the second follow-up reuses the same workspace
		for (int i = 0; i < businessConfig.getDslCookerTries(); i++) {
			try {
				agentWorkspaceService.createWorkspace(BackendSessionEntrance.derive(sessionId, "try-" + i));
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		List<Thread> tryThreads = new ArrayList<Thread>();
		try {
		// Each attempt produces exactly one completion signal: success gives the aggregator a usable result, failure goes through the future's exceptional channel and does not take part in the vote
		List<CompletableFuture<String[]>> tryFutures = new ArrayList<CompletableFuture<String[]>>();
		for (int i = 0; i < businessConfig.getDslCookerTries(); i++) {
			tryFutures.add(new CompletableFuture<String[]>());
		}
		for (int i = 0; i < businessConfig.getDslCookerTries(); i++) {
			String ii = i + "";
			CompletableFuture<String[]> tryFuture = tryFutures.get(i);
			Thread tryThread = new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String trySessionId = BackendSessionEntrance.derive(sessionId, "try-" + ii);
						String[] userMessageArray = UserMessageUtil.getQuestionUserMessage(trySessionId, knowledgeDao,bussinessExampleDao, q, classes, subQuery, dataAdapterRegistry.create(businessConfig, null), businessConfigService, jsonRule, dslCookerExample, domainId);
						String userMessage = userMessageArray[0];
						String userMessageWithoutExample = userMessageArray[1];
						String queryJson = multiThreadAIChatService.chat(
								MultiThreadAIChatService.DSL_COOKER,
								originalQuestion,
								trySessionId,
								userMessage,
								ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
								domainId);
						String rawQueryJson = queryJson + "";
				        // The DSL comes only from the submission registry; a try that did not submit is treated as not having produced a usable DSL
						String submittedDsl = agentWorkspaceService.getSubmission(trySessionId);
						String votedDsl = null;
						if (submittedDsl != null) {
							votedDsl = JSONCheckUtil.correctJson(submittedDsl);
							votedDsl = DslUtil.normalizeClassNames(votedDsl, classDefs);
						}
						tryFuture.complete(new String[] {trySessionId, votedDsl, userMessage, userMessageWithoutExample, rawQueryJson});
					} catch (Exception e) {
						if (SessionCancelledException.findCancelled(e) != null) {
							log.info("[" + sessionId + "] dsl try cancelled");
							tryFuture.completeExceptionally(e);
							return;
						}
						log.error(e.getMessage(), e);
						tryFuture.completeExceptionally(e);
					}
				}
			});
			tryThreads.add(tryThread);
			tryThread.start();
			try {
				Thread.sleep(1000L);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				break;
			}
		}
		Map<String, String[]> trySessionId_queryJson_map = new HashMap<String, String[]>();
		List<Throwable> tryFailures = new ArrayList<Throwable>();
		while (true) {
			if (BackendSessionEntrance.isCancelled(originSessionId)) {
				throw new SessionCancelledException(originSessionId);
			}
			boolean allDone = true;
			for (CompletableFuture<String[]> tryFuture : tryFutures) {
				if (!tryFuture.isDone()) {
					allDone = false;
					break;
				}
			}
			if (allDone) {
				break;
			}
			if (dslCookerStart + businessConfig.getDslCookerTimeout() < System.currentTimeMillis()) {
				// Timeout: unfinished attempts are treated as having no result; do not fabricate a vendor error
				break;
			}
			try {
				Thread.sleep(1000L);
			} catch (InterruptedException e) {
				// Interrupt: restore the flag and end polling; do not vote with partial results or disguise an empty candidate
				Thread.currentThread().interrupt();
				throw new RuntimeException(e);
			}
		}
		for (CompletableFuture<String[]> tryFuture : tryFutures) {
			if (!tryFuture.isDone()) {
				continue;
			}
			try {
				String[] trySessionId_queryJson = tryFuture.getNow(null);
				trySessionId_queryJson_map.put(trySessionId_queryJson[0], trySessionId_queryJson);
			} catch (CompletionException e) {
				Throwable cause = e.getCause() != null ? e.getCause() : e;
				tryFailures.add(cause);
			}
		}
		if (trySessionId_queryJson_map.isEmpty() && !tryFailures.isEmpty()) {
			// All model attempts failed: report the actual error; do not let the failures take part in the vote; do not wrap cancellation, throw it directly.
			SessionCancelledException.throwIfCancelled(tryFailures.get(0));
			throw new CompletionException(tryFailures.get(0));
		}
		
		Map<String, JSONCheckUtil.Result> legalCheckResultMap = new HashMap<String, JSONCheckUtil.Result>();
		Map<String, JSONCheckUtil.Result> illegalCheckResultMap = new HashMap<String, JSONCheckUtil.Result>();
		for (String trySessionId : trySessionId_queryJson_map.keySet()) {
			try {
				String[] trySessionId_queryJson = trySessionId_queryJson_map.get(trySessionId);
				JSONCheckUtil.Result checkResult = JSONCheckUtil.checkJSON(trySessionId_queryJson[1], jsonRule, jsonCorrector, domainId, trySessionId);
				if (checkResult != null) {
					if (checkResult.isLegal()) {
						legalCheckResultMap.put(trySessionId, checkResult);
					} else {
						illegalCheckResultMap.put(trySessionId, checkResult);
					}
				}
			} catch (SessionCancelledException e) {
				throw e;
			} catch (Exception e) {}
		}
		
		String legalTrySessionId = null;
		String illegalTrySessionId = null;
		if (legalCheckResultMap.size() > 0) { // there is a legal DSL
			List<String> dslStrs = new ArrayList<String>();
			List<String> trySessionIds = new ArrayList<String>();
			for (String trySessionId : legalCheckResultMap.keySet()) {
				JSONCheckUtil.Result checkResult = legalCheckResultMap.get(trySessionId);
				dslStrs.add(checkResult.getQueryJson());
				trySessionIds.add(trySessionId);
			}
			DSLGrouper grouper = new DSLGrouper();
			List<List<Integer>> grouperResult = grouper.group(dslStrs);

			if (grouperResult != null && grouperResult.size() > 0 && grouperResult.get(0).size() > 0) {
				log.info("DSLGrouper result:{}",grouperResult.toString());
				Integer grouperIndex = grouperResult.get(0).get(0);
				if (grouperIndex >= 0 && grouperIndex < dslStrs.size()) {
					legalTrySessionId = trySessionIds.get(grouperIndex);
				}
			}
		}
		
		if (legalTrySessionId != null) { // use the legal DSL with the most votes
			String[] trySessionId_queryJson = trySessionId_queryJson_map.get(legalTrySessionId);
			evaluation.setUserMessage(trySessionId_queryJson[2]);
			evaluation.setUserMessageWithoutExample(trySessionId_queryJson[3]);
			evaluation.setDslStr(trySessionId_queryJson[1]);
		} else { // take the first illegal DSL
			if (illegalCheckResultMap.size() > 0) {
				for (String trySessionId : illegalCheckResultMap.keySet()) {
					illegalTrySessionId = trySessionId;
					break;
				}
			}
			if (illegalTrySessionId != null) {
				String[] trySessionId_queryJson = trySessionId_queryJson_map.get(illegalTrySessionId);
				evaluation.setUserMessage(trySessionId_queryJson[2]);
				evaluation.setUserMessageWithoutExample(trySessionId_queryJson[3]);
				evaluation.setDslStr(trySessionId_queryJson[1]);
			}
		}
		evaluation.setAbcQuestion(q);

        try {
        	if (legalTrySessionId != null) {
        		JSONCheckUtil.Result checkResult = legalCheckResultMap.get(legalTrySessionId);
        		String finalDsl = DslUtil.setConditionTextColumnToEmptyArray(checkResult.getQueryJson());
            	String finalDslWithoutTimeConvert = finalDsl + "";
            	finalDsl = DslUtil.setConditionTimeColumnToCorrectFormat(finalDsl, dataRagConfig.getDslMightTimeFormats(), classDefs);
            	finalDsl = DslUtil.setLastStepToUserAndSaveTable(finalDsl);
            	finalDslWithoutTimeConvert = DslUtil.setLastStepToUserAndSaveTable(finalDslWithoutTimeConvert);
            	finalDsl = DslUtil.enrichShouldReturnAttr(finalDsl, classDefs);
            	finalDslWithoutTimeConvert = DslUtil.enrichShouldReturnAttr(finalDslWithoutTimeConvert, classDefs);
            	finalDsl = DslUtil.setSessionIdToDsl(finalDsl, legalTrySessionId);
            	finalDslWithoutTimeConvert = DslUtil.setSessionIdToDsl(finalDslWithoutTimeConvert, legalTrySessionId);
            	log.info("final dsl: [" + legalTrySessionId + "]" + finalDsl);
            	LogHelper.info("final dsl: [" + legalTrySessionId + "]" + finalDsl);
            	DiagnosticEventLogger.emit("dsl.finalized", sessionId, new JSONObject().fluentPut("dsl", DiagnosticEventLogger.safeJson(finalDsl)));
            	evaluation.setDslStr(finalDsl);
            	evaluation.setDslStrWithoutTimeConvert(finalDslWithoutTimeConvert);
            	evaluation.setPass(null);
            	evaluation.setIllegals(new ArrayList<Illegal>());
        	} else { // start the second DSLCooker
        		// Submissions are valid per round: clear this try session's first-round submission registry before the second round starts; the first-round selection is already complete and unaffected
        		if (illegalTrySessionId != null) {
        			agentWorkspaceService.clearSubmission(illegalTrySessionId);
        		}
        		JSONCheckUtil.Result checkResult = illegalCheckResultMap.get(illegalTrySessionId);
        		String strCheckResult = subQuery.getString("subQuestion") + "\n\n" + abcStep + "\n\nPay special attention to the following points:\n" + checkResult.toIllegalContent();
                log.warn("[" + originSessionId + "] " + strCheckResult);
			String[] userMessageRetryArray = UserMessageUtil.getQuestionUserMessage(illegalTrySessionId, knowledgeDao,bussinessExampleDao, strCheckResult, classes, subQuery, dataAdapterRegistry.create(businessConfig, null), businessConfigService, jsonRule, dslCookerExample, domainId);
    			String userMessageRetry = userMessageRetryArray[0];
    			String userMessageRetryWithoutExample = userMessageRetryArray[1];
    			evaluation.setUserMessage(userMessageRetry);
    			evaluation.setUserMessageWithoutExample(userMessageRetryWithoutExample);
    			evaluation.setAbcQuestion(strCheckResult);

				try {
					multiThreadAIChatService.chat(
							MultiThreadAIChatService.DSL_COOKER,
							originalQuestion,
							illegalTrySessionId,
							userMessageRetry,
							ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
							domainId);
				} catch (RuntimeException e) {
					// Second-round model follow-up failed: like a total first-round aggregation failure it is a CompletionException and passes through to the caller; cancellation is not logged as an error.
					SessionCancelledException.throwIfCancelled(e);
					log.error(e.getMessage(), e);
					throw new CompletionException(e);
				}
                // The DSL comes only from the submission registry; the second follow-up reuses the same try session and the same workspace
 				String secondQueryJson = agentWorkspaceService.getSubmission(illegalTrySessionId);
 				if (secondQueryJson != null) {
 					secondQueryJson = JSONCheckUtil.correctJson(secondQueryJson);
 					secondQueryJson = DslUtil.normalizeClassNames(secondQueryJson, classDefs);
 				}
				evaluation.setDslStr(secondQueryJson);
                JSONCheckUtil.Result secondCheckResult = null;
                try {
                	secondCheckResult = JSONCheckUtil.checkJSON(secondQueryJson, jsonRule, jsonCorrector, domainId, illegalTrySessionId);
                } catch (SessionCancelledException e) {
                	throw e;
                } catch (Exception e) {
                	log.error(e.getMessage(), e);
					List<Illegal> illegals = new ArrayList<Illegal>();
					Illegal illegal = evaluation.new Illegal();
					illegal.setType(DslCookerEvaluation.CHECKJSON_OTHER_ILLEGAL_TYPE);
					illegal.setConclusion("");
					illegals.add(illegal);
					evaluation.setIllegals(illegals);
					return evaluation;
                }
                if(secondCheckResult.isLegal()){
                	String finalDsl = DslUtil.setConditionTextColumnToEmptyArray(secondCheckResult.getQueryJson());
                	String finalDslWithoutTimeConvert = finalDsl + "";
                	finalDsl = DslUtil.setConditionTimeColumnToCorrectFormat(finalDsl, dataRagConfig.getDslMightTimeFormats(), classDefs);
                	finalDsl = DslUtil.setLastStepToUserAndSaveTable(finalDsl);
                	finalDslWithoutTimeConvert = DslUtil.setLastStepToUserAndSaveTable(finalDslWithoutTimeConvert);
                	finalDsl = DslUtil.enrichShouldReturnAttr(finalDsl, classDefs);
                	finalDslWithoutTimeConvert = DslUtil.enrichShouldReturnAttr(finalDslWithoutTimeConvert, classDefs);
                	finalDsl = DslUtil.setSessionIdToDsl(finalDsl, illegalTrySessionId);
                	finalDslWithoutTimeConvert = DslUtil.setSessionIdToDsl(finalDslWithoutTimeConvert, illegalTrySessionId);
                    log.info("final dsl: [" + illegalTrySessionId + "]" + finalDsl);
                    LogHelper.info("final dsl: [" + illegalTrySessionId + "]" + finalDsl);
                    DiagnosticEventLogger.emit("dsl.finalized", sessionId, new JSONObject().fluentPut("dsl", DiagnosticEventLogger.safeJson(finalDsl)));
                    evaluation.setDslStr(finalDsl);
                    evaluation.setDslStrWithoutTimeConvert(finalDslWithoutTimeConvert);
                	evaluation.setPass(null);
                	evaluation.setIllegals(new ArrayList<Illegal>());
                } else {
                	log.warn("[" + originSessionId + "] JSON error: {}", secondCheckResult.toIllegalContent());
                	List<Illegal> illegals = new ArrayList<Illegal>();
                	for (String key : secondCheckResult.getIllegalMap().keySet()) {
                		String content = secondCheckResult.getIllegalMap().get(key);
                		Illegal illegal = evaluation.new Illegal();
                		if ("steps".equals(key)) {
                			illegal.setType(DslCookerEvaluation.STEP_ILLEGAL_TYPE);
                		} else if ("checkObjectsColumn".equals(key)) {
                			illegal.setType(DslCookerEvaluation.WHERE_ILLEGAL_TYPE);
                		} else if ("checkRelationShip".equals(key)) {
                			illegal.setType(DslCookerEvaluation.RELATION_ILLEGAL_TYPE);
                		} else if ("patterns".equals(key)) {
                			illegal.setType(DslCookerEvaluation.PATTERN_ILLEGAL_TYPE);
                		} else if ("graph".equals(key)) {
                			illegal.setType(DslCookerEvaluation.GRAPH_ILLEGAL_TYPE);
                		} else if ("checkOutputColumn".equals(key)) {
                			illegal.setType(DslCookerEvaluation.SELECT_ILLEGAL_TYPE);
                		} else if ("answer".equals(key)) {
                			illegal.setType(DslCookerEvaluation.ANSWER_ILLEGAL_TYPE);
                		}
                		illegal.setConclusion(content);
                		illegals.add(illegal);
                	}
                	evaluation.setIllegals(illegals);
                }
        	}
        } catch (SessionCancelledException e) {
        	throw e;
        } catch (CompletionException e) {
			// Model attempt failed: pass through to the caller without converting to DSL validation semantics; cancellation is not logged as an error.
			SessionCancelledException.throwIfCancelled(e);
			log.error(e.getMessage(), e);
			throw e;
        } catch (Exception e) {
        	log.error(e.getMessage(), e);
        	List<Illegal> illegals = new ArrayList<Illegal>();
        	Illegal illegal = evaluation.new Illegal();
			illegal.setType(DslCookerEvaluation.OTHER_ILLEGAL_TYPE);
			illegal.setConclusion("");
         	illegals.add(illegal);
         	evaluation.setIllegals(illegals);
        }
        } finally {
        	// try threads share the workspace lifecycle: first interrupt surviving threads and wait for them to end with a bound, then clean up the workspace; already-finished threads are unaffected
        	for (Thread tryThread : tryThreads) {
        		if (tryThread.isAlive()) {
        			tryThread.interrupt();
        		}
        	}
        	long joinDeadline = System.currentTimeMillis() + TRY_THREAD_JOIN_TIMEOUT_MS;
        	for (Thread tryThread : tryThreads) {
        		long remaining = joinDeadline - System.currentTimeMillis();
        		if (remaining <= 0) {
        			break;
        		}
        		try {
        			tryThread.join(remaining);
        		} catch (InterruptedException e) {
        			Thread.currentThread().interrupt();
        			break;
        		}
        	}
        	for (int i = 0; i < businessConfig.getDslCookerTries(); i++) {
        		agentWorkspaceService.removeWorkspace(BackendSessionEntrance.derive(sessionId, "try-" + i));
        	}
        }
        
        return evaluation;
    }
    
    @Override
    public JSONObject splitQuestion(String question, String sessionId, List<String> classNames, boolean returnNodeIds, String lang, UserDataPermission curUserDataPermission, User user, boolean isV0) {
    	JSONObject ret = null;
    	try {
    		ret = _splitQuestion(question, sessionId, classNames, returnNodeIds, lang, curUserDataPermission, user, isV0);
        	ret.put("sessionId", sessionId);
		} catch (SessionCancelledException e) {
			throw e;
		} catch (CompletionException e) {
			// Model attempt failed: pass through to the caller without converting to an empty result; cancellation is not logged as an error.
			SessionCancelledException.throwIfCancelled(e);
			log.error("[" + sessionId + "] " + e.getMessage(), e);
			throw e;
    	} catch (Exception e) {
    		log.error("[" + sessionId + "] " + e.getMessage(), e);
    	}
    	log.info("[" + sessionId + "] splitQuestion finish!!!");
    	return ret;
    }
    
    private JSONObject _splitQuestion(String question, String sessionId, List<String> classNames, boolean returnNodeIds, String lang, UserDataPermission curUserDataPermission, User user, boolean isV0) {
    	List<JSONObject> finalSubQueries = new ArrayList<JSONObject>();
    	
    	Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
    	
    	// Multiple requests, take the most reasonable split result
    	OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(sessionId);
		originalQuestion.setQuestion(question);
		Long questionSpliterStart = System.currentTimeMillis();
		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String questionSpliterExample = adminService.getQuestionSpliterExample(user.getDomainId());
		// Each attempt produces exactly one completion signal: success gives the aggregator a parsed result, failure goes through the future's exceptional channel and does not take part in the vote
		List<CompletableFuture<Object[]>> splitFutures = new ArrayList<CompletableFuture<Object[]>>();
		for (int i = 0; i < businessConfig.getQuestionSpliterTries(); i++) {
			splitFutures.add(new CompletableFuture<Object[]>());
		}
    	for (int i = 0; i < businessConfig.getQuestionSpliterTries(); i++) {
    		String trySessionId = BackendSessionEntrance.derive(sessionId, "try-" + i);
			CompletableFuture<Object[]> splitFuture = splitFutures.get(i);
    		new Thread(new Runnable() {
				@Override
				public void run() {
					try {
						String[] userMessageArray = isV0 ? 
								UserMessageUtil.getSplitQuestionV0UserMessage(trySessionId, 
									knowledgeDao, businessExampleQuestionSpliterDao, question,
									businessConfigService.get(user.getDomainId()).getKnowledgeMaxResult(), 
									lang, langService, classNames, jsonRule, questionSpliterExample, user.getDomainId())
								:
								UserMessageUtil.getSplitQuestionV1UserMessage(trySessionId, 
									knowledgeDao, businessExampleQuestionSpliterDao, question,
									businessConfigService.get(user.getDomainId()).getKnowledgeMaxResult(), 
									lang, langService, classNames, jsonRule, questionSpliterExample, user.getDomainId());
				    	String userMessage = userMessageArray[0];
				    	String userMessageWithoutExample = userMessageArray[1];
				    	String retStr = multiThreadAIChatService.chat(
								isV0 ? MultiThreadAIChatService.QUESTION_SPLITER_V0 : MultiThreadAIChatService.QUESTION_SPLITER_V1,
								originalQuestion,
								trySessionId,
								userMessage,
								ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
								user.getDomainId());
				    	if (retStr.indexOf("```json") >= 0) {
				    		retStr = retStr.substring(retStr.indexOf("```json") + 7);
							if (retStr.lastIndexOf("```") > 0) {
								retStr = retStr.substring(0, retStr.lastIndexOf("```"));
							}
				    	}
						JSONObject retObj = jsonCorrector.parseObject(retStr, user.getDomainId(), trySessionId);
						splitFuture.complete(new Object[] {trySessionId, retObj, userMessage, userMessageWithoutExample});
					} catch (Exception e) {
						if (SessionCancelledException.findCancelled(e) != null) {
							log.info("[" + sessionId + "] split try cancelled");
							splitFuture.completeExceptionally(e);
							return;
						}
						log.error(e.getMessage(), e);
						splitFuture.completeExceptionally(e);
					}
				}
    		}).start();
    	}
    	Map<String, Object[]> trySessionId_retObj_map = new HashMap<String, Object[]>();
		List<Throwable> splitFailures = new ArrayList<Throwable>();
		while (true) {
			if (BackendSessionEntrance.isCancelled(sessionId)) {
				throw new SessionCancelledException(sessionId);
			}
			boolean allDone = true;
			for (CompletableFuture<Object[]> splitFuture : splitFutures) {
				if (!splitFuture.isDone()) {
					allDone = false;
					break;
				}
			}
			if (allDone) {
				break;
			}
			if (questionSpliterStart + businessConfig.getQuestionSpliterTimeout() < System.currentTimeMillis()) {
				// Timeout: unfinished attempts are treated as having no result; do not fabricate a vendor error
				break;
			}
			try {
				Thread.sleep(1000L);
			} catch (InterruptedException e) {
				// Interrupt: restore the flag and end polling; do not vote with partial results or disguise an empty candidate
				Thread.currentThread().interrupt();
				throw new RuntimeException(e);
			}
		}
		for (CompletableFuture<Object[]> splitFuture : splitFutures) {
			if (!splitFuture.isDone()) {
				continue;
			}
			try {
				Object[] trySessionId_retObj = splitFuture.getNow(null);
				trySessionId_retObj_map.put((String)trySessionId_retObj[0], trySessionId_retObj);
			} catch (CompletionException e) {
				Throwable cause = e.getCause() != null ? e.getCause() : e;
				splitFailures.add(cause);
			}
		}
		if (trySessionId_retObj_map.isEmpty() && !splitFailures.isEmpty()) {
			// All model attempts failed: report the actual error; do not let the failures take part in the vote; do not wrap cancellation, throw it directly.
			SessionCancelledException.throwIfCancelled(splitFailures.get(0));
			throw new CompletionException(splitFailures.get(0));
		}


		///////////////////////////////
		// Multiple concurrent results pass through the election
		///////////////////////////////
		// take the most reasonable result
		Object[] best_trySessionId_retObj = null;
		List<String> listQuestionSpliterTrySessionId = new ArrayList<>();
		List<String> listQuestionSpliterRet = new ArrayList<>();
		for (String trySessionId : trySessionId_retObj_map.keySet()) {

			Object[] trySessionId_retObj = trySessionId_retObj_map.get(trySessionId);
			if (trySessionId_retObj[1] != null) {
				// save the first valid default result
				if( best_trySessionId_retObj == null){
					best_trySessionId_retObj = trySessionId_retObj;
				}

				// save trySessionId and the corresponding analysis result
				listQuestionSpliterTrySessionId.add(trySessionId);
				listQuestionSpliterRet.add(JSON.toJSONString(trySessionId_retObj[1], Feature.WriteMapNullValue));
			}
		}

		// start voting
		log.info("{} has {} valid result",sessionId,listQuestionSpliterRet.size());
		SplitGrouper SplitGrouper = new SplitGrouper();
		List<List<Integer>> groupRet = SplitGrouper.group(listQuestionSpliterRet);
		if(groupRet != null && groupRet.size()>0 && groupRet.get(0).size() >0){
			int index = groupRet.get(0).get(0);
			String trySessionId = listQuestionSpliterTrySessionId.get(index);
			best_trySessionId_retObj = trySessionId_retObj_map.get(trySessionId);
			log.info("SplitGrouper result: {}",groupRet.toString());
		}


    	JSONObject retObj = (JSONObject)best_trySessionId_retObj[1];
		String userMessage = (String)best_trySessionId_retObj[2];
		String userMessageWithoutExample = (String)best_trySessionId_retObj[3];
		
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
    	Map<String, String> classShowNameMap = new HashMap<String, String>();
    	for (Map<String, Object> classDef : classDefs) {
    		classShowNameMap.put((String)classDef.get("className"), (String)classDef.get("showName"));
    	}
		if (retObj.getJSONArray("subQueries") != null && retObj.getJSONArray("subQueries").size() > 0) {
			// evaluate the question analyst answer
			checkService.evaluateQuestionSpliter(sessionId, question, userMessage, userMessageWithoutExample, retObj, user.getDomainId());
			
			JSONArray subQueries = retObj.getJSONArray("subQueries");
			JSONObject splitPayload = new JSONObject();
			splitPayload.put("question", question);
			splitPayload.put("subQueries", subQueries);
			splitPayload.put("finalCalculation", retObj.getString("finalCalculation"));
			DiagnosticEventLogger.emit("question.split.completed", sessionId, splitPayload);
			// overall question pending review
			checkService.addQuestion(sessionId, question, subQueries.size(), retObj.getString("finalCalculation") != null && !"".equals(retObj.getString("finalCalculation").trim()) ? 1 : 0, lang, user.getDomainId());
			// create a new ABC task
			ABCTask abcTask = new ABCTask();
			abcTask.setSessionId(sessionId);
			abcTask.setAskFinished(false);
			abcTask.setCreateTimestamp(System.currentTimeMillis());
			abcTaskDao.save(abcTask);
			// execute the sub-query
			for (int i = 0; i < subQueries.size(); i++) {
				JSONObject subQuery = subQueries.getJSONObject(i);
				JSONObject subGraph = subQuery.getJSONObject("subgraph");
				JSONObject showSubGraph = JSONObject.parseObject(JSON.toJSONString(subGraph, Feature.WriteMapNullValue));
				JSONArray paths = showSubGraph.getJSONArray("path");
				for (int j = 0; j < paths.size(); j++) {
					JSONObject path = paths.getJSONObject(j);
					String showSource = classShowNameMap.get(path.getString("source").trim());
					if (showSource != null) {
						path.put("source", showSource);
					}
					String showTarget = classShowNameMap.get(path.getString("target").trim());
					if (showTarget != null) {
						path.put("target", showTarget);
					}
				}
				JSONArray nodes = showSubGraph.getJSONArray("nodes");
				for (int j = 0; j < nodes.size(); j++) {
					JSONObject node = nodes.getJSONObject(j);
					String showNode = classShowNameMap.get(node.getString("node").trim());
					if (showNode != null) {
						node.put("node", showNode);
					}
				}
				subQuery.put("showSubGraph", showSubGraph);
				SseEmitterUtil.sendSseEmitter(sessionId, subQuery.toString());
				log.info("return sse [" + sessionId + "]: " + subQuery.toString());
				finalSubQueries.add(JSONObject.parseObject(JSON.toJSONString(subQuery, Feature.WriteMapNullValue)));
				if (i == subQueries.size() - 1 && (retObj.getString("finalCalculation") == null || "".equals(retObj.getString("finalCalculation").trim()))) {
					subQuery.put("finish", true);
				}
				ABCSubQueryTask abcSubQueryTask = new ABCSubQueryTask();
				abcSubQueryTask.setId(UUID.randomUUID().toString());
				abcSubQueryTask.setSessionId(sessionId);
				abcSubQueryTask.setQuestion(question);
				abcSubQueryTask.setSubQuery(subQuery);
				abcSubQueryTask.setType(ABCSubQueryTask.DSL_TYPE);
				abcSubQueryTask.setIndex(i);
				abcSubQueryTask.setReturnNodeIds(returnNodeIds);
				abcSubQueryTask.setReturnSSE(false);
				abcSubQueryTask.setPermission(curUserDataPermission);
				abcSubQueryTaskDao.save(abcSubQueryTask, true);
				ABCDslSubQueryExecutor executor = new ABCDslSubQueryExecutor(
						abcSubQueryTask,
						this, 
						checkService,
						adminService,
						afterCalculateService,
						vectorResourceDao,
						abcSubQueryTaskDao,
						dataRagConfig,
						businessConfig,
						dataAdapterRegistry,
						lang,
						user.getDomainId()
				);
				subQueryExecutorService.execute(executor);
				try {
					Thread.sleep(10);
				} catch (Exception e) {}
			}
			// execute the post-calculation
			if (retObj.getString("finalCalculation") != null && !"".equals(retObj.getString("finalCalculation").trim())) {
				JSONObject finalCalculation = new JSONObject();
				finalCalculation.put("subQuestion", retObj.getString("finalCalculation").trim());
				SseEmitterUtil.sendSseEmitter(sessionId, finalCalculation.toString());
				log.info("return sse [" + sessionId + "]: " + finalCalculation.toString());
				finalSubQueries.add(JSONObject.parseObject(JSON.toJSONString(finalCalculation, Feature.WriteMapNullValue)));
				finalCalculation.put("finish", true);
				
				ABCSubQueryTask afterCalculateSubQueryTask = new ABCSubQueryTask();
				afterCalculateSubQueryTask.setId(UUID.randomUUID().toString());
				afterCalculateSubQueryTask.setSessionId(sessionId);
				afterCalculateSubQueryTask.setQuestion(question);
				afterCalculateSubQueryTask.setSubQuery(finalCalculation);
				afterCalculateSubQueryTask.setType(ABCSubQueryTask.AFTER_CALCULATE_TYPE);
				afterCalculateSubQueryTask.setIndex(finalSubQueries.size() - 1);
				afterCalculateSubQueryTask.setReturnNodeIds(returnNodeIds);
				afterCalculateSubQueryTask.setReturnSSE(false);
				afterCalculateSubQueryTask.setPermission(curUserDataPermission);
				abcSubQueryTaskDao.save(afterCalculateSubQueryTask, true);
				ABCAfterCalculateSubQueryExecutor executor = new ABCAfterCalculateSubQueryExecutor(
						afterCalculateSubQueryTask,
						afterCalculateService,
						pythonCalculatorService,
						checkService,
						abcSubQueryTaskDao,
						dataRagConfig,
						lang,
						user.getDomainId()
				);
				subQueryExecutorService.execute(executor);
			}
			abcTask.setAskFinished(true);
			abcTaskDao.save(abcTask);
		}
		
    	JSONObject ret = new JSONObject();
    	ret.put("subQueries", finalSubQueries);

		log.info("[" + sessionId + "] >>> question split into: {}",ret.toJSONString());
    	return ret;
    }
    
    @Override
    public Map<String,Object> getM3Data(String queryJson, UserDataPermission permission, String domainId) {
    	Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    	BusinessConfig businessConfig = businessConfigService.get(domainId);
		DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), queryJson, null, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
		return results[1].rawResponse();
    }
    
    @Override
    public JSONArray getMidSet(JSONObject dsl, UserDataPermission permission, String domainId) {
    	try {
    		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
    		while (steps.size() > 1) {
    			steps.remove(steps.size() - 1);
    		}
    		JSONObject firstStep = steps.getJSONObject(0);
    		JSONObject firstOutput = firstStep.getJSONObject("output");
    		firstOutput.put("to_user", true);
    		firstOutput.remove("save_table");
    		
    		Map<String, String> variableClassMap = new HashMap<String, String>();
    		JSONArray firstObjects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
    		for (int i = 0; i < firstObjects.size(); i++) {
    			JSONObject object = firstObjects.getJSONObject(i);
    			variableClassMap.put(object.getString("variable"), object.getString("class"));
    		}
    		Set<String> asSet = new HashSet<String>();
    		Map<String, Set<String>> variableAttrMap = new HashMap<String, Set<String>>();
    		JSONArray firstOutputFields = firstOutput.getJSONArray("fields");
    		for (int i = 0; i < firstOutputFields.size(); i++) {
    			JSONObject field = firstOutputFields.getJSONObject(i);
    			String variable = field.getString("variable");
    			Set<String> attrs = variableAttrMap.get(variable);
				if (attrs == null) {
					attrs = new HashSet<String>();
					variableAttrMap.put(variable, attrs);
				}
				attrs.add(field.getString("field"));
				asSet.add(field.getString("as"));
    		}
    		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
    		for (String variable : variableAttrMap.keySet()) {
    			Set<String> attrs = variableAttrMap.get(variable);
    			String className = variableClassMap.get(variable);
    			Map<String, Object> classDef = null;
    			for (Map<String, Object> def : classDefs) {
    				if (className.equals(def.get("className"))) {
    					classDef = def;
    					break;
    				}
    			}
    			if (classDef != null) {
    				for (Map<String, Object> attr : (List<Map<String, Object>>)classDef.get("attrs")) {
    					if (attr.containsKey("bizzkey") && attr.get("bizzkey") != null && (Boolean)attr.get("bizzkey")) {
    						String attrName = (String)attr.get("name");
    						if (!attrs.contains(attrName)) {
    							JSONObject field = new JSONObject();
								field.put("variable", variable);
								field.put("field", attrName);
								String as = className.replace("/", "_") + "_" + attrName + "_0";
								while (asSet.contains(as)) {
									String letter = as.substring(0, as.lastIndexOf("_"));
									Integer number = Integer.parseInt(as.substring(as.lastIndexOf("_" + 1)));
									as = letter + "_" + (number + 1);
								}
								asSet.add(as);
								field.put("as", as);
								firstOutputFields.add(field);
    						}
    					}
    				}
    			}
    		}
    		
    		JSONArray dsls = new JSONArray();
    		dsls.add(dsl);
    		BusinessConfig businessConfig = businessConfigService.get(domainId);
			DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), null, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
			Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
    		JSONObject rowPermissionDataMapJson = JSONObject.parseObject(JSON.toJSONString(rowPermissionDataMap, Feature.WriteMapNullValue));
    		JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(rowPermissionDataMapJson, permission, classDefs);
    		
    		if (rowColPermissionDataMap.getJSONArray("data") != null
    				&& rowColPermissionDataMap.getJSONArray("data").size() > 0
    				&& rowColPermissionDataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer") != null) {
    			return rowColPermissionDataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer");
    		} else {
    			return new JSONArray();
    		}
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		return new JSONArray();
    	}
    }
    
    @Override
    public Integer getTaskCountInQueue() {
    	try {
    		List<ABCTask> tasks = abcTaskDao.queryList();
    		return tasks.size();
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		return -1;
    	}
    }
    
    @Override
    public void saveCard(Map<String, Object> input, String lang, String domainId) {
    	saveCardExecutorService.execute(new Runnable() {
			@Override
			public void run() {
				try {
					String sessionId = (String)input.get("sessionId");
					JSONObject dsl = (JSONObject)input.get("dsl");
					JSONObject subQuery = (JSONObject)input.get("subQuery");
					String question = subQuery.getString("subQuestion");
					Integer index = (Integer)input.get("index");
					
					// get the evaluation result of the DSL content
					DslCookerEvaluation evaluation = null;
					Long timeout = 5 * 60 * 1000L;
					Long times = 30L;
					for (int i = 0; i < times; i++) {
						if (BackendSessionEntrance.isCancelled(sessionId)) {
							throw new SessionCancelledException(sessionId);
						}
						evaluation = checkService.getDslCookerEvaluation(sessionId, index);
						if (evaluation != null) {
							break;
						} else {
							try {
								Thread.sleep(timeout / times);
							} catch (Exception e) {}
						}
					}
					
					// only consider generating a question card if the evaluation passed
					if (evaluation != null && evaluation.getPass()) {
						// generate the question card
						log.info("start generate question card: " + sessionId);
						try {
							// function-metricView
							Function function = functionService.generateFromDsl(question, JSONObject.parseObject(JSON.toJSONString(dsl, Feature.WriteMapNullValue)), lang, domainId, BackendSessionEntrance.derive(sessionId, "savecard-dsl-" + index));
							if (function != null) {
								function = functionService.save(function, lang);
								MetricView metricView = metricViewService.generateFromFunction(function);
								metricView.setType(MetricView.TYPE_GENERAL);
								Set<String> matchQuestions = new HashSet<String>();
								matchQuestions.add(question);
								metricView.setMatchQuestions(matchQuestions);
								// wait for the quality check to finish and enrich the quality check result
								List<JSONObject> checkResult = checkService.queryBySessionId(sessionId, null, 30 * 60 * 1000L);
								if (checkResult != null && checkResult.size() > 0) {
									JSONObject cr = checkResult.get(checkResult.size() - 1);
									if (cr.getDouble("score") != null) {
										OriginCheckResult originCheckResult = new OriginCheckResult();
										originCheckResult.setScore(cr.getDouble("score"));
										originCheckResult.setConclusion(cr.getString("conclusion"));
										originCheckResult.setFittedQuestion(cr.getString("fittedQuestion"));
										metricView.setOriginCheckResult(originCheckResult);
									}
								}
								metricView.setOriginQuestion(question);
								metricViewService.save(metricView, lang);
								// convert to the dedicated metricView
								Function staticFunction = functionService.generateStaticFromGeneral(question, function.getParameters(), function, lang, BackendSessionEntrance.derive(sessionId, "savecard-static-" + index));
								if (staticFunction != null) {
									staticFunction = functionService.save(staticFunction, lang);
									MetricView staticMetricView = metricViewService.generateFromFunction(staticFunction);
									staticMetricView.setType(MetricView.TYPE_STATIC);
									staticMetricView.setMatchQuestions(matchQuestions);
									staticMetricView.setOriginCheckResult(metricView.getOriginCheckResult());
									staticMetricView.setOriginQuestion(metricView.getOriginQuestion());
									metricViewService.save(staticMetricView, lang);
								}
							}
						} catch (SessionCancelledException e) {
							// cancellation is not an ordinary failure: end quietly, do not log an error, and do not continue with function capture.
							log.info("skip generate question card, session cancelled: " + sessionId + "    " + index);
							return;
						} catch (Exception e) {
							log.error(e.getMessage(), e);
						}
					} else {
						// the evaluation result did not pass
						log.info("do not generate question card: " + sessionId + "    " + index);
					}
				} catch (SessionCancelledException e) {
					log.info("skip saveCard, session cancelled: " + input.get("sessionId") + "    " + input.get("index"));
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
    	});
    }

}
