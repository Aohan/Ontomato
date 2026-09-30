package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.bean.dashboard.DashboardCondition;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionLimit;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionProperties;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesOutput;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesOutputFilter;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesOutputValue;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesWhere;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesWhereAssert;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionTimeseriesWhereValue;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionVectorOutput;
import io.ontomato.dataengine.bean.dashboard.DashboardConditionVectorWhere;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DashboardService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslPermissionUtil;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class DashboardServiceImpl implements DashboardService {
	
	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
    private AdminService adminService;
	
	@Autowired
    private LangService langService;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Override
	public List<DashboardCondition> getConditionsFromDsls(List<JSONObject> originDsls, String domainId) {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)adminService.getJSONRule(domainId).get("classDef");
		return getConditionsFromDsls(originDsls, classDefs);
	}
	
	private List<DashboardCondition> getConditionsFromDsls(List<JSONObject> originDsls, List<Map<String, Object>> classDefs) {
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
    	Map<String, Map<String, Map<String, Object>>> attrDefMap = new HashMap<String, Map<String, Map<String, Object>>>();
    	for (Map<String, Object> classDef : classDefs) {
    		String className = (String)classDef.get("className");
    		classDefMap.put(className, classDef);
    		Map<String, Map<String, Object>> attrMap = new HashMap<String, Map<String, Object>>();
    		for (Map<String, Object> attr : (List<Map<String, Object>>)classDef.get("attrs")) {
    			attrMap.put((String)attr.get("name"), attr);
    		}
    		attrDefMap.put(className, attrMap);
    	}
    	
		List<DashboardCondition> conditions = new ArrayList<DashboardCondition>();
		// Enrich regular conditions
		List<DashboardCondition> propertiesConditions = getPropertiesConditionFromOriginDsls(originDsls, classDefMap, attrDefMap);
		conditions.addAll(propertiesConditions);
		// Enrich time series conditions
		List<DashboardCondition> timeseriesWhereConditions = getTimeseriesWhereConditionFromOriginDsls(originDsls, classDefMap, attrDefMap);
		conditions.addAll(timeseriesWhereConditions);
		// Enrich time series output
		List<DashboardCondition> timeseriesOutputConditions = getTimeseriesOutputConditionFromOriginDsls(originDsls, classDefs, attrDefMap);
		conditions.addAll(timeseriesOutputConditions);
		// Enrich vector conditions
		List<DashboardCondition> vectorWhereConditions = getVectorWhereConditionFromOriginDsls(originDsls, classDefMap, attrDefMap);
		conditions.addAll(vectorWhereConditions);
		// Enrich vector output
		List<DashboardCondition> vectorOutputConditions = getVectorOutputConditionFromOriginDsls(originDsls, classDefs, attrDefMap);
		conditions.addAll(vectorOutputConditions);
		// Enrich limit
		List<DashboardCondition> limitConditions = getLimitConditionFromOriginDsls(originDsls);
		conditions.addAll(limitConditions);
		
		return conditions;
	}
	
	private List<DashboardCondition> getPropertiesConditionFromOriginDsls(List<JSONObject> originDsls, Map<String, Map<String, Object>> classDefMap, Map<String, Map<String, Map<String, Object>>> attrDefMap) {
		List<DashboardCondition> propertiesConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				JSONArray steps = originDsl.getJSONObject("answer").getJSONArray("steps");
				JSONArray firstObjects = steps.getJSONObject(0).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
				for (int i = 0; i < firstObjects.size(); i++) {
					List<DashboardCondition> subPropertiesConditions = new ArrayList<DashboardCondition>();
		    		JSONObject object = firstObjects.getJSONObject(i);
		    		JSONObject conditions = object.getJSONObject("conditions");
		    		if (conditions != null) {
		    			JSONObject root = conditions.getJSONObject("properties");
		    			if (root != null) {
		    				List<JSONObject> queue = new ArrayList<JSONObject>();
		    				queue.add(root);
		    				
		    				while (queue.size() > 0) {
		    		            JSONObject map = queue.remove(0);
		    		            JSONArray children = null;
		    		            if (map.getJSONArray("and") != null) {
		    		                children = map.getJSONArray("and");
		    		            } else if (map.getJSONArray("or") != null) {
		    		                children = map.getJSONArray("or");
		    		            } else if (map.getJSONArray("not") != null) {
		    		                children = map.getJSONArray("not");
		    		            }
		    		            if (children == null) {
		    		            	String operator = map.getString("operator").trim().toLowerCase();
		    		            	if (!"is".equals(operator) && !"is not".equals(operator)) {
		    		            		Map<String, Object> classDef = classDefMap.get(object.getString("class"));
			    		            	Map<String, Object> attrDef = attrDefMap.get(object.getString("class")).get(map.getString("field"));
			    		            	DashboardConditionProperties propertiesCondition = new DashboardConditionProperties();
			    		            	propertiesCondition.setDslIndex(dslIndex);
			    		            	propertiesCondition.setQuestion(question);
			    		            	propertiesCondition.setType(DashboardCondition.TYPE_PROPERTIES);
			    		            	propertiesCondition.setObjectIndex(i);
			    		            	propertiesCondition.setCondOrder(subPropertiesConditions.size());
			    		            	propertiesCondition.setClassName((String)classDef.get("className"));
			    		            	propertiesCondition.setAttrName((String)attrDef.get("name"));
			    		            	propertiesCondition.setOperator(operator);
			    		            	String attrType = ((String)attrDef.get("type")).trim().toLowerCase();
			    		            	Object originSample = map.get("value");
			    		            	if ("varchar".equals(attrType) || "text".equals(attrType)) {
			    		            		if (originSample instanceof List) {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_STRING_ARRAY);
			    		            		} else {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_STRING);
			    		            		}
			    		            	} else if ("timestamp".equals(attrType) || "date".equals(attrType)) {
			    		            		if (originSample instanceof List) {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_TIME_ARRAY);
			    		            		} else {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_TIME);
			    		            		}
			    		            	} else {
			    		            		if (originSample instanceof List) {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_NUMBER_ARRAY);
			    		            		} else {
			    		            			propertiesCondition.setValueType(DashboardCondition.VALUE_TYPE_NUMBER);
			    		            		}
			    		            	}
			    		            	propertiesCondition.setOriginSample(originSample);
			    		            	subPropertiesConditions.add(propertiesCondition);
		    		            	}
		    		            } else {
		    		                for (int j = 0; j < children.size(); j++) {
		    		                	JSONObject child = children.getJSONObject(j);
		    		                    queue.add(child);
		    		                }
		    		            }
		    		        }
		    			}
		    		}
		    		propertiesConditions.addAll(subPropertiesConditions);
		    	}
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return propertiesConditions;
	}
	
	private List<DashboardCondition> getTimeseriesWhereConditionFromOriginDsls(List<JSONObject> originDsls, Map<String, Map<String, Object>> classDefMap, Map<String, Map<String, Map<String, Object>>> attrDefMap) {
		List<DashboardCondition> timeseriesWhereConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				JSONArray steps = originDsl.getJSONObject("answer").getJSONArray("steps");
				for (int i = 0; i < steps.size(); i++) {
		    		JSONObject step = steps.getJSONObject(i);
		    		
		    		if (step.getJSONObject("graph") != null 
		    				&& step.getJSONObject("graph").getJSONArray("patterns") != null) {
		    			JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
		    			if (pattern.getJSONArray("objects") != null) {
		    				JSONArray objects = pattern.getJSONArray("objects");
		    				for (int j = 0; j < objects.size(); j++) {
		    					JSONObject object = objects.getJSONObject(j);
		    					
		    					Map<String, Object> classDef = classDefMap.get(object.getString("class"));
		    					if (object.getJSONObject("conditions") != null) {
									JSONObject conditions = object.getJSONObject("conditions");
									if (conditions.getJSONObject("timeseries") != null) {
										JSONObject timeseries = conditions.getJSONObject("timeseries");
										if (timeseries.getJSONObject("properties") != null) {
											JSONObject properties = timeseries.getJSONObject("properties");
											JSONArray conds = null;
											if (properties.getJSONArray("and") != null) {
												conds = properties.getJSONArray("and");
											} else if (properties.getJSONArray("or") != null) {
												conds = properties.getJSONArray("or");
											} else if (properties.getJSONArray("not") != null) {
												conds = properties.getJSONArray("not");
											}
											if (conds != null) {
												for (int k = 0; k < conds.size(); k++) {
													JSONObject cond = conds.getJSONObject(k);
													
													Map<String, Object> attrDef = attrDefMap.get(object.getString("class")).get(cond.getString("field"));
													if ("bucket".equals(attrDef.get("type"))) {
														DashboardConditionTimeseriesWhere condition = new DashboardConditionTimeseriesWhere();
														condition.setDslIndex(dslIndex);
														condition.setQuestion(question);
														condition.setType(DashboardCondition.TYPE_TIMESERIES_WHERE);
														condition.setValueType(DashboardCondition.VALUE_TYPE_TIMESERIES_WHERE);
														condition.setStepIndex(i);
														condition.setObjectIndex(j);
														condition.setCondIndex(k);
														condition.setClassName((String)classDef.get("className"));
														condition.setAttrName((String)attrDef.get("name"));
														
														DashboardConditionTimeseriesWhereValue originSample = new DashboardConditionTimeseriesWhereValue();
														if (cond.getJSONObject("time_range") != null) {
															JSONObject time_range = cond.getJSONObject("time_range");
															if (time_range.getString("start") != null) {
																originSample.setStart(time_range.getString("start"));;
															}
															if (time_range.getString("end") != null) {
																originSample.setEnd(time_range.getString("end"));;
															}
														}
														if (cond.getJSONArray("conditions") != null) {
															JSONArray array = cond.getJSONArray("conditions");
															for (int l = 0; l < array.size(); l++) {
																JSONObject obj = array.getJSONObject(l);
																if ("name".equals(obj.getString("metric")) && "=".equals(obj.getString("operator"))) { // Metric name
																	condition.setIndicatorName(obj.getString("value"));
																	break;
																}
															}
														}
														List<DashboardConditionTimeseriesWhereAssert> conditionAsserts = new ArrayList<DashboardConditionTimeseriesWhereAssert>();
														List<Object> conditionAssertValues = new ArrayList<Object>();
														if (cond.getJSONArray("asserts") != null) {
															JSONArray asserts = cond.getJSONArray("asserts");
															for (int l = 0; l < asserts.size(); l++) {
																JSONObject _assert = asserts.getJSONObject(l);
																Object value = _assert.get("value");
																String function = _assert.getString("function");
																if (function == null || "".equals(function.trim())) {
																	function = null;
																} else {
																	function = function.trim();
																}
																DashboardConditionTimeseriesWhereAssert conditionAssert = new DashboardConditionTimeseriesWhereAssert();
																conditionAssert.setAssertIndex(l);
																conditionAssert.setFunction(function);
																conditionAssert.setOperator(_assert.getString("operator"));
																conditionAsserts.add(conditionAssert);
																conditionAssertValues.add(value);
															}
														}
														condition.setAsserts(conditionAsserts);
														originSample.setAssertValues(conditionAssertValues);
														condition.setOriginSample(originSample);
														timeseriesWhereConditions.add(condition);
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
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return timeseriesWhereConditions;
	}
	
	private List<DashboardCondition> getTimeseriesOutputConditionFromOriginDsls(List<JSONObject> originDsls, List<Map<String, Object>> classDefs, Map<String, Map<String, Map<String, Object>>> attrDefMap) {
		List<DashboardCondition> timeseriesOutputConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				Map<String, DslConsanguinity> consanguinityMap = DslUtil.findConsanguinityFromDsl(originDsl, classDefs);
				JSONArray steps = originDsl.getJSONObject("answer").getJSONArray("steps");
				JSONObject lastStep = steps.getJSONObject(steps.size() - 1);
				JSONArray fields = lastStep.getJSONObject("output").getJSONArray("fields");
				for (int j = 0; j < fields.size(); j++) {
					JSONObject field = fields.getJSONObject(j);
					if (field.getJSONObject("time_range") != null) {
						DslConsanguinity consanguinity = consanguinityMap.get(field.getString("as"));
						Map<String, Object> attrDef = attrDefMap.get(consanguinity.getClassName()).get(consanguinity.getAttrName());
						if ("bucket".equals(attrDef.get("type"))) {
							DashboardConditionTimeseriesOutput condition = new DashboardConditionTimeseriesOutput();
							condition.setDslIndex(dslIndex);
							condition.setQuestion(question);
							condition.setType(DashboardCondition.TYPE_TIMESERIES_OUTPUT);
							condition.setValueType(DashboardCondition.VALUE_TYPE_TIMESERIES_OUTPUT);
							condition.setStepIndex(steps.size() - 1);
							condition.setOutputFieldIndex(j);
							condition.setClassName(consanguinity.getClassName());
							condition.setAttrName(consanguinity.getAttrName());
							DashboardConditionTimeseriesOutputValue originSample = new DashboardConditionTimeseriesOutputValue();
							JSONObject time_range = field.getJSONObject("time_range");
							if (time_range.getString("start") != null) {
								originSample.setStart(time_range.getString("start"));
							}
							if (time_range.getString("end") != null) {
								originSample.setEnd(time_range.getString("end"));
							}
							if (field.getString("function") != null && !"".equals(field.getString("function").trim())) {
								condition.setFunction(field.getString("function").trim());
							}
							List<DashboardConditionTimeseriesOutputFilter> filters = new ArrayList<DashboardConditionTimeseriesOutputFilter>();
							List<Object> filterValues = new ArrayList<Object>();
							if (field.getJSONArray("conditions") != null) {
								JSONArray outputConditions = field.getJSONArray("conditions");
								for (int k = 0; k < outputConditions.size(); k++) {
									JSONObject outputCondition = outputConditions.getJSONObject(k);
									if ("name".equals(outputCondition.getString("metric")) && "=".equals(outputCondition.getString("operator"))) { // Metric name
										condition.setIndicatorName(outputCondition.getString("value"));
									} else if ("value".equals(outputCondition.getString("metric"))) { // Filter condition
										DashboardConditionTimeseriesOutputFilter filter = new DashboardConditionTimeseriesOutputFilter();
										filter.setFilterIndex(k);
										filter.setOperator(outputCondition.getString("operator"));
										filters.add(filter);
										filterValues.add(outputCondition.get("value"));
									}
								}
							}
							condition.setFilters(filters);
							originSample.setFilterValues(filterValues);
							condition.setOriginSample(originSample);
							timeseriesOutputConditions.add(condition);
						}
					}
				}
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return timeseriesOutputConditions;
	}
	
	private List<DashboardCondition> getVectorWhereConditionFromOriginDsls(List<JSONObject> originDsls, Map<String, Map<String, Object>> classDefMap, Map<String, Map<String, Map<String, Object>>> attrDefMap) {
		List<DashboardCondition> vectorWhereConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				JSONArray firstObjects = originDsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
				for (int i = 0; i < firstObjects.size(); i++) {
		    		JSONObject object = firstObjects.getJSONObject(i);
		    		Map<String, Object> classDef = classDefMap.get(object.getString("class"));
		        	
		    		JSONObject conditions = object.getJSONObject("conditions");
		    		if (conditions != null) {
		    			if (conditions.getJSONObject("vector") != null) {
							JSONObject vector = conditions.getJSONObject("vector");
							if (vector.getJSONObject("properties") != null) {
								JSONObject properties = vector.getJSONObject("properties");
								JSONArray conds = null;
								if (properties.getJSONArray("and") != null) {
									conds = properties.getJSONArray("and");
								} else if (properties.getJSONArray("or") != null) {
									conds = properties.getJSONArray("or");
								}
								if (conds != null) {
									for (int k = 0; k < conds.size(); k++) {
										JSONObject cond = conds.getJSONObject(k);
										Map<String, Object> attrDef = attrDefMap.get(object.getString("class")).get(cond.getString("field"));
										if ("vector".equals(attrDef.get("type"))) {
											DashboardConditionVectorWhere condition = new DashboardConditionVectorWhere();
											condition.setDslIndex(dslIndex);
											condition.setQuestion(question);
											condition.setType(DashboardCondition.TYPE_VECTOR_WHERE);
											condition.setValueType(DashboardCondition.VALUE_TYPE_STRING);
											condition.setObjectIndex(i);
											condition.setCondIndex(k);
											condition.setClassName((String)classDef.get("className"));
											condition.setAttrName((String)attrDef.get("name"));
											condition.setOriginSample(cond.getString("query"));
											vectorWhereConditions.add(condition);
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
		}
		return vectorWhereConditions;
	}
	
	private List<DashboardCondition> getVectorOutputConditionFromOriginDsls(List<JSONObject> originDsls, List<Map<String, Object>> classDefs, Map<String, Map<String, Map<String, Object>>> attrDefMap) {
		List<DashboardCondition> vectorOutputConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				Map<String, DslConsanguinity> consanguinityMap = DslUtil.findConsanguinityFromDsl(originDsl, classDefs);
				JSONArray steps = originDsl.getJSONObject("answer").getJSONArray("steps");
				JSONArray lastStepOutputFields = steps.getJSONObject(steps.size() - 1).getJSONObject("output").getJSONArray("fields");
				for (int i = 0; i < lastStepOutputFields.size(); i++) {
		    		JSONObject lastStepOutputField = lastStepOutputFields.getJSONObject(i);
		    		if (lastStepOutputField.getString("query") != null && !"".equals(lastStepOutputField.getString("query").trim())) {
		    			DslConsanguinity consanguinity = consanguinityMap.get(lastStepOutputField.getString("as"));
		    			if (consanguinity != null) {
		    				String className = consanguinity.getClassName();
		    				if (attrDefMap.get(className).get(consanguinity.getAttrName()) != null) {
		    					Map<String, Object> attrDef = attrDefMap.get(className).get(consanguinity.getAttrName());
		    					if ("vector".equals(attrDef.get("type"))) {
		    						DashboardConditionVectorOutput condition = new DashboardConditionVectorOutput();
		    						condition.setDslIndex(dslIndex);
		    						condition.setQuestion(question);
		    						condition.setType(DashboardCondition.TYPE_VECTOR_OUTPUT);
		    						condition.setValueType(DashboardCondition.VALUE_TYPE_STRING);
		    						condition.setOutputFieldIndex(i);
		    						condition.setClassName(className);
		    						condition.setAttrName((String)attrDef.get("name"));
		    						condition.setOriginSample(lastStepOutputField.getString("query").trim());
		    						vectorOutputConditions.add(condition);
		    					}
		    				}
		    			}
		    		}
		    	}
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return vectorOutputConditions;
	}
	
	private List<DashboardCondition> getLimitConditionFromOriginDsls(List<JSONObject> originDsls) {
		List<DashboardCondition> limitConditions = new ArrayList<DashboardCondition>();
		for (int dslIndex = 0; dslIndex < originDsls.size(); dslIndex++) {
			JSONObject originDsl = originDsls.get(dslIndex);
			String question = originDsl.getString("problem");
			try {
				JSONArray steps = originDsl.getJSONObject("answer").getJSONArray("steps");
				JSONObject lastStep = steps.getJSONObject(steps.size() - 1);
				JSONObject limit = lastStep.getJSONObject("output").getJSONObject("limit");
		    	if (limit != null) {
		    		Integer count = limit.getInteger("count");
		    		if (count != null) {
		    			DashboardConditionLimit condition = new DashboardConditionLimit();
		    			condition.setDslIndex(dslIndex);
		    			condition.setQuestion(question);
		    			condition.setType(DashboardCondition.TYPE_LIMIT);
		    			condition.setValueType(DashboardCondition.VALUE_TYPE_NUMBER);
		    			condition.setOriginSample(count);
		    			limitConditions.add(condition);
		    		}
		    	}
			} catch (Exception e) {
				log.error(e.getMessage(), e);
			}
		}
		return limitConditions;
	}
	
	@Override
	public JSONObject getAnswerByDslConditionParam(JSONObject dsl, List<DashboardCondition> conditions, List<JSONObject> params, String lang, UserDataPermission permission, String domainId) throws Exception {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		enrichParamToDsl(0, dsl, params, lang);
		DslUtil.setRandomTempTableName(dsl);
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		String dslsStr = JSON.toJSONString(dsls, Feature.WriteMapNullValue);
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		DslExecutionResult result = HttpRequestUtil.getM3Data(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), dslsStr, null, true, jsonRule, vectorResourceDao, permission, HttpRequestUtil.M3Mode.V1, domainId)[1];
		Map<String, Object> rowPermissionDataMap = result.data();
		if (!result.failed()) { // DSL executed successfully
			JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(JSONObject.parseObject(JSON.toJSONString(rowPermissionDataMap, Feature.WriteMapNullValue)), permission, classDefs);
			return rowColPermissionDataMap;
		} else {
			throw new Exception(langService.get(lang, "Dashboard.data.error"));
		}
	}
	
	private void enrichParamToDsl(int dslIndex, JSONObject dsl, List<JSONObject> params, String lang) throws Exception {
		try {
			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);
			JSONObject lastStep = steps.getJSONObject(steps.size() - 1);
			if (params != null) {
				for (JSONObject param : params) {
					if (dslIndex == param.getInteger("dslIndex").intValue()) {
						if (DashboardCondition.TYPE_PROPERTIES.equals(param.getString("type"))) { // Regular type field
							DashboardConditionProperties condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionProperties.class);
							JSONArray firstObjects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
							JSONObject object = firstObjects.getJSONObject(condition.getObjectIndex());
							JSONObject conditions = object.getJSONObject("conditions");
							log.info(object.toString());
				    		if (conditions != null) {
				    			JSONObject root = conditions.getJSONObject("properties");
				    			if (root != null) {
				    				List<JSONObject> queue = new ArrayList<JSONObject>();
				    				queue.add(root);
				    				int condOrder = 0;
				    				while (queue.size() > 0) {
				    		            JSONObject map = queue.remove(0);
				    		            JSONArray children = null;
				    		            if (map.getJSONArray("and") != null) {
				    		                children = map.getJSONArray("and");
				    		            } else if (map.getJSONArray("or") != null) {
				    		                children = map.getJSONArray("or");
				    		            } else if (map.getJSONArray("not") != null) {
				    		                children = map.getJSONArray("not");
				    		            }
				    		            if (children == null) {
				    		            	String operator = map.getString("operator").trim().toLowerCase();
				    		            	if (!"is".equals(operator) && !"is not".equals(operator)) {
				    		            		if (condOrder == condition.getCondOrder().intValue()) {
				    		            			Object originSample = condition.getOriginSample();
				    		            			if ("like".equals(operator)) {
				    		            				String originSampleStr = originSample == null ? "" : originSample.toString().trim();
				    		            				if (!originSampleStr.startsWith("%") && !originSampleStr.startsWith("*")) {
				    		            					originSampleStr = "%" + originSampleStr;
				    		            				}
				    		            				if (!originSampleStr.endsWith("%") && !originSampleStr.endsWith("*")) {
				    		            					originSampleStr = originSampleStr + "%";
				    		            				}
				    		            				originSample = originSampleStr;
				    		            			}
				    		            			map.put("value", originSample);
				    		            			break;
				    		            		}
				    		            		condOrder++;
				    		            	}
				    		            } else {
				    		                for (int j = 0; j < children.size(); j++) {
				    		                	JSONObject child = children.getJSONObject(j);
				    		                    queue.add(child);
				    		                }
				    		            }
				    				}
				    			}
				    		}
						} else if (DashboardCondition.TYPE_TIMESERIES_WHERE.equals(param.getString("type"))) { // Time series condition
							DashboardConditionTimeseriesWhere condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionTimeseriesWhere.class);
							JSONObject step = steps.getJSONObject(condition.getStepIndex());
							JSONArray objects = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
							JSONObject object = objects.getJSONObject(condition.getObjectIndex());
							JSONObject properties = object.getJSONObject("conditions").getJSONObject("timeseries").getJSONObject("properties");
							JSONArray conds = null;
							if (properties.getJSONArray("and") != null) {
								conds = properties.getJSONArray("and");
							} else if (properties.getJSONArray("or") != null) {
								conds = properties.getJSONArray("or");
							} else if (properties.getJSONArray("not") != null) {
								conds = properties.getJSONArray("not");
							}
							JSONObject cond = conds.getJSONObject(condition.getCondIndex());
							Object originSample = condition.getOriginSample();
							if (originSample != null) {
								DashboardConditionTimeseriesWhereValue originSampleValue = JSONObject.parseObject(JSONObject.from(originSample).toString(), DashboardConditionTimeseriesWhereValue.class);
								if (originSampleValue.getStart() != null && !"".equals(originSampleValue.getStart().trim())) {
									if (cond.getJSONObject("time_range") == null) {
										cond.put("time_range", new JSONObject());
									}
									cond.getJSONObject("time_range").put("start", originSampleValue.getStart().trim());
								}
								if (originSampleValue.getEnd() != null && !"".equals(originSampleValue.getEnd().trim())) {
									if (cond.getJSONObject("time_range") == null) {
										cond.put("time_range", new JSONObject());
									}
									cond.getJSONObject("time_range").put("end", originSampleValue.getEnd().trim());
								}
								if (originSampleValue.getAssertValues() != null) {
									List<Object> assertValues = originSampleValue.getAssertValues();
									List<DashboardConditionTimeseriesWhereAssert> asserts = condition.getAsserts();
									JSONArray dslAsserts = cond.getJSONArray("asserts");
									for (int i = 0; i < assertValues.size(); i++) {
										DashboardConditionTimeseriesWhereAssert _assert = asserts.get(i);
										JSONObject dslAssert = dslAsserts.getJSONObject(_assert.getAssertIndex());
										dslAssert.put("value", assertValues.get(i));
									}
								}
							}
						} else if (DashboardCondition.TYPE_TIMESERIES_OUTPUT.equals(param.getString("type"))) { // Time series output
							DashboardConditionTimeseriesOutput condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionTimeseriesOutput.class);
							JSONObject step = steps.getJSONObject(condition.getStepIndex());
							JSONArray fields = step.getJSONObject("output").getJSONArray("fields");
							JSONObject field = fields.getJSONObject(condition.getOutputFieldIndex());
							Object originSample = condition.getOriginSample();
							if (originSample != null) {
								DashboardConditionTimeseriesOutputValue originSampleValue = JSONObject.parseObject(JSONObject.from(originSample).toString(), DashboardConditionTimeseriesOutputValue.class);
								if (originSampleValue.getStart() != null && !"".equals(originSampleValue.getStart().trim())) {
									if (field.getJSONObject("time_range") == null) {
										field.put("time_range", new JSONObject());
									}
									field.getJSONObject("time_range").put("start", originSampleValue.getStart().trim());
								}
								if (originSampleValue.getEnd() != null && !"".equals(originSampleValue.getEnd().trim())) {
									if (field.getJSONObject("time_range") == null) {
										field.put("time_range", new JSONObject());
									}
									field.getJSONObject("time_range").put("end", originSampleValue.getEnd().trim());
								}
								if (originSampleValue.getFilterValues() != null) {
									List<Object> filterValues = originSampleValue.getFilterValues();
									List<DashboardConditionTimeseriesOutputFilter> filters = condition.getFilters();
									JSONArray outputConditions = field.getJSONArray("conditions");
									for (int i = 0; i < filterValues.size(); i++) {
										DashboardConditionTimeseriesOutputFilter filter = filters.get(i);
										JSONObject outputCondition = outputConditions.getJSONObject(filter.getFilterIndex());
										outputCondition.put("value", filterValues.get(i));
									}
								}
							}
						} else if (DashboardCondition.TYPE_VECTOR_WHERE.equals(param.getString("type"))) { // Vector condition
							DashboardConditionVectorWhere condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionVectorWhere.class);
							JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
							JSONObject object = objects.getJSONObject(condition.getObjectIndex());
							JSONObject properties = object.getJSONObject("conditions").getJSONObject("vector").getJSONObject("properties");
							JSONArray conds = null;
							if (properties.getJSONArray("and") != null) {
								conds = properties.getJSONArray("and");
							} else if (properties.getJSONArray("or") != null) {
								conds = properties.getJSONArray("or");
							}
							JSONObject cond = conds.getJSONObject(condition.getCondIndex());
							cond.put("query", condition.getOriginSample());
						} else if (DashboardCondition.TYPE_VECTOR_OUTPUT.equals(param.getString("type"))) { // Vector output
							DashboardConditionVectorOutput condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionVectorOutput.class);
							JSONArray lastStepOutputFields = lastStep.getJSONObject("output").getJSONArray("fields");
							JSONObject field = lastStepOutputFields.getJSONObject(condition.getOutputFieldIndex());
							field.put("query", condition.getOriginSample());
						} else if (DashboardCondition.TYPE_LIMIT.equals(param.getString("type"))) { // limit
							DashboardConditionLimit condition = JSONObject.parseObject(JSON.toJSONString(param, Feature.WriteMapNullValue), DashboardConditionLimit.class);
							JSONObject limit = lastStep.getJSONObject("output").getJSONObject("limit");
							limit.put("count", condition.getOriginSample());
						}
					}
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception(langService.get(lang, "Dashboard.param.error"));
		}
	}

}
