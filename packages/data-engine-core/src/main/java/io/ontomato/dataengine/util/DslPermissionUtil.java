package io.ontomato.dataengine.util;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.AfterCalculatorConsanguinity;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class DslPermissionUtil {
	
	public static Object[] addRowPermission(String dslStr, List<Map<String, Object>> classDefs, UserDataPermission permission) {
		try {
			boolean addPermission = false;
			JSONArray dsls = JSON.parseArray(dslStr);
			JSONObject dsl = dsls.getJSONObject(0);
			Map<String, DslConsanguinity> dslConsanguinityMap = DslUtil.findConsanguinityFromDsl(dsl, classDefs);
			Set<String> shouldAddPermissionClassNameSet = new HashSet<String>();
			if (dslConsanguinityMap != null) {
				for (String key : dslConsanguinityMap.keySet()) {
					DslConsanguinity consanguinity = dslConsanguinityMap.get(key);
					if (consanguinity.getClassName() != null && !"".equals(consanguinity.getClassName().trim())) {
						shouldAddPermissionClassNameSet.add(consanguinity.getClassName().trim());
					}
				}
			}
			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);
			JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				String className = object.getString("class");
//				if (shouldAddPermissionClassNameSet.contains(className)) {
					JSONObject permissionWhere = permission.getRowPermissionMQLByClassName(className);
					if (permissionWhere != null) {
						JSONObject selfConditions = object.getJSONObject("conditions");
						if (selfConditions == null) {
							selfConditions = new JSONObject();
						}
						
						JSONObject selfWhere = null;
						if (selfConditions.getJSONObject("properties") != null) {
							selfWhere = object.getJSONObject("conditions").getJSONObject("properties");
						}
						JSONObject where = null;
						if (selfWhere != null) {
							where = new JSONObject();
							where.put("operator", "logic");
							JSONArray and = new JSONArray();
							and.add(selfWhere);
							and.add(permissionWhere);
							where.put("and", and);
						} else {
							where = permissionWhere;
						}
						
						selfConditions.put("properties", where);
						object.put("conditions", selfConditions);
						addPermission = true;
					}
//				}
			}
			return new Object[] {dsl, addPermission};
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new ServiceException("Failed to inject the formal row permission", e);
		}
	}

	public static JSONObject dealDslAnswerWithPermission(JSONObject dataMap, UserDataPermission permission, List<Map<String, Object>> classDefs) {
		SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
		
		JSONObject dsl = dataMap.getJSONObject("dsl");
		if (dsl != null) {
			// Get the DSL lineage
			Map<String, DslConsanguinity> consanguinityMap = DslUtil.findConsanguinityFromDsl(dsl, classDefs);
			// Output attributes without permission
			List<String> noPermissionKeys = new ArrayList<String>();
			// Output metrics without permission
			Map<String, Set<String>> noPermissionIndicatorsMap = new HashMap<String, Set<String>>();
			// Definition mapping of time series type fields
			Map<String, Map<String, String>> bucketIndicatorDefMap = new HashMap<String, Map<String, String>>();
			// The ID field of all classes should not be returned
			Set<String> notReturnIds = new HashSet<String>();
			for (String as : consanguinityMap.keySet()) {
				DslConsanguinity consanguinity = consanguinityMap.get(as);
				if (!"".equals(consanguinity.getClassName())) { // Output attributes after multi-field calculation are not subject to permission control
					String className = consanguinity.getClassName();
					FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
					if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) { // The class has permission
						if (!permission.isFullData() && !consanguinity.getAsGroupBy()) { // Group by fields are fully output
							if (consanguinity.getIndicatorNames() != null) { // Permission control of metrics
								Set<String> hasPermissionAttrNames = new HashSet<String>();
								hasPermissionAttrNames.addAll(fieldPermission.getVisibleFields()); // Detail fields with permission
								if (consanguinity.getFunction() != null) { // Statistical fields with permission
									hasPermissionAttrNames.addAll(fieldPermission.getGroupableColumns());
								}
								Set<String> noPermissionIndicators = new HashSet<String>();
								for (String indicatorName : consanguinity.getIndicatorNames()) {
									if (!hasPermissionAttrNames.contains(consanguinity.getAttrName()) && !hasPermissionAttrNames.contains(consanguinity.getAttrName() + "." + indicatorName)) {
										noPermissionIndicators.add(indicatorName);
									}
								}
								if (noPermissionIndicators.size() > 0) {
									noPermissionIndicatorsMap.put(as, noPermissionIndicators);
								}
							} else { // Permission control of attributes
								Set<String> hasPermissionAttrNames = new HashSet<String>();
								hasPermissionAttrNames.addAll(fieldPermission.getVisibleFields()); // Detail fields with permission
								if (consanguinity.getFunction() != null) { // Statistical fields with permission
									hasPermissionAttrNames.addAll(fieldPermission.getGroupableColumns());
								}
								if (!hasPermissionAttrNames.contains(consanguinity.getAttrName())) {
									noPermissionKeys.add(as);
								}
							}
						}
					} else { // The class has no permission
						noPermissionKeys.add(as);
					}
					// Definition mapping of time series type fields
					if (consanguinity.getIndicatorNames() != null) {
						Map<String, Object> attrDef = null;
						for (Map<String, Object> classDef : classDefs) {
							if (classDef.get("className").equals(className)) {
								for (Map<String, Object> ad : (List<Map<String, Object>>)classDef.get("attrs")) {
									if (ad.get("name").equals(consanguinity.getAttrName())) {
										attrDef = ad;
										break;
									}
								}
								break;
							}
						}
						if (attrDef != null) {
							Map<String, String> indicatorDefMap = new HashMap<String, String>();
							if (attrDef.get("indicators") != null && attrDef.get("indicators") instanceof List) {
								for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
									String desc = (String)indicatorDef.get("desc");
									if (indicatorDef.get("unit") != null && !"".equals(((String)indicatorDef.get("unit")).trim())) {
										desc += "(unit: " + indicatorDef.get("unit") + ")";
									}
									indicatorDefMap.put((String)indicatorDef.get("name"), desc);
								}
							}
							if (indicatorDefMap.size() > 0) {
								bucketIndicatorDefMap.put(as, indicatorDefMap);
							}
						}
					}
					// The ID field of all classes should not be returned
					if (consanguinity.getFunction() == null && (consanguinity.getAsGroupBy() == null || !consanguinity.getAsGroupBy()) && "id".equals(consanguinity.getAttrName())) {
						notReturnIds.add(as);
					}
				}
			}
			
			// Change the values of attributes or metrics without permission to "****"
			String password = "****";
			if (dataMap.getJSONArray("data") != null) {
	    		JSONArray data = dataMap.getJSONArray("data");
	    		for (int i = 0; i < data.size(); i++) {
	    			JSONObject datum = data.getJSONObject(i);
	    			if (datum.getJSONArray("answer") != null) {
	    				JSONArray answer = datum.getJSONArray("answer");
	    				for (int j = 0; j < answer.size(); j++) {
	    					JSONObject row = answer.getJSONObject(j);
	    					if (row != null) {
	    						// Handle attributes without permission
	    						for (String noPermissionKey : noPermissionKeys) {
	    							// Time series, vector, normal or full-text search fields are all replaced with ****
//	    							if (row.get(noPermissionKey) != null) {
	    								row.put(noPermissionKey, password);
//	    							}
	    						}
	    						// Handle metrics without permission
	    						for (String as : noPermissionIndicatorsMap.keySet()) {
	    							Set<String> noPermissionIndicators = noPermissionIndicatorsMap.get(as);
	    							JSONArray value = row.getJSONArray(as);
	    							if (value != null) {
	    								for (int k = 0; k < value.size(); k++) {
	    									JSONArray bucketRow = value.getJSONArray(k);
	    									if (bucketRow != null && bucketRow.size() >= 3) {
	    										String indicator = bucketRow.getString(1);
	    										if (noPermissionIndicators.contains(indicator)) {
	    											for (int l = 0; l < bucketRow.size(); l++) {
	    												if (l != 1) {
	    													bucketRow.set(l, password);
	    												}
	    											}
	    										}
	    									}
	    								}
	    							}
	    						}
	    						// Convert time series type fields into [{"time":"SimpleDateFormat", "indicator":"", "value": 123.45}, ...]
	    						for (String as : bucketIndicatorDefMap.keySet()) {
	    							Map<String, String> indicatorDefMap = bucketIndicatorDefMap.get(as);
	    							JSONArray value = row.getJSONArray(as);
	    							if (value != null) {
	    								JSONArray objFormatBucketValue = new JSONArray();
	    								for (int k = 0; k < value.size(); k++) {
	    									JSONArray bucketRow = value.getJSONArray(k);
	    									if (bucketRow != null && bucketRow.size() >= 3) {
	    										JSONObject objFormatBucketRow = new JSONObject();
	    										String timestamp = null;
	    										try {
	    											timestamp = sdf.format(new Date(bucketRow.getLong(0)));
	    										} catch (Exception e) {}
	    										objFormatBucketRow.put("time", timestamp == null ? bucketRow.get(0) : timestamp);
	    										String desc = null;
	    										try {
	    											desc = indicatorDefMap.get(bucketRow.getString(1));
	    										} catch (Exception e) {}
	    										objFormatBucketRow.put("indicator", desc == null ? bucketRow.get(1) : desc);
	    										objFormatBucketRow.put("value", bucketRow.get(2));
	    										objFormatBucketValue.add(objFormatBucketRow);
	    									}
	    								}
	    								row.put(as, objFormatBucketValue);
	    							}
	    						}
	    						// The ID field of all classes should not be returned
	    						for (String notReturnId : notReturnIds) {
	    							row.remove(notReturnId);
	    						}
	    					}
	    				}
	    			}
	    		}
			}
			
			// Semantic explanation of the returned fields
			Map<String, String[]> descriptionMap = new HashMap<String, String[]>();
	        for (String as : consanguinityMap.keySet()) {
	        	DslConsanguinity consanguinity = consanguinityMap.get(as);
	        	Map<String, Object> classDef = null;
	        	for (Map<String, Object> cd : classDefs) {
	        		if (cd.get("className").equals(consanguinity.getClassName())) {
	        			classDef = cd;
	        			break;
	        		}
	        	}
	        	if (classDef != null) {
	        		String classDesc = (String)classDef.get("classDesc");
	        		Map<String, Object> attrDef = null;
	        		for (Map<String, Object> ad : (List<Map<String, Object>>)classDef.get("attrs")) {
	        			if (ad.get("name").equals(consanguinity.getAttrName())) {
	        				attrDef = ad;
	        				break;
	        			}
	        		}
	        		if (attrDef != null) {
	        			String attrDesc = (String)attrDef.get("attrDesc");
	        			String indicatorDescs = "";
	        			if (consanguinity.getIndicatorNames() != null && attrDef.get("indicators") != null) {
	        				for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
	        					if (consanguinity.getIndicatorNames().contains(indicatorDef.get("name"))) {
	        						String indicatorDesc = (String)indicatorDef.get("desc");
	        						if (indicatorDef.get("unit") != null && !"".equals(((String)indicatorDef.get("unit")).trim())) {
	        							indicatorDesc += "(unit:" + indicatorDef.get("unit") + ")";
	        						}
	        						indicatorDescs += indicatorDesc + "; ";
	        					}
	        				}
	        			}
	        			descriptionMap.put(as, new String[] {classDesc, attrDesc, indicatorDescs, consanguinity.getFunction()});
	        		}
	        	}
	        }
	        for (String notReturnId : notReturnIds) {
	        	descriptionMap.remove(notReturnId);
	        }
	        dataMap.put("outputKeyDescriptionMDTable", UserMessageUtil.getOutputKeyDescriptionMDTable(descriptionMap));
		}
		
		return dataMap;
	}
	
	public static JSONObject dealAfterCalculateAnswerWithPermission(
			JSONObject dataMap, 
			List<Map<String, DslConsanguinity>> dslConsanguinityMapList, 
			List<AfterCalculatorConsanguinity> afterCalculatorConsanguinityList, 
			UserDataPermission permission) {
		if (dslConsanguinityMapList != null && afterCalculatorConsanguinityList != null) {
			// Output attributes without permission
			List<String> noPermissionKeys = new ArrayList<String>();
			
			for (AfterCalculatorConsanguinity afterCalculatorConsanguinity : afterCalculatorConsanguinityList) {
				if (afterCalculatorConsanguinity.getSources() != null && afterCalculatorConsanguinity.getSources().size() == 1) {
					Integer subQueryIndex = afterCalculatorConsanguinity.getSources().get(0).getSubQueryIndex();
					String input = afterCalculatorConsanguinity.getSources().get(0).getInputKey();
					if (subQueryIndex >= 0 && subQueryIndex < dslConsanguinityMapList.size()) {
						Map<String, DslConsanguinity> dslConsanguinityMap = dslConsanguinityMapList.get(subQueryIndex);
						if (dslConsanguinityMap.get(input) != null) {
							DslConsanguinity consanguinity = null;
							Object consanguinityObject = dslConsanguinityMap.get(input);
							if (consanguinityObject instanceof JSONObject) {
								consanguinity = ((JSONObject)consanguinityObject).to(DslConsanguinity.class);
							} else {
								consanguinity = (DslConsanguinity)consanguinityObject;
							}
							String className = consanguinity.getClassName();
							FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
							if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) { // The class has permission
								if (!permission.isFullData() && !consanguinity.getAsGroupBy()) { // Group by fields are fully output
									if (consanguinity.getIndicatorNames() != null) { // Permission control of metrics
										Set<String> hasPermissionAttrNames = new HashSet<String>();
										hasPermissionAttrNames.addAll(fieldPermission.getVisibleFields()); // Detail fields with permission
										if (consanguinity.getFunction() != null) { // Statistical fields with permission
											hasPermissionAttrNames.addAll(fieldPermission.getGroupableColumns());
										}
										boolean noPermission = true;
										for (String indicatorName : consanguinity.getIndicatorNames()) {
											if (hasPermissionAttrNames.contains(consanguinity.getAttrName()) || hasPermissionAttrNames.contains(consanguinity.getAttrName() + "." + indicatorName)) {
												noPermission = false;
												break;
											}
										}
										if (noPermission) {
											noPermissionKeys.add(input);
										}
									} else { // Permission control of attributes
										Set<String> hasPermissionAttrNames = new HashSet<String>();
										hasPermissionAttrNames.addAll(fieldPermission.getVisibleFields()); // Detail fields with permission
										if (consanguinity.getFunction() != null) { // Statistical fields with permission
											hasPermissionAttrNames.addAll(fieldPermission.getGroupableColumns());
										}
										if (!hasPermissionAttrNames.contains(consanguinity.getAttrName())) {
											noPermissionKeys.add(input);
										}
									}
								}
							} else { // The class has no permission
								noPermissionKeys.add(input);
							}
						}
					}
				}
			}
			
			// Change the values of attributes or metrics without permission to "****"
			String password = "****";
			if (dataMap.getJSONArray("data") != null) {
				JSONArray data = dataMap.getJSONArray("data");
				for (int i = 0; i < data.size(); i++) {
					JSONObject datum = data.getJSONObject(i);
					if (datum.getJSONArray("answer") != null) {
						JSONArray answer = datum.getJSONArray("answer");
						for (int j = 0; j < answer.size(); j++) {
	    					JSONObject row = answer.getJSONObject(j);
	    					if (row != null) {
	    						// Handle attributes without permission
	    						for (String noPermissionKey : noPermissionKeys) {
	    							// Time series, vector, normal or full-text search fields are all replaced with ****
	    							if (row.get(noPermissionKey) != null) {
	    								row.put(noPermissionKey, password);
	    							}
	    						}
	    					}
						}
					}
				}
			}
		}
		return dataMap;
	}
	
}
