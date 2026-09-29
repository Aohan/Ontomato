package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.ontomato.dataengine.dao.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorEvaluation;
import io.ontomato.dataengine.bean.CheckAfterCalculateTask;
import io.ontomato.dataengine.bean.CheckSubQueryTask;
import io.ontomato.dataengine.bean.CheckTask;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.bean.DslCookerEvaluation.Illegal;
import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.QuestionSpliterEvaluation;
import io.ontomato.dataengine.bean.QuestionSpliterEvaluation.SubQueryConclusion;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.JSONCorrector;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.util.SseEmitterUtil;
import io.ontomato.dataengine.util.UserMessageUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class CheckServiceImpl implements CheckService {
	
	@Autowired
    private JSONCorrector jsonCorrector;
	
	@Autowired
	private LangService langService;
	
	@Autowired
	private CheckDao checkDao;

	@Autowired
	private KnowledgeDao knowledgeDao;

	@Autowired
	private BussinessExampleDao bussinessExampleDao;
	
	@Autowired
	private BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao;
	
	@Autowired
	private EvaluationDao evaluationDao;
	
	@Autowired
    DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private MultiThreadAIChatService multiThreadAIChatService;
	
	@PostConstruct
	public void initService() {
		// Check task
		new Thread(new Runnable() {
			@Override
			public void run() {
				while (true) {
					try {
						List<CheckTask> tasks = checkDao.readTasks();
						for (CheckTask task : tasks) {
							if (task.getCreateTimestamp() < System.currentTimeMillis() - 60 * 60 * 1000L) {
								// delete tasks older than one hour
								log.info("delete check task: " + task.getId());
								checkDao.deleteTask(task.getId(), true);
							} else {
								// tasks that have not finished checking
								if (dataRagConfig.getServiceId().equals(task.getServiceId())) {
									if (!CheckTask.STATUS_FINISH.equals(task.getStatus())) {
										boolean subQueryFinished = true;
										for (CheckSubQueryTask subQueryTask : task.getSubQueryTasks()) {
											if (subQueryTask == null) {
												subQueryFinished = false;
												break;
											}
										}
										
										if (!subQueryFinished) { // dsl sub-query has not finished checking
											task.setStatus(CheckTask.STATUS_SUB_QUERY_CHECKING);
											checkDao.writeTask(task, task.getDomainId());
										} else { // dsl sub-query has finished checking
											CheckTask curTask = checkDao.readTask(task.getId());
											if (curTask != null) {
												boolean afterCalculateAddFinished = true;
												boolean afterCalculateCheckFinished = true;
												for (CheckAfterCalculateTask afterCalculateTask : curTask.getAfterCalculateTasks()) {
													if (afterCalculateTask == null) {
														afterCalculateAddFinished = false;
													} else if (afterCalculateTask != null && afterCalculateTask.getMeaning() == null) {
														afterCalculateCheckFinished = false;
													}
												}
												
												if (afterCalculateAddFinished) { // the post-calculation parameters to be checked are ready
													if (!afterCalculateCheckFinished) { // post-calculation has not finished checking
														if (!CheckTask.STATUS_AFTER_CALCULATE_CHECKING.equals(curTask.getStatus()) 
																&& !CheckTask.STATUS_FINAL_CHECKING.equals(curTask.getStatus())
																&& !CheckTask.STATUS_FINISH.equals(curTask.getStatus())) { // start checking the post-calculation
															curTask.setStatus(CheckTask.STATUS_AFTER_CALCULATE_CHECKING);
															checkDao.writeTask(curTask, curTask.getDomainId());
															new Thread(new Runnable() {
																@Override
																public void run() {
																	checksAfterCalculateTask(curTask, curTask.getLang());
																}
															}).start();
														}
													} else { // post-calculation has finished checking
														if (!CheckTask.STATUS_FINAL_CHECKING.equals(curTask.getStatus())
																&& !CheckTask.STATUS_FINISH.equals(curTask.getStatus())) { // start the final check
															curTask.setStatus(CheckTask.STATUS_FINAL_CHECKING);
															checkDao.writeTask(curTask, curTask.getDomainId());
															new Thread(new Runnable() {
																@Override
																public void run() {
																	checksFinalTask(curTask);
																}
															}).start();
														}
													}
												}
											}
										}
									}
								}
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					
					try {
						Thread.sleep(1000);
					} catch (Exception e) {}
				}
			}
		}).start();
		
		// Evaluation task
		new Thread(new Runnable() {
			@Override
			public void run() {
				while (true) {
					try {
						// delete evaluation results older than two weeks
						List<File> taskDirs = evaluationDao.readEvaluationDirs();
						for (File taskDir : taskDirs) {
							if (taskDir.lastModified() < System.currentTimeMillis() - 14 * 24 * 60 * 60 * 1000L) {
								evaluationDao.deleteEvaluation(taskDir.getName());
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					
					try {
						Thread.sleep(60 * 60 * 1000L);
					} catch (Exception e) {}
				}
			}
		}).start();
	}
	
	@Override
	public void addQuestion(String sessionId, String question, int subQuerySize, int afterCalculateSize, String lang, String domainId) {
		log.info("add check task: " + sessionId);
		CheckTask task = new CheckTask();
		task.setId(sessionId);
		task.setQuestion(question);
		task.setSubQueryTasks(new CheckSubQueryTask[subQuerySize]);
		task.setAfterCalculateTasks(new CheckAfterCalculateTask[afterCalculateSize]);
		task.setCreateTimestamp(System.currentTimeMillis());
		task.setStatus(CheckTask.STATUS_CREATE);
		task.setServiceId(dataRagConfig.getServiceId());
		task.setLang(lang);
		checkDao.writeTask(task, domainId);
	}

	@Override
	public void fromDslToLogicText(String sessionId, int subQueryIndex, String dslStr, Map<String, Object> jsonRule, String lang, String domainId) {
		CheckTask task = checkDao.readTask(sessionId);
		if (task != null && task.getSubQueryTasks() != null && subQueryIndex >= 0 && subQueryIndex < task.getSubQueryTasks().length) {
			log.info("fromDslToLogicText: " + sessionId + "    " + subQueryIndex);
			String inputDslStr = "This is an illegal DSL:\n```json\n" + dslStr + "\n```\n";
			List<String> classes = new ArrayList<String>();
			try {
				JSONArray dsls = JSON.parseArray(dslStr);
				for (int i = 0; i < dsls.size(); i++) {
					JSONObject dsl = dsls.getJSONObject(i);
					dsl.remove("problem");
					JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
					JSONObject firstStep = steps.getJSONObject(0);
					JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
					for (int j = 0; j < objects.size(); j++) {
						JSONObject object = objects.getJSONObject(j);
						String className = object.getString("class");
						if (className != null && !classes.contains(className)) {
							classes.add(className);
						}
					}
				}
				if (classes.size() > 0) {
					inputDslStr = "```json\n" + JSON.toJSONString(dsls.getJSONObject(0), JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue) + "\n```\n";
				}
			} catch (Exception e) {}
			BusinessConfig businessConfig = businessConfigService.get(domainId);
			String userMessage = UserMessageUtil.getDslDescriberUserMessage(sessionId, inputDslStr, classes, dataAdapterRegistry.create(businessConfig, null), jsonRule, lang, langService);
			
			OriginalQuestion originalQuestion = new OriginalQuestion();
			originalQuestion.setId(sessionId);
			String str = multiThreadAIChatService.chat(
					MultiThreadAIChatService.DSL_DESCRIBER,
					originalQuestion,
					BackendSessionEntrance.derive(sessionId, "dsl-describer-" + subQueryIndex),
					userMessage,
					ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
					domainId
			).trim();
			if (str.startsWith("```markdown")) {
				str = str.substring(11);
				if (str.endsWith("```")) {
					str = str.substring(0, str.length() - 3);
				}
			}
			String logic = "";
			String summary = "";
			if (str.lastIndexOf("<summary>") >= 0) {
				logic = str.substring(0, str.lastIndexOf("<summary>"));
				summary = str.substring(str.lastIndexOf("<summary>") + 9);
				if (summary.lastIndexOf("</summary>") >= 0) {
					summary = summary.substring(0, summary.lastIndexOf("</summary>"));
				}
	    	}
			
			CheckSubQueryTask subQueryTask = new CheckSubQueryTask();
			subQueryTask.setDslStr(inputDslStr);
			subQueryTask.setSummary(summary);
			subQueryTask.setMeaning(logic);
			checkDao.addSubQueryTask(sessionId, subQueryIndex, subQueryTask);
			log.info("fromDslToLogicText finish: " + sessionId + "    " + subQueryIndex);
		}
	}

	@Override
	public void fromAfterCalculateLogicToLogicText(String sessionId, int afterCalculateIndex,
			String afterCalculateLogic, List<String> cacheFilePaths) {
		CheckTask task = checkDao.readTask(sessionId);
		if (task != null && task.getAfterCalculateTasks() != null && afterCalculateIndex >= 0 && afterCalculateIndex < task.getAfterCalculateTasks().length) {
			log.info("fromAfterCalculateLogicToLogicText: " + sessionId + "    " + afterCalculateIndex);
			CheckAfterCalculateTask afterCalculateTask = new CheckAfterCalculateTask();
			afterCalculateTask.setLogic(afterCalculateLogic);
			afterCalculateTask.setCacheFilePaths(cacheFilePaths);
			checkDao.writeAfterCalculateTask(sessionId, afterCalculateIndex, afterCalculateTask);
			log.info("fromAfterCalculateLogicToLogicText finish: " + sessionId + "    " + afterCalculateIndex);
		}
		
	}
	
	private void checksAfterCalculateTask(CheckTask task, String lang) {
		log.info("checksAfterCalculateTask: " + task.getId() + "    0");
		List<String> dslMeanings = new ArrayList<String>();
		for (CheckSubQueryTask subQueryTask : task.getSubQueryTasks()) {
			dslMeanings.add(subQueryTask.getMeaning());
		}
		CheckAfterCalculateTask afterCalculateTask = task.getAfterCalculateTasks()[0];
		String userMessage = UserMessageUtil.getAfterCalculateDescriberUserMessage(task.getId(), afterCalculateTask.getLogic(), afterCalculateTask.getCacheFilePaths(), dslMeanings, lang, langService);
		
		BusinessConfig businessConfig = businessConfigService.get(task.getDomainId());
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(task.getId());
		String str = multiThreadAIChatService.chat(
				MultiThreadAIChatService.AFTER_CALCULATE_DESCRIBER,
				originalQuestion,
				BackendSessionEntrance.derive(task.getId(), "after-calc-describer"),
				userMessage,
				ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
				task.getDomainId()
		);
		if (str.startsWith("```markdown")) {
			str = str.substring(11);
			if (str.endsWith("```")) {
				str = str.substring(0, str.length() - 3);
			}
		}
		String logic = "";
		String summary = "";
		if (str.lastIndexOf("<summary>") >= 0) {
			logic = str.substring(0, str.lastIndexOf("<summary>"));
			summary = str.substring(str.lastIndexOf("<summary>") + 9);
			if (summary.lastIndexOf("</summary>") >= 0) {
				summary = summary.substring(0, summary.lastIndexOf("</summary>"));
			}
    	}
		
		afterCalculateTask.setSummary(summary);
		afterCalculateTask.setMeaning(logic);
		checkDao.writeAfterCalculateTask(task.getId(), 0, afterCalculateTask);
		log.info("checksAfterCalculateTask finish: " + task.getId() + "    0");
	}
	
	private void checksFinalTask(CheckTask task) {
		log.info("checksFinalTask: " + task.getId());
		List<String> dslMeanings = new ArrayList<String>();
		for (CheckSubQueryTask subQueryTask : task.getSubQueryTasks()) {
			dslMeanings.add(subQueryTask.getMeaning());
		}
		String afterCalculateMeaning = null;
		if (task.getAfterCalculateTasks().length > 0) {
			afterCalculateMeaning = task.getAfterCalculateTasks()[0].getMeaning();
		}
		String userMessage = UserMessageUtil.getQuestionCheckerUserMessage(task.getQuestion(),task.getQuestion(), dslMeanings, afterCalculateMeaning,
				knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao, businessConfigService,
				task.getLang(), langService, task.getDomainId());
		
		BusinessConfig businessConfig = businessConfigService.get(task.getDomainId());
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(task.getId());
		String str = multiThreadAIChatService.chat(
				MultiThreadAIChatService.QUESTION_CHECKER,
				originalQuestion,
				BackendSessionEntrance.derive(task.getId(), "question-checker"),
				userMessage,
				ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
				task.getDomainId()
		);
		if (str.startsWith("```markdown")) {
			str = str.substring(11);
			if (str.endsWith("```")) {
				str = str.substring(0, str.length() - 3);
			}
		}
		String conclusion = "";
		String scoreStr = "";
		String fittedQuestion = "";
		if (str.lastIndexOf("<score>") >= 0) {
			conclusion = str.substring(0, str.lastIndexOf("<score>"));
			scoreStr = str.substring(str.lastIndexOf("<score>") + 7);
			if (scoreStr.lastIndexOf("</score>") >= 0) {
				scoreStr = scoreStr.substring(0, scoreStr.lastIndexOf("</score>"));
			}
    	}
		if (str.lastIndexOf("<fitted_question>") >= 0) {
			fittedQuestion = str.substring(str.lastIndexOf("<fitted_question>") + 17);
			if (fittedQuestion.lastIndexOf("</fitted_question>") >= 0) {
				fittedQuestion = fittedQuestion.substring(0, fittedQuestion.lastIndexOf("</fitted_question>"));
			}
    	}
		if (fittedQuestion.startsWith("\n")) {
			fittedQuestion = fittedQuestion.substring(1);
		}
		if (fittedQuestion.endsWith("\n")) {
			fittedQuestion = fittedQuestion.substring(0, fittedQuestion.length() - 1);
		}
		Double score = 0D;
		try {
			score = Double.parseDouble(scoreStr);
		} catch (Exception e) {}
		
		task.setStatus(CheckTask.STATUS_FINISH);
		task.setConclusion(conclusion);
		task.setScore(score);
		task.setFittedQuestion(fittedQuestion);
		checkDao.writeTask(task, task.getDomainId());
		log.info("checksFinalTask finish: " + task.getId());
	}
	
	@Override
	public List<JSONObject> queryBySessionId(String sessionId, String sseId, Long timeout) {
		CheckTask task = null;
		List<JSONObject> toSseContents = new ArrayList<JSONObject>();
		Long now = System.currentTimeMillis();
		while (true) {
			if (BackendSessionEntrance.isCancelled(sessionId)) {
				throw new SessionCancelledException(sessionId);
			}
			task = checkDao.readTask(sessionId);
			if (task != null) {
				int index = toSseContents.size();
				CheckSubQueryTask[] subQueryTasks = task.getSubQueryTasks();
				CheckAfterCalculateTask[] afterCalculateTasks = task.getAfterCalculateTasks();
				if (index < subQueryTasks.length) {
					CheckSubQueryTask subQueryTask = subQueryTasks[index];
					if (subQueryTask != null) {
						JSONObject toSseContent = new JSONObject();
						toSseContent.put("summary", subQueryTask.getSummary());
						toSseContent.put("meaning", subQueryTask.getMeaning());
						toSseContents.add(toSseContent);
						if (sseId != null) {
							SseEmitterUtil.sendSseEmitter(sseId, JSON.toJSONString(toSseContent));
						}
					}
				} else if (index >= subQueryTasks.length && index < subQueryTasks.length + afterCalculateTasks.length) {
					CheckAfterCalculateTask afterCalculateTask = afterCalculateTasks[index - subQueryTasks.length];
					if (afterCalculateTask != null && afterCalculateTask.getMeaning() != null) {
						JSONObject toSseContent = new JSONObject();
						toSseContent.put("summary", afterCalculateTask.getSummary());
						toSseContent.put("meaning", afterCalculateTask.getMeaning());
						toSseContents.add(toSseContent);
						if (sseId != null) {
							SseEmitterUtil.sendSseEmitter(sseId, JSON.toJSONString(toSseContent));
						}
					}
				} else {
					if (task.getConclusion() != null) {
						JSONObject toSseContent = new JSONObject();
						toSseContent.put("conclusion", task.getConclusion());
						toSseContent.put("score", task.getScore());
						toSseContent.put("fittedQuestion", task.getFittedQuestion());
						toSseContents.add(toSseContent);
						if (sseId != null) {
							SseEmitterUtil.sendSseEmitter(sseId, JSON.toJSONString(toSseContent));
						}
						break;
					}
				}
			} else {
				break;
			}
			if (timeout != null && timeout > 0) {
				if (System.currentTimeMillis() - now > timeout) {
					break;
				}
			}
			try {
				Thread.sleep(5000);
			} catch (Exception e) {}
		}
		return toSseContents;
	}
	
	@Override
	public void evaluateQuestionSpliter(
			String sessionId, 
			String question,
			String userMessage,
			String userMessageWithoutExample,
			JSONObject answerObj,
			String domainId) {
		new Thread(new Runnable() {
			@Override
			public void run() {
				try {
					// input
					QuestionSpliterEvaluation evaluation = new QuestionSpliterEvaluation();
					evaluation.setSessionId(sessionId);
					evaluation.setQuestion(question);
					evaluation.setUserMessage(userMessage);
					evaluation.setUserMessageWithoutExample(userMessageWithoutExample);
					evaluation.setAnswerObj(answerObj);
					
					// call the LLM
					BusinessConfig businessConfig = businessConfigService.get(domainId);
					String userMessage = UserMessageUtil.getQuestionSpliterEvaluatorUserMessage(evaluation);
					OriginalQuestion originalQuestion = new OriginalQuestion();
					originalQuestion.setId(sessionId);
					String retStr = multiThreadAIChatService.chat(
							MultiThreadAIChatService.QUESTION_SPLITER_EVALUATOR,
							originalQuestion,
							BackendSessionEntrance.derive(sessionId, "spliter-evaluator"),
							userMessage,
							ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
							domainId);
					if (retStr.indexOf("```json") >= 0) {
			    		retStr = retStr.substring(retStr.indexOf("```json") + 7);
						if (retStr.lastIndexOf("```") > 0) {
							retStr = retStr.substring(0, retStr.lastIndexOf("```"));
						}
			    	}
					JSONObject retObj = jsonCorrector.parseObject(retStr, domainId, BackendSessionEntrance.derive(sessionId, "spliter-evaluator"));
					
					// subQuery evaluation
					JSONArray subQueryConclusionArray = retObj.getJSONArray("subQueryConclusions");
					JSONArray subQueries = answerObj.getJSONArray("subQueries");
					Boolean subQueryOk = true;
					// depend evaluation
					Boolean dependOk = true;
					List<SubQueryConclusion> subQueryConclusions = new ArrayList<SubQueryConclusion>();
					for (int i = 0; i < subQueries.size(); i++) {
						JSONObject subQueryConclusionObj = subQueryConclusionArray.getJSONObject(i);
						SubQueryConclusion subQueryConclusion = evaluation.new SubQueryConclusion();
						subQueryConclusion.setPass(subQueryConclusionObj.getBoolean("pass"));
						subQueryConclusion.setConclusion(subQueryConclusionObj.getString("conclusion"));
						JSONArray dependOnIndexArray = subQueryConclusionObj.getJSONArray("dependOnIndexes");
						List<Integer> dependOnIndexes = new ArrayList<Integer>();
						for (int j = 0; j < dependOnIndexArray.size(); j++) {
							Integer dependOnIndex = dependOnIndexArray.getInteger(j);
							if (dependOnIndex < 0 || dependOnIndex >= i) {
								throw new Exception("sub-query dependency evaluation error");
							}
							dependOnIndexes.add(dependOnIndex);
						}
						subQueryConclusion.setDependOnIndexes(dependOnIndexes);
						subQueryConclusions.add(subQueryConclusion);
						
						if (!subQueryConclusion.getPass()) {
							subQueryOk = false;
						}
						if (dependOnIndexes.size() > 0) {
							dependOk = false;
						}
					}
					evaluation.setSubQueryOk(subQueryOk);
					evaluation.setSubQueryConclusions(subQueryConclusions);
					evaluation.setDependOk(dependOk);
					
					// coverLogic evaluation
					evaluation.setCoverLogicOk(retObj.getBoolean("coverLogicOk"));
					evaluation.setCoverLogicConclusion(retObj.getString("coverLogicConclusion"));
					
					// persist
					evaluationDao.saveQuestionSpliterEvaluation(evaluation);
				} catch (SessionCancelledException e) {
					// cancellation is not an ordinary failure: do not log an error, do not write to disk, the thread ends silently.
					log.info("skip check evaluation, session cancelled: " + e.getSessionId());
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}).start();
	}
	
	@Override
	public void evaluateDslCooker(DslCookerEvaluation evaluation, int index, String domainId) {
		new Thread(new Runnable() {
			@Override
			public void run() {
				try {
					// use the LLM evaluator to validate GROUPBY, HAVING, FUNCTION, COVER_LOGIC
					BusinessConfig businessConfig = businessConfigService.get(domainId);
					String userMessage = UserMessageUtil.getDslCookerEvaluatorUserMessage(evaluation);
					OriginalQuestion originalQuestion = new OriginalQuestion();
					originalQuestion.setId(evaluation.getSessionId());
					String retStr = multiThreadAIChatService.chat(
							MultiThreadAIChatService.DSL_COOKER_EVALUATOR,
							originalQuestion,
							BackendSessionEntrance.derive(evaluation.getSessionId(), "dsl-evaluator-" + index),
							userMessage,
							ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
							domainId);
					if (retStr.indexOf("```json") >= 0) {
			    		retStr = retStr.substring(retStr.indexOf("```json") + 7);
						if (retStr.lastIndexOf("```") > 0) {
							retStr = retStr.substring(0, retStr.lastIndexOf("```"));
						}
			    	}
					JSONObject retObj = jsonCorrector.parseObject(retStr, domainId, BackendSessionEntrance.derive(evaluation.getSessionId(), "dsl-evaluator-" + index));
					
					List<Illegal> illegals = evaluation.getIllegals();
					if (retObj.getString(DslCookerEvaluation.GROUPBY_ILLEGAL_TYPE) != null && !"".equals(retObj.getString(DslCookerEvaluation.GROUPBY_ILLEGAL_TYPE).trim())) {
						Illegal illegal = evaluation.new Illegal();
						illegal.setType(DslCookerEvaluation.GROUPBY_ILLEGAL_TYPE);
						illegal.setConclusion(retObj.getString(DslCookerEvaluation.GROUPBY_ILLEGAL_TYPE).trim());
						illegals.add(illegal);
					}
					if (retObj.getString(DslCookerEvaluation.HAVING_ILLEGAL_TYPE) != null && !"".equals(retObj.getString(DslCookerEvaluation.HAVING_ILLEGAL_TYPE).trim())) {
						Illegal illegal = evaluation.new Illegal();
						illegal.setType(DslCookerEvaluation.HAVING_ILLEGAL_TYPE);
						illegal.setConclusion(retObj.getString(DslCookerEvaluation.HAVING_ILLEGAL_TYPE).trim());
						illegals.add(illegal);
					}
					if (retObj.getString(DslCookerEvaluation.FUNCTION_ILLEGAL_TYPE) != null && !"".equals(retObj.getString(DslCookerEvaluation.FUNCTION_ILLEGAL_TYPE).trim())) {
						Illegal illegal = evaluation.new Illegal();
						illegal.setType(DslCookerEvaluation.FUNCTION_ILLEGAL_TYPE);
						illegal.setConclusion(retObj.getString(DslCookerEvaluation.FUNCTION_ILLEGAL_TYPE).trim());
						illegals.add(illegal);
					}
					if (retObj.getString(DslCookerEvaluation.COVER_LOGIC_ILLEGAL_TYPE) != null && !"".equals(retObj.getString(DslCookerEvaluation.COVER_LOGIC_ILLEGAL_TYPE).trim())) {
						Illegal illegal = evaluation.new Illegal();
						illegal.setType(DslCookerEvaluation.COVER_LOGIC_ILLEGAL_TYPE);
						illegal.setConclusion(retObj.getString(DslCookerEvaluation.COVER_LOGIC_ILLEGAL_TYPE).trim());
						illegals.add(illegal);
					}
					evaluation.setIllegals(illegals);
					evaluation.setPass(illegals.size() == 0);
					
					// persist
					evaluationDao.saveDslCookerEvaluation(evaluation, index);
				} catch (SessionCancelledException e) {
					// cancellation is not an ordinary failure: do not log an error, do not write to disk, the thread ends silently.
					log.info("skip check evaluation, session cancelled: " + e.getSessionId());
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}).start();
	}
	
	@Override
	public DslCookerEvaluation getDslCookerEvaluation(String sessionId, Integer index) {
		DslCookerEvaluation evaluation = evaluationDao.readDslCookerEvaluation(sessionId, index);
		return evaluation;
	}
	
	@Override
	public void evaluateAfterCalculator(AfterCalculatorEvaluation evaluation, String domainId) {
		new Thread(new Runnable() {
			@Override
			public void run() {
				try {
					// call the LLM
					BusinessConfig businessConfig = businessConfigService.get(domainId);
					if (AfterCalculatorEvaluation.PYTHON_CALCULATOR_TYPE.equals(evaluation.getCalculatorType())) {
						String userMessage = UserMessageUtil.getPythonCalculatorEvaluatorUserMessage(evaluation);
						OriginalQuestion originalQuestion = new OriginalQuestion();
						originalQuestion.setId(evaluation.getSessionId());
						String retStr = multiThreadAIChatService.chat(
								MultiThreadAIChatService.PYTHON_CALCULATOR_EVALUATOR,
								originalQuestion,
								BackendSessionEntrance.derive(evaluation.getSessionId(), "pycalc-evaluator"),
								userMessage,
								ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
								domainId);
						if (retStr.indexOf("```json") >= 0) {
				    		retStr = retStr.substring(retStr.indexOf("```json") + 7);
							if (retStr.lastIndexOf("```") > 0) {
								retStr = retStr.substring(0, retStr.lastIndexOf("```"));
							}
				    	}
						JSONObject retObj = jsonCorrector.parseObject(retStr, domainId, BackendSessionEntrance.derive(evaluation.getSessionId(), "pycalc-evaluator"));
						
						evaluation.setNotWaitInput(retObj.getBoolean("notWaitInput"));
						evaluation.setOutputOk(retObj.getBoolean("outputOk"));
						evaluation.setCoverLogicOk(retObj.getBoolean("coverLogicOk"));
						evaluation.setCoverLogicConclusion(retObj.getString("coverLogicConclusion"));
						evaluation.setPass(evaluation.getNotWaitInput() && evaluation.getOutputOk() && evaluation.getCoverLogicOk());
					} else if (AfterCalculatorEvaluation.TOOLS_CALCULATOR_TYPE.equals(evaluation.getCalculatorType())) {
						String userMessage = UserMessageUtil.getToolsCalculatorEvaluatorUserMessage(evaluation);
						OriginalQuestion originalQuestion = new OriginalQuestion();
						originalQuestion.setId(evaluation.getSessionId());
						String retStr = multiThreadAIChatService.chat(
								MultiThreadAIChatService.TOOL_CALCULATOR_EVALUATOR,
								originalQuestion,
								BackendSessionEntrance.derive(evaluation.getSessionId(), "toolcalc-evaluator"),
								userMessage,
								ModelResolver.resolve(businessConfig, AgentRole.QUERY, langService),
								domainId);
						if (retStr.indexOf("```json") >= 0) {
				    		retStr = retStr.substring(retStr.indexOf("```json") + 7);
							if (retStr.lastIndexOf("```") > 0) {
								retStr = retStr.substring(0, retStr.lastIndexOf("```"));
							}
				    	}
						JSONObject retObj = jsonCorrector.parseObject(retStr, domainId, BackendSessionEntrance.derive(evaluation.getSessionId(), "toolcalc-evaluator"));
						
						evaluation.setCoverLogicOk(retObj.getBoolean("coverLogicOk"));
						evaluation.setCoverLogicConclusion(retObj.getString("coverLogicConclusion"));
						evaluation.setPass(true && evaluation.getCoverLogicOk());
					}
					
					// persist
					evaluationDao.saveAfterCalculatorEvaluation(evaluation);
				} catch (SessionCancelledException e) {
					// cancellation is not an ordinary failure: do not log an error, do not write to disk, the thread ends silently.
					log.info("skip check evaluation, session cancelled: " + e.getSessionId());
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}).start();
	}

}
