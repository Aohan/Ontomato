package io.ontomato.dataengine.service.impl;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletionException;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslCookerEvaluation;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.bean.abcQuestion.ABCSubQueryTask;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dao.ABCSubQueryTaskDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.logging.DiagnosticEventLogger;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AfterCalculateService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.ChatService;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class ABCDslSubQueryExecutor implements Runnable {
	
	private ABCSubQueryTask subQueryTask;
	private ChatService chatService;
	private CheckService checkService;
	private AdminService adminService;
	private AfterCalculateService afterCalculateService;
	private VectorResourceDao vectorResourceDao;
	private ABCSubQueryTaskDao abcSubQueryTaskDao;
	private DataRagConfig dataRagConfig;
	private BusinessConfig businessConfig;
	private DataAdapterRegistry dataAdapterRegistry;
	private String lang;
	private String domainId;
	
	public ABCDslSubQueryExecutor(
			ABCSubQueryTask subQueryTask, 
			ChatService chatService, 
			CheckService checkService,
			AdminService adminService,
			AfterCalculateService afterCalculateService,
			VectorResourceDao vectorResourceDao,
			ABCSubQueryTaskDao abcSubQueryTaskDao,
			DataRagConfig dataRagConfig,
			BusinessConfig businessConfig,
			DataAdapterRegistry dataAdapterRegistry,
			String lang,
			String domainId) {
		this.subQueryTask = subQueryTask;
		this.chatService = chatService;
		this.checkService = checkService;
		this.adminService = adminService;
		this.afterCalculateService = afterCalculateService;
		this.vectorResourceDao = vectorResourceDao;
		this.abcSubQueryTaskDao = abcSubQueryTaskDao;
		this.dataRagConfig = dataRagConfig;
		this.businessConfig = businessConfig;
		this.dataAdapterRegistry = dataAdapterRegistry;
		this.lang = lang;
		this.domainId = domainId;
	}

	@Override
	public void run() {
		String question = subQueryTask.getQuestion();
		String sessionId = subQueryTask.getSessionId();
		JSONObject subQuery = subQueryTask.getSubQuery();
		Integer index = subQueryTask.getIndex();
		UserDataPermission permission = subQueryTask.getPermission();
		// Pre-start check of the sub-query pool task: if cancelled, return directly without producing output or triggering function capture.
		if (BackendSessionEntrance.isCancelled(sessionId)) {
			log.info(sessionId + "    " + index + "    cancelled before start");
			return;
		}
		// Sub-query level event sessionId = base-{index}
		String sqSessionId = BackendSessionEntrance.derive(sessionId, String.valueOf(index));

		log.info(sessionId + "    " + index + "    start    " + new Date());
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		// All data without permission
		JSONObject dataMap = new JSONObject();
		// Data after row permission filtering
		JSONObject rowPermissionDataMap = new JSONObject();
		String dslWithoutTimeConvert = "";
		
		Long m3Time = 0L;
		boolean m3Started = false;
		boolean modelFailed = false;
		boolean cancelled = false;
		DslCookerEvaluation evaluation = null;
		try {
			try {
				evaluation = chatService.generateDsl(question, index, subQuery, BackendSessionEntrance.derive(sessionId, String.valueOf(index)), sessionId, domainId);
			} catch (SessionCancelledException e) {
				// Cancellation is not a model failure: do not record error, do not persist to disk, do not trigger function capture, and end directly.
				log.info("[" + sessionId + "] dsl sub query cancelled: " + index);
				cancelled = true;
				return;
			} catch (CompletionException e) {
				// Model failure in the generateDsl stage: the actual error goes into the existing error string, and later evaluation and M3 are skipped
				log.error("[" + sessionId + "] " + e.getMessage(), e);
				Throwable cause = e.getCause() != null ? e.getCause() : e;
				String actualError = cause.toString();
				dataMap.put("error", actualError);
				rowPermissionDataMap.put("error", actualError);
				modelFailed = true;
			}
			if (!modelFailed) {
			// Evaluate the DSL Generator answer
			checkService.evaluateDslCooker(evaluation, index, domainId);
			// Query the database
			dslWithoutTimeConvert = evaluation.getDslStrWithoutTimeConvert();
			if (evaluation.getPass() == null) {
				Long now = System.currentTimeMillis();
				JSONObject m3StartedPayload = new JSONObject();
				m3StartedPayload.put("problem", subQuery.getString("subQuestion"));
				m3StartedPayload.put("dsl", safeJson(evaluation.getDslStr()));
				m3StartedPayload.put("m3Mode", "V1");
				DiagnosticEventLogger.emit("m3.query.started", sqSessionId, m3StartedPayload);
				m3Started = true;
				DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), evaluation.getDslStr(), sessionId, false, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId);
				m3Time = System.currentTimeMillis() - now;
				dataMap = results[0].rawResponse();
				rowPermissionDataMap = results[1].rawResponse();
				log.info("DSL_COOKER execute time [ " + sessionId + " ]: " + (System.currentTimeMillis() - now));
				emitM3Finished(sqSessionId, subQuery, evaluation.getDslStr(), dataMap, m3Time);
				m3Started = false;
			}
			}
		} catch (Exception e) {
			log.error("[" + sessionId + "] " + e.getMessage(), e);
			if (m3Started) {
				JSONObject m3Failed = new JSONObject();
				m3Failed.put("problem", subQuery == null ? null : subQuery.getString("subQuestion"));
				m3Failed.put("error", new JSONObject().fluentPut("message", String.valueOf(e.getMessage())));
				DiagnosticEventLogger.emit("m3.query.failed", sqSessionId, m3Failed);
				DiagnosticEventLogger.emit("m3.query.finished", sqSessionId, new JSONObject().fluentPut("status", "error"));
			}
		} finally {
			// When cancelled, do not persist to disk (otherwise downstream will treat it as done) and do not trigger function capture.
			if (!cancelled) {
			try {
				if (modelFailed) {
					// The generateDsl model failure has retained the actual error: complete the atomic task directly without DSL-dependent quality check/cache/card
					if (abcSubQueryTaskDao.queryById(subQueryTask.getId(), false, false) != null) {
						subQueryTask.setDataMap(dataMap);
						subQueryTask.setRowPermissionDataMap(rowPermissionDataMap);
						Map<String, Object> schemaDef = new HashMap<String, Object>();
						schemaDef.put("error", "DSL execution error");
						subQueryTask.setCacheSchemaDef(schemaDef);
						abcSubQueryTaskDao.save(subQueryTask, true);
					}
				} else {
				// DSL quality check
				log.info("check dsl: " + sessionId + "    " + index);
    			checkService.fromDslToLogicText(sessionId, index, dslWithoutTimeConvert, jsonRule, lang, domainId);
    			
    			// Cache the sub-question result
    			JSONObject cardDsl = JSONObject.parseObject(JSON.toJSONString(dataMap.getJSONObject("dsl"), Feature.WriteMapNullValue));
    			if (abcSubQueryTaskDao.queryById(subQueryTask.getId(), false, false) != null) {
	    			// Cache the sub-question result to a local file for the post-calculation agent to write python computation
	    			Map<String, Object> schemaDef = null;
	    			if (dataMap.getString("error") != null && !"".equals(dataMap.getString("error").trim())) {
	    				schemaDef = new HashMap<String, Object>();
	    				schemaDef.put("error", "DSL execution error");
	    			} else {
	    				schemaDef = afterCalculateService.subQueryResultToCacheFile(sessionId, index, dataMap, rowPermissionDataMap, domainId);
	    			}
	    			subQueryTask.setDataMap(dataMap);
	    			subQueryTask.setCacheSchemaDef(schemaDef);
	    			subQueryTask.setRowPermissionDataMap(rowPermissionDataMap);
	    			abcSubQueryTaskDao.save(subQueryTask, true);
    			}
    			
				// Generate Card
    			log.info("send generate question card: " + sessionId);
				Map<String, Object> input = new HashMap<String, Object>();
				input.put("dsl", cardDsl);
				input.put("subQuery", subQuery);
				input.put("sessionId", sessionId);
				input.put("index", index);
				log.info("real send generate question card: " + sessionId);
				chatService.saveCard(input, lang, domainId);
				}
			} catch (SessionCancelledException e) {
				log.info("[" + sessionId + "] dsl sub query cancelled, skip persist: " + index);
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
			}
		}
		log.info(sessionId + "    " + index + "    end    " + new Date());
        log.info("=================================================");
	}

	private void emitM3Finished(String sqSessionId, JSONObject subQuery, String dslStr, JSONObject dataMap, long m3Time) {
		String m3Error = dataMap == null ? null : dataMap.getString("error");
		if (m3Error != null && !m3Error.trim().isEmpty()) {
			JSONObject failed = new JSONObject();
			failed.put("problem", subQuery == null ? null : subQuery.getString("subQuestion"));
			failed.put("dsl", safeJson(dslStr));
			failed.put("error", new JSONObject().fluentPut("message", m3Error));
			DiagnosticEventLogger.emit("m3.query.failed", sqSessionId, failed);
			DiagnosticEventLogger.emit("m3.query.finished", sqSessionId, new JSONObject().fluentPut("status", "error").fluentPut("durationMs", m3Time));
		} else {
			JSONObject succeeded = new JSONObject();
			succeeded.put("problem", subQuery == null ? null : subQuery.getString("subQuestion"));
			succeeded.put("dsl", safeJson(dslStr));
			succeeded.put("m3Mode", "V1");
			succeeded.put("durationMs", m3Time);
			succeeded.put("result", DiagnosticEventLogger.buildM3Result(dataMap));
			DiagnosticEventLogger.emit("m3.query.succeeded", sqSessionId, succeeded);
			DiagnosticEventLogger.emit("m3.query.finished", sqSessionId, new JSONObject().fluentPut("status", "success").fluentPut("durationMs", m3Time));
		}
	}

	private Object safeJson(String s) {
		if (s == null) {
			return null;
		}
		try {
			return JSON.parse(s);
		} catch (Exception e) {
			return s;
		}
	}

}
