package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.*;

import io.ontomato.dataengine.bean.*;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity.Source;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelResolver;
import io.ontomato.dataengine.config.DaoConst;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.FileUtil;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.AfterCalculateService;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.PythonCalculatorService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.tools.AfterCalculatorSubmitTools;
import io.ontomato.dataengine.util.UserMessageUtil;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class AfterCalculateServiceImpl implements AfterCalculateService {
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
	private PythonCalculatorService pythonCalculatorService;

	@Autowired
	private MultiThreadAIChatService multiThreadAIChatService;

	@Autowired
	private AgentWorkspaceService agentWorkspaceService;

	@Autowired
	DataRagConfig dataRagConfig;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private LangService langService;

	@Autowired
	private KnowledgeDao knowledgeDao;

	@Autowired
	private BussinessExampleDao bussinessExampleDao;
	
	@Autowired
	private BusinessExampleQuestionSpliterDao businessExampleQuestionSpliterDao;
	
	private String subQueryCacheDirName = DaoConst.SUB_QUERY_CACHE_DIR_NAME;

	/** Note appended to the next round's message when the round produced no usable submission, at the same place and in the same form as the baseline errorMessage. */
	private static final String NO_SUBMISSION_MESSAGE = "\n\nThe previous round did not complete delivery through a submission tool; call submitProgram to submit code and lineage, or call submitResult to submit the direct result.";
	
	@Override
	public String getSubQueryCacheDirName() {
		return this.subQueryCacheDirName;
	}
	
	@Override
	public Map<String, Object> subQueryResultToCacheFile(String sessionId, int index, JSONObject dataMap, JSONObject rowPermissionDataMap, String domainId) {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)adminService.getJSONRule(domainId).get("classDef");
		// class-attribute-attribute definition MAP
		Map<String, Map<String, Map<String, Object>>> classAttrDefMap = new HashMap<String, Map<String, Map<String, Object>>>();
		// class-attribute-metric-metric definition MAP
		Map<String, Map<String, Map<String, Map<String, Object>>>> classAttrIndicatorDefMap = new HashMap<String, Map<String, Map<String, Map<String, Object>>>>();
		for (Map<String, Object> classDef : classDefs) {
			String className = (String)classDef.get("className");
			Map<String, Map<String, Object>> attrDefMap = new HashMap<String, Map<String, Object>>();
			Map<String, Map<String, Map<String, Object>>> attrIndicatorDefMap = new HashMap<String, Map<String, Map<String, Object>>>();
			for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					String attrName = (String)attrDef.get("name");
					attrDefMap.put(attrName, attrDef);
					if (attrDef.get("indicators") != null) {
						Map<String, Map<String, Object>> indicatorDefMap = new HashMap<String, Map<String, Object>>();
						for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
							indicatorDefMap.put((String)indicatorDef.get("name"), indicatorDef);
						}
						attrIndicatorDefMap.put(attrName, indicatorDefMap);
					}
				}
			}
			classAttrDefMap.put(className, attrDefMap);
			if (attrIndicatorDefMap.size() > 0) {
				classAttrIndicatorDefMap.put(className, attrIndicatorDefMap);
			}
		}
		// get the lineage of the output fields
		JSONObject dsl = dataMap.getJSONObject("dsl");
		Map<String, DslConsanguinity> asConsanguinityMap = DslUtil.findConsanguinityFromDsl(dsl, classDefs);
		
		// find the output fields of time series type
		Set<String> bucketAsSet = new HashSet<String>();
		for (String as : asConsanguinityMap.keySet()) {
			DslConsanguinity consanguinity = asConsanguinityMap.get(as);
			if (classAttrIndicatorDefMap.get(consanguinity.getClassName()) != null
					&& classAttrIndicatorDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName()) != null
					&& classAttrIndicatorDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName()).size() > 0) {
				bucketAsSet.add(as);
			}
		}
		
		// find all string type fields in time format
		Set<String> timeStringAsSet = new HashSet<String>();
		String[] mightFormats = new String[] {"yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm:ss.SSS"};
		if (dataMap.getJSONArray("data") != null) {
    		JSONArray data = dataMap.getJSONArray("data");
    		for (int i = 0; i < data.size(); i++) {
    			JSONObject datum = data.getJSONObject(i);
    			if (datum.getJSONArray("answer") != null) {
    				JSONArray answer = datum.getJSONArray("answer");
    				for (int j = 0; j < answer.size(); j++) {
    					JSONObject row = answer.getJSONObject(j);
    					if (row != null) {
    						for (String key: row.keySet()) {
    							Object value = row.get(key);
    							if (value != null) {
    								if (!timeStringAsSet.contains(key)) {
    									if (value instanceof String) {
    										boolean isTimeFormat = false;
            								for (String mightFormat : mightFormats) {
            									try {
            										String v = (String)value;
            										if (v.length() == mightFormat.length()) {
            											SimpleDateFormat sdf = new SimpleDateFormat(mightFormat);
                										sdf.parse((String)v);
                										isTimeFormat = true;
                										break;
            										}
            									} catch (Exception e) {}
            								}
            								if (isTimeFormat) {
            									timeStringAsSet.add(key);
            								}
    									}
    								}
    							}
    						}
    					}
    				}
    			}
    		}
		}
		
		// Build cache data: time series data must be flattened by timestamp, vector data stays in array form. sample comes from dataMap, full cache data comes from rowPermissionDataMap.
		boolean hasBucketTimestampKey = false;
		JSONArray cacheSamples = new JSONArray();
		if (dataMap.getJSONArray("data") != null) {
    		JSONArray data = dataMap.getJSONArray("data");
    		for (int i = 0; i < data.size(); i++) {
    			JSONObject datum = data.getJSONObject(i);
    			if (datum.getJSONArray("answer") != null) {
    				JSONArray answer = datum.getJSONArray("answer");
    				for (int j = 0; j < answer.size(); j++) {
    					JSONObject row = answer.getJSONObject(j);
    					JSONArray samples = rowToCache(row, timeStringAsSet, mightFormats, bucketAsSet, asConsanguinityMap);
    					if (samples.size() > 0) {
    						cacheSamples = samples;
    						for (int k = 0; k < cacheSamples.size(); k++) {
    							JSONObject sample = cacheSamples.getJSONObject(k);
    							if (sample.containsKey("timeseries_timestamp")) {
    								hasBucketTimestampKey = true;
    								break;
    							}
    						}
    						break;
    					}
    				}
    			}
    			if (cacheSamples.size() > 0) {
    				break;
    			}
    		}
		}
		JSONArray cacheData = new JSONArray();
		if (rowPermissionDataMap.getJSONArray("data") != null) {
    		JSONArray data = rowPermissionDataMap.getJSONArray("data");
    		for (int i = 0; i < data.size(); i++) {
    			JSONObject datum = data.getJSONObject(i);
    			if (datum.getJSONArray("answer") != null) {
    				JSONArray answer = datum.getJSONArray("answer");
    				for (int j = 0; j < answer.size(); j++) {
    					JSONObject row = answer.getJSONObject(j);
    					JSONArray caches = rowToCache(row, timeStringAsSet, mightFormats, bucketAsSet, asConsanguinityMap);
    					for (int k = 0; k < caches.size(); k++) {
							JSONObject cache = caches.getJSONObject(k);
							if (cache.containsKey("timeseries_timestamp")) {
								hasBucketTimestampKey = true;
							}
							cacheData.add(cache);
						}
    				}
    			}
    		}
		}
    	
		Map<String, Object> schemaDef = new HashMap<String, Object>();
    	// write cache data to file
		File cacheFile = new File("conf/" + subQueryCacheDirName + "/" + sessionId + "_" + index + ".json");
		FileOutputStream fos = null;
		try {
			cacheFile.getParentFile().mkdirs();
			fos = new FileOutputStream(cacheFile);
			fos.write(JSON.toJSONString(cacheData, Feature.WriteMapNullValue).getBytes("utf-8"));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		schemaDef.put("filePath", cacheFile.getAbsolutePath());
		schemaDef.put("fileName", sessionId + "_" + index + ".json");
		// cache data sample
		schemaDef.put("cacheSamples", cacheSamples);
		schemaDef.put("cacheDataCount", cacheData.size());
    					
		// assemble the cache data definition 
		JSONArray defs = new JSONArray();
		// also generate the Map<String, DslConsanguinity> in cache format
		Map<String, DslConsanguinity> cacheDslConsanguinityMap = new HashMap<String, DslConsanguinity>();
		for (String as : asConsanguinityMap.keySet()) {
			DslConsanguinity consanguinity = asConsanguinityMap.get(as);
			Map<String, Object> attrDef = null;
			if (classAttrDefMap.get(consanguinity.getClassName()) != null
					&& classAttrDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName()) != null) {
				attrDef = classAttrDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName());
			}
			if (attrDef != null) { // output attribute whose attrDef can be found in JSONRule
				if ("vector".equals(attrDef.get("type"))) { // vector type attribute
					JSONObject def = new JSONObject();
					def.put("keyname", as);
					def.put("valuetype", "list");
					def.put("description", attrDef.get("attrDesc"));
					defs.add(def);
					cacheDslConsanguinityMap.put(as, consanguinity);
				} else if ("bucket".equals(attrDef.get("type"))) { // time series type attribute
					for (String indicator : consanguinity.getIndicatorNames()) {
						Map<String, Object> indicatorDef = classAttrIndicatorDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName()).get(indicator);
						String type = null;
						for (int i = 0; i < cacheData.size(); i++) {
							JSONObject datum = cacheData.getJSONObject(i);
							if (datum.get(as) != null) {
								Object value = datum.get(as);
								if (value instanceof Integer || value instanceof Long || value instanceof Float || value instanceof Double || value instanceof BigDecimal) {
									type = "number";
								} else if (value instanceof String) {
									type = "String";
								}
								break;
							}
						}
						JSONObject def = new JSONObject();
						def.put("keyname", as + "_" + indicator);
						def.put("valuetype", type == null ? "" : type);
						String desc = (String)indicatorDef.get("desc");
						if (consanguinity.getFunction() != null) {
							desc = consanguinity.getFunction() + "(" + desc + ")";
						}
						if (indicatorDef.get("unit") != null && !"".equals(((String)indicatorDef.get("unit")).trim())) {
							desc += "(unit: " + indicatorDef.get("unit") + ")";
						}
						def.put("description", desc);
						defs.add(def);
						DslConsanguinity newConsanguinity = new DslConsanguinity();
						newConsanguinity.setOutputKey(def.getString("keyname"));
						newConsanguinity.setClassName(consanguinity.getClassName());
						newConsanguinity.setAttrName(consanguinity.getAttrName());
						Set<String> indicatorNames = new HashSet<String>();
						indicatorNames.add(indicator);
						newConsanguinity.setIndicatorNames(indicatorNames);
						newConsanguinity.setFunction(consanguinity.getFunction());
						newConsanguinity.setAsGroupBy(consanguinity.getAsGroupBy());
						cacheDslConsanguinityMap.put(def.getString("keyname"), newConsanguinity);
					}
					if (hasBucketTimestampKey) { // timestamp output attribute of a time series type field
						JSONObject def = new JSONObject();
						def.put("keyname", "timeseries_timestamp");
						def.put("valuetype", "timestamp");
						def.put("description", "time series timestamp (nanoseconds)");
						defs.add(def);
						DslConsanguinity newConsanguinity = new DslConsanguinity();
						newConsanguinity.setOutputKey(def.getString("keyname"));
						newConsanguinity.setClassName(consanguinity.getClassName());
						newConsanguinity.setAttrName(consanguinity.getAttrName());
						newConsanguinity.setFunction(consanguinity.getFunction());
						newConsanguinity.setAsGroupBy(consanguinity.getAsGroupBy());
						cacheDslConsanguinityMap.put(def.getString("keyname"), newConsanguinity);
					}
				} else { // normal, full-text search type attribute
					if (timeStringAsSet.contains(as)) { // string type attribute in time format
						JSONObject def = new JSONObject();
						def.put("keyname", as);
						def.put("valuetype", "timestamp");
						def.put("description", attrDef.get("attrDesc"));
						defs.add(def);
					} else {
						if ("int".equals(attrDef.get("type")) || "long".equals(attrDef.get("type")) || "double".equals(attrDef.get("type"))) { // output as number type
							JSONObject def = new JSONObject();
							def.put("keyname", as);
							def.put("valuetype", "number");
							def.put("description", attrDef.get("attrDesc"));
							defs.add(def);
						} else { // output as string type
							JSONObject def = new JSONObject();
							def.put("keyname", as);
							def.put("valuetype", "String");
							def.put("description", attrDef.get("attrDesc"));
							defs.add(def);
						}
					}
					cacheDslConsanguinityMap.put(as, consanguinity);
				}
			} else { // output attribute after multi-field calculation
				String type = null;
				for (int i = 0; i < cacheData.size(); i++) {
					JSONObject datum = cacheData.getJSONObject(i);
					if (datum.get(as) != null) {
						Object value = datum.get(as);
						if (value instanceof Integer || value instanceof Long || value instanceof Float || value instanceof Double || value instanceof BigDecimal) {
							type = "number";
						} else if (value instanceof String) {
							type = "String";
						}
						break;
					}
				}
				JSONObject def = new JSONObject();
				def.put("keyname", as);
				def.put("valuetype", type == null ? "" : type);
				def.put("description", "");
				defs.add(def);
				cacheDslConsanguinityMap.put(as, consanguinity);
			}
		}
		schemaDef.put("defs", defs);
		schemaDef.put("dslConsanguinityMap", cacheDslConsanguinityMap);
    	
		return schemaDef;
	}
	
	private JSONArray rowToCache(JSONObject row, Set<String> timeStringAsSet, String[] mightFormats, Set<String> bucketAsSet, Map<String, DslConsanguinity> asConsanguinityMap) {
		JSONArray array = new JSONArray();
		
		if (row != null) {
			// normal, full-text search, vector type fields
			JSONObject propertiesObj = new JSONObject();
			for (String as : asConsanguinityMap.keySet()) {
				if (!bucketAsSet.contains(as)) {
					if (timeStringAsSet.contains(as)) { // string type field in time format
						Date date = null;
						for (String mightFormat : mightFormats) {
							try {
								String value = row.getString(as);
								if (value.length() == mightFormat.length()) {
									SimpleDateFormat sdf = new SimpleDateFormat(mightFormat);
									date = sdf.parse(value);
									break;
								}
							} catch (Exception e) {}
						}
						if (date != null) {
							propertiesObj.put(as, date.getTime() * 1000000L);
						} else {
							propertiesObj.put(as, null);
						}
					} else {
						propertiesObj.put(as, row.get(as));
					}
				}
			}
			// clean time series fields into objects grouped by timestamp
			Map<Long, Map<String, Object>> bucketTimeValueMap = new HashMap<Long, Map<String, Object>>();
			for (String bucketKey : bucketAsSet) {
				JSONArray bucketValue = row.getJSONArray(bucketKey);
				if (bucketValue != null) {
					for (int k = 0; k < bucketValue.size(); k++) {
						JSONArray bucketRow = bucketValue.getJSONArray(k);
						if (bucketRow.size() >= 3) {
							Object timestamp = bucketRow.get(0);
							Object indicator = bucketRow.get(1);
							Object rowValue = bucketRow.get(2);
							if ((timestamp == null || timestamp instanceof Long) && indicator != null && indicator instanceof String && rowValue != null) {
								if (timestamp == null) {
									timestamp = -1L;
								}
								Map<String, Object> valueMap = bucketTimeValueMap.get(timestamp);
								if (valueMap == null ) {
									valueMap = new HashMap<String, Object>();
									bucketTimeValueMap.put((Long)timestamp, valueMap);
								}
								valueMap.put(bucketKey + "_" + (String)indicator, rowValue);
							}
						}
					}
				}
			}
			if (bucketTimeValueMap.size() == 0) {
				bucketTimeValueMap.put(-1L, new HashMap<String, Object>());
			}
			
			List<Long> timestamps = new ArrayList<Long>();
			timestamps.addAll(bucketTimeValueMap.keySet());
			while (true) {
				boolean breakable = true;
				for (int k = 0; k < timestamps.size() - 1; k++) {
					Long a = timestamps.get(k);
					Long b = timestamps.get(k + 1);
					if (a > b) {
						timestamps.set(k, b);
						timestamps.set(k + 1, a);
						breakable = false;
					}
				}
				if (breakable) {
					break;
				}
			}
			for (Long timestamp : timestamps) {
				JSONObject obj = JSONObject.parseObject(JSON.toJSONString(propertiesObj, Feature.WriteMapNullValue));
				if (timestamps.size() > 1 || !timestamp.equals(-1L)) {
					obj.put("timeseries_timestamp", timestamp.equals(-1L) ? null : timestamp * 1000000L);
				}
				for (String bucketKey : bucketAsSet) {
					for (String indicator : asConsanguinityMap.get(bucketKey).getIndicatorNames()) {
						obj.put(bucketKey + "_" + indicator, bucketTimeValueMap.get(timestamp).get(bucketKey + "_" + indicator));
					}
				}
				array.add(obj);
			}
		}
		
		return array;
	}
	
	@Override
	public File getSubQueryCacheFile(String fileName) {
		return new File("conf/" + subQueryCacheDirName + "/" + fileName);
	}

	@Override
	public AfterCalculatorResult calculate(String sessionid, String calculateQuestion, List<Map> jsonDataSchema, String originSessionId, String lang, String domainId) {
		log.info("sessionid:{},calculateQuestion:{}",sessionid,calculateQuestion);

		AfterCalculatorResult afterCalculatorResult = new AfterCalculatorResult();
		List<Map> subQuestionResultList = new ArrayList<>();
		boolean commitData = true;
		// get the data file
		for (int i = 0; i < jsonDataSchema.size(); i++) {
			String subQuestion = (String) jsonDataSchema.get(i).get("subQuestion");
			String datajsonfile = (String)jsonDataSchema.get(i).get("datajsonfile");
			String jsondata = FileUtil.getFileLoadAll(datajsonfile, "utf-8");
			JSONArray jsondataArray = JSON.parseArray(jsondata);
			// if the data volume is too large, do not submit the data
            if(jsondataArray.size() > dataRagConfig.getToolsDataMaxSize()){
                commitData = false;
            } else {
                Map subQuestionResultMap = new HashMap();
                subQuestionResultMap.put("subQuestion",subQuestion);
                subQuestionResultMap.put("subQuestionResult",jsondataArray);
                subQuestionResultList.add(subQuestionResultMap);
            }
		}

		String userMessage = null;
		if (commitData) {
			// if the data volume is not large, the data can be submitted to the LLM
			userMessage = UserMessageUtil.getAfterCalculatorUserMessage(sessionid, calculateQuestion,
					jsonDataSchema, subQuestionResultList, knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao, 10,
					lang, langService, domainId);
		} else {
			log.warn("[" + originSessionId + "] data volume too large, not submitting data, only submitting the data structure and data file URL");
			userMessage = UserMessageUtil.getAfterCalculatorUserMessage(sessionid, calculateQuestion,
					jsonDataSchema, null, knowledgeDao, bussinessExampleDao, businessExampleQuestionSpliterDao, 10,
					lang, langService, domainId);
		}

		// memory key = session sessionid prefix (for retrieving agent-llm logs by session) + random tail (independent memory per call); generated outside the loop, retries rely on the same key to continue the conversation and fix the code
		String pySessionid = BackendSessionEntrance.derive(sessionid, "aftercalc-" + UUID.randomUUID().toString().substring(0, 8));
		OriginalQuestion originalQuestion = new OriginalQuestion();
		originalQuestion.setId(sessionid);

		afterCalculatorResult.setUserMessage(userMessage);
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		int retryTimes = businessConfig.getToolAndPythonRetry()>0?businessConfig.getToolAndPythonRetry():3;
		int currentRetry=0;
		try {
			agentWorkspaceService.createWorkspace(pySessionid);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		try {
		while(currentRetry < retryTimes){
			// submissions are valid per round: clear the submission registry from before this round before each round starts
			agentWorkspaceService.clearSubmission(pySessionid);
			String calculateChatRetStr = multiThreadAIChatService.chat(MultiThreadAIChatService.TOOL_AND_PYTHON_CALCULATOR,originalQuestion,pySessionid,userMessage,ModelResolver.resolve(businessConfig, AgentRole.CODING, langService), domainId);
			log.info("<<< sessionid:{}, calculateResult:{}",sessionid, calculateChatRetStr);

			// delivery comes only from the current round's submission registry
			String submitted = agentWorkspaceService.getSubmission(pySessionid);
			if (submitted == null) {
				// not submitting in a round also counts as a retry, otherwise the loop never exits when the model never submits
				currentRetry++;
				userMessage = userMessage + NO_SUBMISSION_MESSAGE;
				continue;
			}
			log.info("<<< sessionid:{}, submitted:{}",sessionid, submitted);
			JSONObject envelope = null;
			try {
				envelope = JSONObject.parseObject(submitted);
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				currentRetry++;
				userMessage = userMessage + NO_SUBMISSION_MESSAGE;
				continue;
			}
			String kind = envelope.getString(AfterCalculatorSubmitTools.KIND_KEY);
			if (AfterCalculatorSubmitTools.KIND_RESULT.equals(kind)) {
				// used the tool and returned the result directly
				JSONArray answerArray = envelope.getJSONArray(AfterCalculatorSubmitTools.ANSWER_KEY);
				if (answerArray == null || answerArray.isEmpty()) {
					break;
				}
				List<Map> answer = answerArray.toList(Map.class);
				afterCalculatorResult.setAnswer(answer);
				if (envelope.containsKey(AfterCalculatorSubmitTools.LOGIC_KEY)) {
					afterCalculatorResult.setLogic(envelope.getString(AfterCalculatorSubmitTools.LOGIC_KEY));
				}
				return afterCalculatorResult;
			} else if (AfterCalculatorSubmitTools.KIND_PROGRAM.equals(kind)) {
				// submitted Python code, to be formally executed by the pipeline
				String pythonCode = envelope.getString(AfterCalculatorSubmitTools.CODE_KEY);
				if (pythonCode == null) {
					currentRetry++;
					userMessage = userMessage + NO_SUBMISSION_MESSAGE;
					continue;
				}
				try{
					List<Map> runResult = pythonCalculatorService.runPythonCode(sessionid, pythonCode, lang);
					if(runResult != null && runResult.size() > 0){
						// Python execution returned a result
						afterCalculatorResult.setAnswer(runResult);
						if (envelope.containsKey(AfterCalculatorSubmitTools.DATA_REF_KEY)) {
							List<Map> dataRef = envelope.getJSONArray(AfterCalculatorSubmitTools.DATA_REF_KEY).toList(Map.class);
							try {
								List<AfterCalculatorConsanguinity> consanguinityList = new ArrayList<AfterCalculatorConsanguinity>();
								for (Map map : dataRef) {
									AfterCalculatorConsanguinity consanguinity = new AfterCalculatorConsanguinity();
									String output = null;
									if (map.get("output") != null && map.get("output") instanceof String && !"".equals(((String)map.get("output")).trim())) {
										output = ((String)map.get("output")).trim();
									}
									List<Source> sources = new ArrayList<Source>();
									if (map.get("input") != null && map.get("input") instanceof JSONArray) {
										JSONArray input = (JSONArray)map.get("input");
										for (int i = 0; i < input.size(); i++) {
											String inputStr = input.getString(i);
											if (inputStr != null && !"".equals(inputStr.trim())) {
												inputStr = inputStr.trim();
												if (inputStr.indexOf(".") > 2) {
													String indexStr = inputStr.substring(0, inputStr.indexOf(".")).trim();
													Integer index = null;
													try {
														index = Integer.parseInt(indexStr.substring(1, indexStr.length() - 1).trim());
													} catch (Exception e) {}
													if (index == null) {
														sources = null;
														break;
													}
													String inputKey = inputStr.substring(inputStr.indexOf(".") + 1).trim();
													if (!"".equals(inputKey)) {
														Source source = consanguinity.new Source();
														source.setSubQueryIndex(index);
														source.setInputKey(inputKey);
														sources.add(source);
													} else {
														sources = null;
														break;
													}
												} else {
													sources = null;
													break;
												}
											} else {
												sources = null;
												break;
											}
										}
									} else {
										sources = null;
									}
									if (output != null && sources != null) {
										consanguinity.setOutputKey(output);
										consanguinity.setSources(sources);
										consanguinity.setType(map.get("type") != null && map.get("type") instanceof String ? ((String)map.get("type")).trim() : "");
										consanguinity.setComment(map.get("comment") != null && map.get("comment") instanceof String ? ((String)map.get("comment")).trim() : "");
										consanguinityList.add(consanguinity);
									}
								}
								afterCalculatorResult.setDataRef(consanguinityList);
							} catch (Exception e){
								log.error("error parsing the jsonDataRef returned by python",e);
							}
						}
						return afterCalculatorResult;
					} else {
						log.warn("python execution was normal, but the result is empty");
						break;
					}
				} catch (SessionCancelledException exp) {
					// cancellation does not count as a retry and does not go through the python fallback; end directly (finally cleans the workspace as usual).
					throw exp;
				} catch (Exception exp){
					// python execution had no result, increase the retry count
					log.error("python execution error: " + exp.getMessage());
					log.warn("python execution had no result, starting retry: "+currentRetry);
					currentRetry++;
					String errorMessage = "\n\nThe last Python execution had an error: "+exp.getMessage()+", please fix the Python code and output again.";
					userMessage = userMessage + errorMessage;
				}
				} else {
					// unknown submission shape: counted as a retry for producing nothing this round
					currentRetry++;
					userMessage = userMessage + NO_SUBMISSION_MESSAGE;
					continue;
				}
		}

		if(afterCalculatorResult.getAnswer() == null || afterCalculatorResult.getAnswer().size() == 0) {
			// no answer was obtained above, go directly to the python calculation
			PythonCalculatorResult pythonCalculatorResult = pythonCalculatorService.calculate(sessionid, calculateQuestion, jsonDataSchema, originSessionId, lang, domainId);
			afterCalculatorResult.setAnswer(pythonCalculatorResult.getAnswer());
			afterCalculatorResult.setUserMessage(pythonCalculatorResult.getUserMessage());
			afterCalculatorResult.setDataRef(pythonCalculatorResult.getDataRef());
			return afterCalculatorResult;
		}

		return null;
		} finally {
			agentWorkspaceService.removeWorkspace(pySessionid);
		}
	}
}
