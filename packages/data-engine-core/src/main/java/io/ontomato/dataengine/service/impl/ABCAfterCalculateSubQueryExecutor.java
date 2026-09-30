package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity;
import io.ontomato.dataengine.bean.AfterCalculatorEvaluation;
import io.ontomato.dataengine.bean.AfterCalculatorResult;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.abcQuestion.ABCSubQueryTask;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.ABCSubQueryTaskDao;
import io.ontomato.dataengine.service.AfterCalculateService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.PythonCalculatorService;
import io.ontomato.dataengine.service.SessionCancelledException;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class ABCAfterCalculateSubQueryExecutor implements Runnable {
	
	private ABCSubQueryTask subQueryTask;
	private AfterCalculateService afterCalculateService;
	private PythonCalculatorService pythonCalculatorService;
	private CheckService checkService;
	private ABCSubQueryTaskDao abcSubQueryTaskDao;
	private DataRagConfig dataRagConfig;
	private String lang;
	private String domainId;
	
	public ABCAfterCalculateSubQueryExecutor(
			ABCSubQueryTask subQueryTask,
			AfterCalculateService afterCalculateService,
			PythonCalculatorService pythonCalculatorService,
			CheckService checkService,
			ABCSubQueryTaskDao abcSubQueryTaskDao,
			DataRagConfig dataRagConfig,
			String lang,
			String domainId) {
		this.subQueryTask = subQueryTask;
		this.afterCalculateService = afterCalculateService;
		this.pythonCalculatorService = pythonCalculatorService;
		this.checkService = checkService;
		this.abcSubQueryTaskDao = abcSubQueryTaskDao;
		this.dataRagConfig = dataRagConfig;
		this.lang = lang;
		this.domainId = domainId;
	}

	@Override
	public void run() {
		while (true) {
			if (BackendSessionEntrance.isCancelled(subQueryTask.getSessionId())) {
				log.info(subQueryTask.getSessionId() + " after calculate cancelled, stop waiting");
				return;
			}
			List<ABCSubQueryTask> subQueryTasks = abcSubQueryTaskDao.queryBySessionId(subQueryTask.getSessionId(), false, false);
			if (subQueryTasks.size() > 1) {
				boolean dependency = true;
				for (ABCSubQueryTask t : subQueryTasks) {
					if (ABCSubQueryTask.DSL_TYPE.equals(t.getType()) && t.getDataMap() == null) {
						dependency = false;
						break;
					}
				}
				if (dependency) {
					String sessionId = subQueryTask.getSessionId();
					Integer index = subQueryTask.getIndex();
					
					log.info(sessionId + "    " + index + "    start    " + new Date());
					JSONObject dataMap = new JSONObject();
					List<Map<String, DslConsanguinity>> dslConsanguinityMapList = null;
					List<AfterCalculatorConsanguinity> afterCalculatorConsanguinityList = null;
					
					// Post-calculation content sent for quality check
					String afterCalculateLogic = "";
					List<String> cacheFilePaths = null;
					// Post-calculation
					boolean cancelled = false;
					try {
						boolean dslExecuteError = false;
						boolean allDslResultIsNull = true;
						for (int i = 0; i < subQueryTasks.size() - 1; i++) {
							ABCSubQueryTask subQueryTask = subQueryTasks.get(i);
							Map<String, Object> schemaDef = subQueryTask.getCacheSchemaDef();
							if (schemaDef.get("error") != null && !"".equals(((String)schemaDef.get("error")).trim())) {
								dslExecuteError = true;
								break;
							}
							JSONArray defs = (JSONArray)schemaDef.get("defs");
							if (defs.size() > 0) {
								allDslResultIsNull = false;
							}
						}
						
						JSONObject calculatorSubQuery = subQueryTasks.get(subQueryTasks.size() - 1).getSubQuery();
						String calculatorQuestion = calculatorSubQuery.getString("subQuestion");
						JSONObject expData0 = new JSONObject();
		    			expData0.put("problem", calculatorQuestion);
		    			// Post-calculation content evaluation
						AfterCalculatorEvaluation evaluation = new AfterCalculatorEvaluation();
						evaluation.setSessionId(sessionId);
						evaluation.setQuestion(calculatorQuestion);
						if (dslExecuteError) {
							JSONObject result = new JSONObject();
							result.put("result", "Dependent sub-query execution failed");
							JSONArray results = new JSONArray();
							results.add(result);
							expData0.put("answer", results);
							afterCalculateLogic = "Dependent sub-query execution failed";
							evaluation.setCalculatorType(AfterCalculatorEvaluation.NOT_CALL_TYPE);
							evaluation.setUserMessage(afterCalculateLogic);
							evaluation.setPass(false);
						} else {
							if (allDslResultIsNull) {
								JSONObject result = new JSONObject();
								result.put("result", "No data matching your request");
								JSONArray results = new JSONArray();
								results.add(result);
								expData0.put("answer", results);
								afterCalculateLogic = "The dependent sub-queries failed to query out matching data";
								evaluation.setCalculatorType(AfterCalculatorEvaluation.NOT_CALL_TYPE);
								evaluation.setUserMessage(afterCalculateLogic);
								evaluation.setPass(false);
							} else {
								List<Map> caches = new ArrayList<Map>();
								cacheFilePaths = new ArrayList<String>();
								dslConsanguinityMapList = new ArrayList<Map<String, DslConsanguinity>>();
								for (int i = 0; i < subQueryTasks.size() - 1; i++) {
									ABCSubQueryTask subQueryTask = subQueryTasks.get(i);
									Map<String, Object> schemaDef = subQueryTask.getCacheSchemaDef();
									String subQuestion = subQueryTask.getSubQuery().getString("subQuestion");
									Map<String, Object> cache = new HashMap<String, Object>();
									cache.put("subQuestion", subQuestion);
									log.info("subQuestion: " + subQuestion);
									cache.put("datajsonfile", schemaDef.get("filePath"));
									cache.put("datajsonfileUrl", dataRagConfig.getCardBaseUrl() + "/afterCalculate/cache/" + schemaDef.get("fileName"));
									cacheFilePaths.add((String)schemaDef.get("filePath"));
									log.info("datajsonfile: " + schemaDef.get("filePath"));
									cache.put("jsonschema", schemaDef.get("defs"));
									log.info("jsonschema: " + JSON.toJSONString(schemaDef.get("defs"), JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue));
									cache.put("samples", schemaDef.get("cacheSamples"));
									log.info("samples: " + JSON.toJSONString(schemaDef.get("cacheSamples"), JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue));
									caches.add(cache);
									log.info("cacheDataCount: " + schemaDef.get("cacheDataCount"));
									
									dslConsanguinityMapList.add((Map<String, DslConsanguinity>)schemaDef.get("dslConsanguinityMap"));
								}
								
								log.info("calculatorQuestion: " + calculatorQuestion);
								AfterCalculatorResult result = afterCalculateService.calculate(sessionId, calculatorQuestion, caches, sessionId, lang, domainId);
								afterCalculatorConsanguinityList = result.getDataRef();
								
								List<Map> resultData = result.getAnswer();
								if (resultData == null) {
									resultData = new ArrayList<Map>();
								}
								expData0.put("answer", resultData);
								if (result.getDataRef() != null && result.getDataRef().size() > 0) { //python
									String code = pythonCalculatorService.getPythonCode(sessionId);
					    			expData0.put("code", code);
					    			afterCalculateLogic = code;
									evaluation.setCalculatorType(AfterCalculatorEvaluation.PYTHON_CALCULATOR_TYPE);
									evaluation.setUserMessage(result.getUserMessage());
									evaluation.setCode(code);
								} else if (result.getLogic() != null && !"".equals(result.getLogic().trim())) { //tool
									afterCalculateLogic = result.getLogic().trim();
									evaluation.setCalculatorType(AfterCalculatorEvaluation.TOOLS_CALCULATOR_TYPE);
									evaluation.setUserMessage(result.getUserMessage());
									evaluation.setLogic(result.getLogic().trim());;
								}
							}
						}
						JSONArray expData = new JSONArray();
		    			expData.add(expData0);
		    			dataMap.put("data", expData);
		    			
		    			// Post-calculation evaluation
		    			checkService.evaluateAfterCalculator(evaluation, domainId);
					} catch (SessionCancelledException e) {
						// Cancellation is not an ordinary failure: do not record an error, do not persist, do not submit for quality check, just finish.
						log.info("[" + sessionId + "] after calculate cancelled: " + index);
						cancelled = true;
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					} finally {
						// Do not persist when cancelled (otherwise the data-fetch polling would treat it as done).
						if (!cancelled) {
						subQueryTask.setDataMap(dataMap);
						subQueryTask.setRowPermissionDataMap(JSONObject.parseObject(JSON.toJSONString(dataMap, Feature.WriteMapNullValue)));
						subQueryTask.setDslConsanguinityMapList(dslConsanguinityMapList);
						subQueryTask.setAfterCalculatorConsanguinityList(afterCalculatorConsanguinityList);
						try {
							abcSubQueryTaskDao.save(subQueryTask, true);
						} catch (Exception e) {
							log.error(e.getMessage(), e);
						}
						}
					}
					if (cancelled) {
						return;
					}
					log.info(sessionId + "    " + index + "    end    " + new Date());
					// Post-calculation submission for quality check
					log.info("check afterCalculate: " + sessionId + "    " + index);
					checkService.fromAfterCalculateLogicToLogicText(sessionId, 0, afterCalculateLogic, cacheFilePaths);
					break;
				} else {
					try {
						Thread.sleep(1000L);
					} catch (Exception e) {}
				}
			} else {
				break;
			}
		}
	}

}
