package io.ontomato.dataengine.util;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.dao.VectorResourceDao;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class DslUtil {

	public static String normalizeClassNames(String dslStr, List<Map<String, Object>> classDefs) {
		try {
			JSONArray.parseArray(dslStr);
		} catch (Exception e) {
			JSONArray dsls = new JSONArray();
			dsls.add(JSONObject.parseObject(dslStr));
			dslStr = JSON.toJSONString(dsls, Feature.WriteMapNullValue);
		}
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject dsl = dsls.getJSONObject(dslIndex);
			JSONObject answer = dsl == null ? null : dsl.getJSONObject("answer");
			JSONArray steps = answer == null ? null : answer.getJSONArray("steps");
			if (steps == null) {
				continue;
			}

			for (int stepIndex = 0; stepIndex < steps.size(); stepIndex++) {
				JSONObject step = steps.getJSONObject(stepIndex);
				JSONObject graph = step == null ? null : step.getJSONObject("graph");
				JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
				if (patterns == null) {
					continue;
				}
				for (int patternIndex = 0; patternIndex < patterns.size(); patternIndex++) {
					JSONArray objects = patterns.getJSONObject(patternIndex).getJSONArray("objects");
					if (objects == null) {
						continue;
					}
					for (int objectIndex = 0; objectIndex < objects.size(); objectIndex++) {
						JSONObject object = objects.getJSONObject(objectIndex);
						if (object != null) {
							String className = object.getString("class");
							String normalizedClassName = DBSchemaUtil.normalizeClassName(className, classDefs);
							if (className != null && !className.equals(normalizedClassName)) {
								object.put("class", normalizedClassName);
							}
						}
					}
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}

	public static String setConditionTextColumnToEmptyArray(String dslStr) {
    	List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
    	for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				for (Object step : steps) {
    					if (step instanceof Map) {
    						Map st = (Map)step;
    						if (st.get("graph") != null && st.get("graph") instanceof Map) {
    							Map graph = (Map)st.get("graph");
    							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
    								List patterns = (List)graph.get("patterns");
    								for (Object pattern : patterns) {
    									Map pa = (Map)pattern;
    									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
    										List objects = (List)pa.get("objects");
    										for (Object object : objects) {
    											Map obj = (Map)object;
    											if (obj.get("conditions") != null && obj.get("conditions") instanceof Map) {
    												Map cond = (Map)obj.get("conditions");
    												if (cond.get("text") != null && cond.get("text") instanceof Map) {
    													Map text = (Map)cond.get("text");
    													text.put("fields", new ArrayList<String>());
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
    		}
    	}
    	return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
    }
    
    public static String setConditionTimeColumnToCorrectFormat(String dslStr, String[] mightFormats, List<Map<String, Object>> classDefs) {
    	if (mightFormats == null || mightFormats.length == 0) {
    		mightFormats = new String[] {"yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-dd HH:mm:ss.SSS"};
    	}
    	
    	List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
    	for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				for (Object step : steps) {
    					if (step instanceof Map) {
    						Map st = (Map)step;
    						if (st.get("graph") != null && st.get("graph") instanceof Map) {
    							Map graph = (Map)st.get("graph");
    							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
    								List patterns = (List)graph.get("patterns");
    								for (Object pattern : patterns) {
    									Map pa = (Map)pattern;
    									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
    										List objects = (List)pa.get("objects");
    										for (Object object : objects) {
    											Map obj = (Map)object;
    											if (obj.get("conditions") != null && obj.get("conditions") instanceof Map) {
    												Map cond = (Map)obj.get("conditions");
    												if (cond.get("properties") != null && cond.get("properties") instanceof Map) {
    													Set<String> formatAttrNames = new HashSet<String>();
    													for (Map<String, Object> classDef : classDefs) {
    														if (classDef.get("className").equals(obj.get("class"))) {
    															List<Map<String, String>> attrs = (List<Map<String, String>>)classDef.get("attrs");
    															for (Map<String, String> attr : attrs) {
    																if (("date".equals(attr.get("type")) || "timestamp".equals(attr.get("type")))) {
    																	formatAttrNames.add(attr.get("name"));
    																}
    															}
    															break;
    														}
    													}
    													
    													Map root = (Map)cond.get("properties");
    													List<Map> queue = new ArrayList<Map>();
    						                            queue.add(root);
    						                            while (queue.size() > 0) {
    						                                Map map = queue.remove(0);
    						                                List<Map> children = null;
    						                                if (map.containsKey("and") && map.get("and") instanceof List) {
    						                                    children = (List) map.get("and");
    						                                } else if (map.containsKey("or") && map.get("or") instanceof List) {
    						                                    children = (List) map.get("or");
    						                                } else if (map.containsKey("not") && map.get("not") instanceof List) {
    						                                    children = (List) map.get("not");
    						                                }
    						                                if (children == null) {
    						                                    if (!"is".equals(map.get("operator")) && !"is not".equals(map.get("operator")) && formatAttrNames.contains(map.get("field"))) {
    						                                        if (map.get("value") != null && map.get("value") instanceof String) {
    						                                        	String v = ((String)map.get("value")).trim();
    						                                        	Date date = null;
						                                        		for (String mightFormat : mightFormats) {
						                                        			try {
						                                        				if (v.length() == mightFormat.length()) {
						                                        					SimpleDateFormat sdf = new SimpleDateFormat(mightFormat);
	    						                                        			date = sdf.parse(v);
	    						                                        			break;
						                                        				}
    						                                        		} catch (Exception e) {}
						                                        		}
						                                        		if (date != null) {
						                                        			map.put("value", date.getTime());
						                                        		}
    						                                        } else if (map.get("value") != null && map.get("value") instanceof List) {
    						                                        	List vs = (List)map.get("value");
    						                                        	List<Object> correctVs = new ArrayList<Object>();
    						                                        	for (Object v : vs) {
    						                                        		if (v instanceof String) {
    						                                        			String s = ((String)v).trim();
    						                                        			Date date = null;
	    						                                        		for (String mightFormat : mightFormats) {
	    						                                        			try {
	    						                                        				if (s.length() == mightFormat.length()) {
	    						                                        					SimpleDateFormat sdf = new SimpleDateFormat(mightFormat);
		        						                                        			date = sdf.parse(s);
		        						                                        			break;
	    						                                        				}
	        						                                        		} catch (Exception e) {}
	    						                                        		}
	    						                                        		if (date != null) {
	    						                                        			correctVs.add(date.getTime());
	    						                                        		} else {
	    						                                        			correctVs.add(v);
	    						                                        		}
    						                                        		} else {
    						                                        			correctVs.add(v);
    						                                        		}
    						                                        	}
    						                                        	map.put("value", correctVs);
    						                                        }
    						                                    }
    						                                } else {
    						                                    for (Map child : children) {
    						                                        queue.add(child);
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
    					}
    				}
    			}
    		}
    	}
    	return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
    }
    
    public static String setLastStepToUserAndSaveTable(String dslStr) {
    	List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
    	for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				if (steps.size() > 0 && steps.get(steps.size() - 1) instanceof Map) {
    					Map lastStep = (Map)steps.get(steps.size() - 1);
    					if (lastStep.get("output") != null && lastStep.get("output") instanceof Map) {
							Map output = (Map)lastStep.get("output");
							output.put("to_user", true);
							output.remove("save_table");
						}
    				}
    			}
    		}
    	}
    	return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
    }
    
    public static String setSessionIdToDsl(String dslStr, String sessionId) {
    	List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
    	for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				Set<String> tempClassSet = new HashSet<String>();
    				for (Object step : steps) {
    					if (step instanceof Map) {
    						Map st = (Map)step;
    						if (st.get("graph") != null && st.get("graph") instanceof Map) {
    							Map graph = (Map)st.get("graph");
    							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
    								List patterns = (List)graph.get("patterns");
    								for (Object pattern : patterns) {
    									Map pa = (Map)pattern;
    									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
    										List objects = (List)pa.get("objects");
    										for (Object object : objects) {
    											Map obj = (Map)object;
    											if (tempClassSet.contains(obj.get("class") + "_" + sessionId)) {
    												obj.put("class", obj.get("class") + "_" + sessionId);
    											}
    										}
    									}
    								}
    							}
    						}
    						if (st.get("output") != null && st.get("output") instanceof Map) {
    							Map output = (Map)st.get("output");
    							if (output.get("to_user") != null && output.get("to_user") instanceof Boolean && !((Boolean)output.get("to_user"))) {
    								String tempClass = output.get("save_table") + "_" + sessionId;
    								output.put("save_table", tempClass);
    								tempClassSet.add(tempClass);
    							}
    						}
    					}
    				}
    			}
    		}
    	}
    	return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
    }
    
    public static void setRandomTempTableName(JSONObject dsl) {
    	JSONObject answer = dsl.getJSONObject("answer");
    	if (answer != null) {
    		JSONArray steps = answer.getJSONArray("steps");
    		if (steps != null && steps.size() == 2) {
    			JSONObject firstStep = steps.getJSONObject(0);
    			JSONObject lastStep = steps.getJSONObject(1);
    			String saveTable = "/t" + UUID.randomUUID().toString();
    			firstStep.getJSONObject("output").put("save_table", saveTable);
    			lastStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects").getJSONObject(0).put("class", saveTable);
    		}
    	}
    }
    
    public static void setRefName(JSONObject dsl) {
    	JSONObject answer = dsl.getJSONObject("answer");
    	if (answer != null) {
    		JSONArray steps = answer.getJSONArray("steps");
    		if (steps != null && steps.size() == 2) {
    			JSONObject firstStep = steps.getJSONObject(0);
    			JSONObject lastStep = steps.getJSONObject(1);
    			String refName = "t" + UUID.randomUUID().toString();
    			firstStep.getJSONObject("output").remove("save_table");
    			firstStep.put("ref_name", refName);
    			firstStep.put("direct_mql", true);
    			lastStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects").getJSONObject(0).put("class", "$" + refName);
    		}
    	}
    }
    
    public static String fromQuestionDslToNodeDsl(String dslStr) {
		List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
    	for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				if (steps.size() > 0 && steps.get(0) instanceof Map) {
    					Map firstStep = (Map)steps.get(0);
    					if (firstStep.get("output") != null && firstStep.get("output") instanceof Map) {
							Map output = (Map)firstStep.get("output");
							output.put("to_user", true);
							output.remove("save_table");
							
							Set<String> variables = new HashSet<String>();
							if (output.get("fields") != null && output.get("fields") instanceof List) {
								List fields = (List)output.get("fields");
								for (Object f : fields) {
									if (f instanceof Map) {
										Map field = (Map)f;
										if (field.get("variable") != null && field.get("variable") instanceof String) {
											variables.add((String)field.get("variable"));
										}
									}
								}
							}
							List<Map<String, String>> newFields = new ArrayList<Map<String, String>>();
							for (String variable : variables) {
								Map<String, String> field = new HashMap<String, String>();
								field.put("variable", variable);
								field.put("field", "id");
								field.put("as", variable + "_id");
								newFields.add(field);
							}
							output.put("fields", newFields);
						}
    				}
    				while (steps.size() > 1) {
    					steps.remove(steps.size() - 1);
    				}
    			}
    		}
    	}
    	return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
	}
	
	public static String enrichShouldReturnAttr(String dslStr, List<Map<String, Object>> classDefs) {
		List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
		
		Map<String, Set<String>> bizzMap = new HashMap<String, Set<String>>();
		for (Map<String, Object> classDef : classDefs) {
			Set<String> set = new HashSet<String>();
			for (Map<String, Object> attr : (List<Map<String, Object>>)classDef.get("attrs")) {
				if (attr.get("bizzkey") != null && (Boolean)attr.get("bizzkey")) {
					set.add((String)attr.get("name"));
				}
			}
			bizzMap.put((String)classDef.get("className"), set);
		}
		
		for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				if (steps.size() == 1) { // single step
    					Map step = (Map)steps.get(0);
    					
    					// class alias -> class name mapping
    					Map<String, String> variableClassMap = new HashMap<String, String>();
    					if (step.get("graph") != null && step.get("graph") instanceof Map) {
							Map graph = (Map)step.get("graph");
							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
								List patterns = (List)graph.get("patterns");
								for (Object pattern : patterns) {
									Map pa = (Map)pattern;
									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
										List objects = (List)pa.get("objects");
										for (Object object : objects) {
											Map obj = (Map)object;
											variableClassMap.put((String)obj.get("variable"), (String)obj.get("class"));
										}
									}
								}
							}
    					}
    					
    					Map output = (Map)(step).get("output");
    					if (output.get("fields") != null && output.get("fields") instanceof List) {
							List fields = (List)output.get("fields");
							// set of output aliases
							Set<String> asSet = new HashSet<String>();
							// class alias -> set of field names mapping
							Map<String, Set<String>> variableAttrs = new HashMap<String, Set<String>>();
							// whether there is an aggregate function
	    					boolean hasAggregate = false;
	    					// whether there is distinct
	    					boolean hasDistinct = false;
							for (Object f : fields) {
								if (f instanceof Map) {
									Map field = (Map)f;
									if (field.containsKey("function") && field.get("function") != null) {
										hasAggregate = true;
										break;
									}
									if (field.containsKey("distinct")) {
										hasDistinct = true;
										break;
									}
									if (field.get("variable") != null && field.get("variable") instanceof String) {
										String variable = (String)field.get("variable");
										Set<String> attrs = variableAttrs.get(variable);
										if (attrs == null) {
											attrs = new HashSet<String>();
											variableAttrs.put(variable, attrs);
										}
										attrs.add((String)field.get("field"));
										asSet.add((String)field.get("as"));
									}
								}
							}
							
							if (!hasAggregate && !hasDistinct) {
								// Enrich the must-return fields
								for (String variable : variableAttrs.keySet()) {
									Set<String> dslAttrs = variableAttrs.get(variable);
									String className = variableClassMap.get(variable);
									for (String bizzAttr : bizzMap.get(className)) {
										if (!dslAttrs.contains(bizzAttr)) {
											Map<String, String> field = new HashMap<String, String>();
											field.put("variable", variable);
											field.put("field", bizzAttr);
											String as = className.replace("/", "_") + "_" + bizzAttr + "_0";
											while (asSet.contains(as)) {
												String letter = as.substring(0, as.lastIndexOf("_"));
												Integer number = Integer.parseInt(as.substring(as.lastIndexOf("_" + 1)));
												as = letter + "_" + (number + 1);
											}
											asSet.add(as);
											field.put("as", as);
											fields.add(field);
										}
									}
								}
							}
						}
    				} else if (steps.size() == 2) { // double step
    					Map firstStep = (Map)steps.get(0);
    					Map secondStep = (Map)steps.get(1);
    					Map secondOutput = (Map)(secondStep).get("output");
    					
    					// whether there is a group by
    					boolean hasGroupBy = secondOutput.containsKey("group_by");
    					// whether there is an aggregate function
    					boolean hasAggregate = false;
    					// whether there is distinct
    					boolean hasDistinct = false;
    					if (secondOutput.get("fields") != null && secondOutput.get("fields") instanceof List) {
							List fields = (List)secondOutput.get("fields");
							for (Object f : fields) {
								if (f instanceof Map) {
									Map field = (Map)f;
									if (field.get("function") != null && !"".equals(((String)field.get("function")).trim())) {
										hasAggregate = true;
									} else if (field.get("expr") != null && !"".equals(((String)field.get("expr")).trim())) {
										String expr = ((String)field.get("expr")).trim() + "";
										if ((boolean)JSONCheckUtil.setCorrectExpr(expr, "/u")[1]) {
											hasAggregate = true;
										}
									} else if (field.containsKey("distinct")) {
										hasDistinct = true;
									}
								}
							}
    					}
    					
    					if (!hasGroupBy && !hasAggregate && !hasDistinct) {
    						Map firstOutput = (Map)(firstStep).get("output");
    						
    						// step0 class alias -> class name mapping
    						Map<String, String> variableClassMap = new HashMap<String, String>();
    						// step0 class name -> class alias mapping
    						Map<String, String> classVariableMap = new HashMap<String, String>();
        					if (firstStep.get("graph") != null && firstStep.get("graph") instanceof Map) {
    							Map graph = (Map)firstStep.get("graph");
    							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
    								List patterns = (List)graph.get("patterns");
    								for (Object pattern : patterns) {
    									Map pa = (Map)pattern;
    									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
    										List objects = (List)pa.get("objects");
    										for (Object object : objects) {
    											Map obj = (Map)object;
    											variableClassMap.put((String)obj.get("variable"), (String)obj.get("class"));
    											classVariableMap.put((String)obj.get("class"), (String)obj.get("variable"));
    										}
    									}
    								}
    							}
        					}
        					// step0 field alias -> [class name, field name] mapping
    						Map<String, String[]> asClassAttrMap = new HashMap<String, String[]>();
    						// step0 class alias -> set of field names mapping
    						Map<String, Set<String>> firstOutputMap = new HashMap<String, Set<String>>();
    						// step0 set of output aliases
    						Set<String> firstAsSet = new HashSet<String>();
    						if (firstOutput.get("fields") != null && firstOutput.get("fields") instanceof List) {
    							List fields = (List)firstOutput.get("fields");
    							for (Object f : fields) {
    								if (f instanceof Map) {
    									Map field = (Map)f;
    									asClassAttrMap.put((String)field.get("as"), new String[] {variableClassMap.get((String)field.get("variable")), (String)field.get("field")});
    									Set<String> set = firstOutputMap.get((String)field.get("variable"));
    									if (set == null) {
    										set = new HashSet<String>();
    										firstOutputMap.put((String)field.get("variable"), set);
    									}
    									set.add((String)field.get("field"));
    									firstAsSet.add((String)field.get("as"));
    								}
    							}
        					}
    						
    						if (secondOutput.get("fields") != null && secondOutput.get("fields") instanceof List) {
    							// step1 class name -> set of field names mapping
    							Map<String, Set<String>> dslClassAttrMap = new HashMap<String, Set<String>>();
    							// step1 set of output aliases
    							Set<String> secondAsSet = new HashSet<String>();
    							List secondFields = (List)secondOutput.get("fields");
    							for (Object f : secondFields) {
    								if (f instanceof Map) {
    									Map field = (Map)f;
    									String[] classAttr = asClassAttrMap.get(field.get("field"));
    									if (classAttr != null) {
    										String className = classAttr[0];
        									String attrName = classAttr[1];
        									Set<String> dslAttrs = dslClassAttrMap.get(className);
        									if (dslAttrs == null) {
        										dslAttrs = new HashSet<String>();
        										dslClassAttrMap.put(className, dslAttrs);
        									}
        									dslAttrs.add(attrName);
    									}
    									secondAsSet.add((String)field.get("as"));
    								}
    							}
    							
    							// Enrich the must-return fields
    							List firstFields = (List)firstOutput.get("fields");
    							for (String className : dslClassAttrMap.keySet()) {
    								String variableName = classVariableMap.get(className);
    								Set<String> dslAttrs = dslClassAttrMap.get(className);
    								for (String bizzAttr : bizzMap.get(className)) {
    									if (!dslAttrs.contains(bizzAttr)) {
    										// Enrich the output fields in step0
    										String firstAsName = "";
    										if (firstOutputMap.get(variableName) == null || !firstOutputMap.get(variableName).contains(bizzAttr)) {
    											Map<String, String> field = new HashMap<String, String>();
    											field.put("variable", variableName);
    											field.put("field", bizzAttr);
    											String as = className.replace("/", "_") + "_" + bizzAttr + "_0";
    											while (firstAsSet.contains(as)) {
    												String letter = as.substring(0, as.lastIndexOf("_"));
    												Integer number = Integer.parseInt(as.substring(as.lastIndexOf("_" + 1)));
    												as = letter + "_" + (number + 1);
    											}
    											firstAsSet.add(as);
    											field.put("as", as);
    											firstFields.add(field);
    											firstAsName = as;
    										} else {
    											for (String asName : asClassAttrMap.keySet()) {
    												String[] classAttr = asClassAttrMap.get(asName);
    												if (className.equals(classAttr[0]) && bizzAttr.equals(classAttr[1])) {
    													firstAsName = asName;
    													break;
    												}
    											}
    										}
    										// Enrich the output fields in step1
    										Map<String, String> field = new HashMap<String, String>();
    										field.put("variable", (String)((Map)secondFields.get(0)).get("variable"));
    										field.put("field", firstAsName);
    										String as = className.replace("/", "_") + "_" + bizzAttr + "_0";
											while (secondAsSet.contains(as)) {
												String letter = as.substring(0, as.lastIndexOf("_"));
												Integer number = Integer.parseInt(as.substring(as.lastIndexOf("_" + 1)));
												as = letter + "_" + (number + 1);
											}
											secondAsSet.add(as);
											field.put("as", as);
											secondFields.add(field);
    									}
    								}
    							}
        					}
    					}
    				}
    			}
    		}
		}
		return JSONArray.toJSONString(dsl, Feature.WriteMapNullValue);
	}
	
	public static Map<String, Set<String>> getAttrNameByDsl(String dslStr) {
		List<Map> dsl = JSONArray.parseArray(dslStr, Map.class);
		
		Map<String, Set<String>> classAttrsMap = new HashMap<String, Set<String>>();
		for (Map question : dsl) {
    		if (question.get("answer") != null && question.get("answer") instanceof Map) {
    			Map answer = (Map)question.get("answer");
    			if (answer.get("steps") != null && answer.get("steps") instanceof List) {
    				List steps = (List)answer.get("steps");
    				if (steps.size() == 1) { // single step
    					Map step = (Map)steps.get(0);
    					
    					// class alias -> class name mapping
    					Map<String, String> variableClassMap = new HashMap<String, String>();
    					if (step.get("graph") != null && step.get("graph") instanceof Map) {
							Map graph = (Map)step.get("graph");
							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
								List patterns = (List)graph.get("patterns");
								for (Object pattern : patterns) {
									Map pa = (Map)pattern;
									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
										List objects = (List)pa.get("objects");
										for (Object object : objects) {
											Map obj = (Map)object;
											variableClassMap.put((String)obj.get("variable"), (String)obj.get("class"));
										}
									}
								}
							}
    					}
    					
    					Map output = (Map)(step).get("output");
    					if (output.get("fields") != null && output.get("fields") instanceof List) {
							List fields = (List)output.get("fields");
							// class alias -> set of field names mapping
							Map<String, Set<String>> variableAttrs = new HashMap<String, Set<String>>();
							for (Object f : fields) {
								if (f instanceof Map) {
									Map field = (Map)f;
									if (field.get("variable") != null && field.get("variable") instanceof String) {
										String variable = (String)field.get("variable");
										Set<String> attrs = variableAttrs.get(variable);
										if (attrs == null) {
											attrs = new HashSet<String>();
											variableAttrs.put(variable, attrs);
										}
										attrs.add((String)field.get("field"));
									}
								}
							}
							
							// Return class name, field name
							for (String variable : variableAttrs.keySet()) {
								String className = variableClassMap.get(variable);
								Set<String> attrs = variableAttrs.get(variable);
								classAttrsMap.put(className, attrs);
							}
    					}
    				} else if (steps.size() == 2) { // double step
    					Map firstStep = (Map)steps.get(0);
    					Map firstOutput = (Map)(firstStep).get("output");
    					Map secondStep = (Map)steps.get(1);
    					Map secondOutput = (Map)(secondStep).get("output");
						
						// step0 class alias -> class name mapping
						Map<String, String> variableClassMap = new HashMap<String, String>();
    					if (firstStep.get("graph") != null && firstStep.get("graph") instanceof Map) {
							Map graph = (Map)firstStep.get("graph");
							if (graph.get("patterns") != null && graph.get("patterns") instanceof List) {
								List patterns = (List)graph.get("patterns");
								for (Object pattern : patterns) {
									Map pa = (Map)pattern;
									if (pa.get("objects") != null && pa.get("objects") instanceof List) {
										List objects = (List)pa.get("objects");
										for (Object object : objects) {
											Map obj = (Map)object;
											variableClassMap.put((String)obj.get("variable"), (String)obj.get("class"));
										}
									}
								}
							}
    					}
    					// step0 field alias -> [class name, field name] mapping
						Map<String, String[]> asClassAttrMap = new HashMap<String, String[]>();
						if (firstOutput.get("fields") != null && firstOutput.get("fields") instanceof List) {
							List fields = (List)firstOutput.get("fields");
							for (Object f : fields) {
								if (f instanceof Map) {
									Map field = (Map)f;
									asClassAttrMap.put((String)field.get("as"), new String[] {variableClassMap.get((String)field.get("variable")), (String)field.get("field")});
								}
							}
    					}
						
						// Return class name, field name
						if (secondOutput.get("fields") != null && secondOutput.get("fields") instanceof List) {
							List secondFields = (List)secondOutput.get("fields");
							for (Object f : secondFields) {
								if (f instanceof Map) {
									Map field = (Map)f;
									String[] classAttr = asClassAttrMap.get(field.get("field"));
									if (classAttr != null) {
										String className = classAttr[0];
										String attrName = classAttr[1];
										Set<String> dslAttrs = classAttrsMap.get(className);
										if (dslAttrs == null) {
											dslAttrs = new HashSet<String>();
											classAttrsMap.put(className, dslAttrs);
										}
										dslAttrs.add(attrName);
									}
								}
							}
						}
    				}
    			}
    		}
		}
		return classAttrsMap;
	}
	
	public static Map<String, DslConsanguinity> findConsanguinityFromDsl(JSONObject dsl, List<Map<String, Object>> classDefs) {
		Map<String, Map<String, Set<String>>> classAttrIndicatorsMap = new HashMap<String, Map<String, Set<String>>>();
		Map<String, Map<String, String[]>> classAttrsMap = new HashMap<String, Map<String, String[]>>();
		for (Map<String, Object> classDef : classDefs) {
			String className = (String)classDef.get("className");
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			Map<String, String[]> attrsMap = new HashMap<String, String[]>();
			Map<String, Set<String>> attrIndicatorsMap = new HashMap<String, Set<String>>();
			for (Map<String, Object> attrDef : attrDefs) {
				String attrName = (String)attrDef.get("name");
				attrsMap.put(attrName, new String[] {className, attrName});
				if (attrDef.get("indicators") != null) {
					Set<String> indicators = new HashSet<String>();
					for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
						indicators.add((String)indicatorDef.get("name"));
					}
					attrIndicatorsMap.put(attrName, indicators);
				}
			}
			classAttrsMap.put(className, attrsMap);
			if (attrIndicatorsMap.size() > 0) {
				classAttrIndicatorsMap.put(className, attrIndicatorsMap);
			}
		}
		
		
		String finalClassName  = "";
		// Set of output fields produced by function operations
		Map<String, String> finalHasFunctionAsMap = new HashMap<String, String>();
		// Set of output fields used as groupBy
		Set<String> finalGroupBySet = new HashSet<String>();
		// Output field - metric name mapping of the time series field
		Map<String, DslConsanguinity> finalBucketMap = new HashMap<String, DslConsanguinity>();
		if (dsl.getJSONObject("answer") != null && dsl.getJSONObject("answer").getJSONArray("steps") != null) {
			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			
			for (int i = 0; i < steps.size(); i++) {
				JSONObject step = steps.getJSONObject(i);
				
				Map<String, String> objectVariableClassMap = new HashMap<String, String>();
				if (step.getJSONObject("graph") != null 
						&& step.getJSONObject("graph").getJSONArray("patterns") != null 
						&& step.getJSONObject("graph").getJSONArray("patterns").size() > 0
						&& step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0) != null
						&& step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects") != null) {
					JSONArray objects = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
					for (int j = 0; j < objects.size(); j++) {
						JSONObject object = objects.getJSONObject(j);
						objectVariableClassMap.put(object.getString("variable"), object.getString("class"));
					}
				}
				
				Map<String, Map<String, String[]>> newClassAttrsMap = new HashMap<String, Map<String, String[]>>();
				finalClassName  = "";
				finalHasFunctionAsMap = new HashMap<String, String>();
				finalGroupBySet = new HashSet<String>();
				finalBucketMap = new HashMap<String, DslConsanguinity>();
				if (step.getJSONObject("output") != null) {
					JSONObject output = step.getJSONObject("output");
					
					Set<String> groupByFieldNames = new HashSet<String>();
					if (output.getJSONObject("group_by") != null && output.getJSONObject("group_by").getJSONArray("fields") != null) {
						JSONArray groupByFields = output.getJSONObject("group_by").getJSONArray("fields");
						for (int j = 0; j < groupByFields.size(); j++) {
							JSONObject groupByField = groupByFields.getJSONObject(j);
							if (groupByField.getString("field") != null && !"".equals(groupByField.getString("field").trim())) {
								groupByFieldNames.add(groupByField.getString("field").trim());
							}
						}
					}
					
					Map<String, String[]> attrsMap = new HashMap<String, String[]>();
					if (output.getJSONArray("fields") != null) {
						JSONArray fields = output.getJSONArray("fields");
						for (int j = 0; j < fields.size(); j++) {
							JSONObject field = fields.getJSONObject(j);
							String outputVariable = field.getString("variable");
							String outputField = field.getString("field");
							String outputAs = field.getString("as");
							if (field.getString("expr") != null) {
								attrsMap.put(outputAs, new String[] {"", ""});
								finalHasFunctionAsMap.put(outputAs, "unknownFunction");
							} else {
								if (objectVariableClassMap.get(outputVariable) != null) {
									String className = objectVariableClassMap.get(outputVariable);
									if (classAttrsMap.get(className) != null) {
										Map<String, String[]> oldAttrsMap = classAttrsMap.get(className);
										if (oldAttrsMap.get(outputField) != null) {
											String[] class_attr = oldAttrsMap.get(outputField);
											attrsMap.put(outputAs, class_attr);
											if (field.getString("function") != null && !"".equals(field.getString("function").trim())) {
												finalHasFunctionAsMap.put(outputAs, field.getString("function").trim());
											}
											if (groupByFieldNames.contains(outputField)) {
												finalGroupBySet.add(outputAs);
											}
											if (classAttrIndicatorsMap.get(class_attr[0]) != null && classAttrIndicatorsMap.get(class_attr[0]).get(class_attr[1]) != null) {
												Set<String> indicators = new HashSet<String>();
												indicators.addAll(classAttrIndicatorsMap.get(class_attr[0]).get(class_attr[1]));
												if (field.getJSONArray("conditions") != null) {
													JSONArray conditions = field.getJSONArray("conditions");
													for (int k = 0; k < conditions.size(); k++) {
														JSONObject condition = conditions.getJSONObject(k);
														if ("name".equals(condition.getString("metric"))) {
															Set<String> condIndicators = new HashSet<String>();
															if ("=".equals(condition.getString("operator"))) {
																condIndicators.add(condition.getString("value").trim());
															} else if ("in".equals(condition.getString("operator"))) {
																JSONArray value = condition.getJSONArray("value");
																for (int l = 0; l < value.size(); l++) {
																	condIndicators.add(value.getString(l).trim());
																}
															} else if ("like".equals(condition.getString("operator"))) {
																String like = condition.getString("value").trim();
																for (String indicator : indicators) {
																	if (indicator.indexOf(like) >= 0) {
																		condIndicators.add(indicator);
																	}
																}
															}
															indicators.retainAll(condIndicators);
														}
													}
												}
												DslConsanguinity consanguinity = new DslConsanguinity();
												consanguinity.setOutputKey(outputAs);
												consanguinity.setClassName(class_attr[0]);
												consanguinity.setAttrName(class_attr[1]);
												consanguinity.setIndicatorNames(indicators);
												consanguinity.setFunction(field.getString("function") != null && !"".equals(field.getString("function").trim()) ? field.getString("function").trim() : null);
												consanguinity.setAsGroupBy(false);
												finalBucketMap.put(outputAs, consanguinity);
											}
										} else {
											attrsMap.put(outputAs, new String[] {"", ""});
											finalHasFunctionAsMap.put(outputAs, "unknownFunction");
										}
									}
								}
							}
						}
					}
					
					String newClassName = output.getString("save_table") != null ? output.getString("save_table") : "/final_class";
					newClassAttrsMap.put(newClassName, attrsMap);
					finalClassName  = newClassName + "";
				}
				
				classAttrsMap = newClassAttrsMap;
			}
		}
		
		Map<String, DslConsanguinity> asClassAttrFunctionMap = new HashMap<String, DslConsanguinity>();
		if (classAttrsMap.get(finalClassName) != null) {
			Map<String, String[]> asClassAttrMap = classAttrsMap.get(finalClassName);
			for (String as : asClassAttrMap.keySet()) {
				String[] class_attr = asClassAttrMap.get(as);
				String className = class_attr[0];
				String attrName = class_attr[1];
				DslConsanguinity consanguinity = new DslConsanguinity();
				consanguinity.setOutputKey(as);
				consanguinity.setClassName(className);
				consanguinity.setAttrName(attrName);
				consanguinity.setFunction(finalHasFunctionAsMap.get(as));
				consanguinity.setAsGroupBy(finalGroupBySet.contains(as));
				asClassAttrFunctionMap.put(as, consanguinity);
			}
		}
		for (String as : finalBucketMap.keySet()) {
			asClassAttrFunctionMap.put(as, finalBucketMap.get(as));
		}
		return asClassAttrFunctionMap;
	}
	
	public static String removeFieldHavingExprForEvaluator(String dslStr) {
		List<Map> dsls = JSONArray.parseArray(dslStr, Map.class);
		for (Map dsl : dsls) {
			List<Object> steps = (List<Object>)((Map<String, Object>)dsl.get("answer")).get("steps");
			Map<String, Object> lastStep = (Map<String, Object>)steps.get(steps.size() - 1);
			List<Map<String, Object>> fields = (List<Map<String, Object>>)((Map<String, Object>)lastStep.get("output")).get("fields");
			for (Map<String, Object> field : fields) {
				if (field.get("expr") != null) {
					field.remove("field");
				}
			}
		}
		return JSONArray.toJSONString(dsls, Feature.WriteMapNullValue);
	}
	
	public static Object[] splitToVector(String dslStr, List<Map<String, Object>> classDefs, VectorResourceDao vectorResourceDao, String domainId, boolean useM3) throws Exception {
		JSONArray dsls = JSON.parseArray(dslStr);
		Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
		for (Map<String, Object> classDef : classDefs) {
			classDefMap.put((String)classDef.get("className"), classDef);
		}
		
		JSONObject dsl = dsls.getJSONObject(0);
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");

		// Handle the vector of where
		Map<String, Set<String>> whereClassIdsMap = new HashMap<String, Set<String>>();
		JSONObject firstStep = steps.getJSONObject(0);
		JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			String className = object.getString("class");
			Map<String, Object> classDef = classDefMap.get(className);
			Set<String> vectorAttrs = new HashSet<String>();
			if (classDef != null && classDef.get("attrs") != null) {
				for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
					if ("vector".equals(attrDef.get("type"))) {
						vectorAttrs.add((String)attrDef.get("name"));
					}
				}
			}
				if (object.getJSONObject("conditions") != null 
						&& object.getJSONObject("conditions").getJSONObject("vector") != null
						&& object.getJSONObject("conditions").getJSONObject("vector").getJSONObject("properties") != null) {
					JSONObject conditions = object.getJSONObject("conditions");
					JSONObject vectorProperties = conditions.getJSONObject("vector").getJSONObject("properties");
					String andOr = "";
					JSONArray conds = null;
					if (vectorProperties.getJSONArray("and") != null && vectorProperties.getJSONArray("and").size() > 0) {
						andOr = "and";
						conds = vectorProperties.getJSONArray("and");
					} else if (vectorProperties.getJSONArray("or") != null && vectorProperties.getJSONArray("or").size() > 0) {
						andOr = "or";
						conds = vectorProperties.getJSONArray("or");
					}
					if (conds != null) {
						List<Set<String>> objIdsList = new ArrayList<Set<String>>();
						for (int j = 0; j < conds.size(); j++) {
							JSONObject cond = conds.getJSONObject(j);
							if (vectorAttrs.contains(cond.getString("field")) && cond.getString("query") != null && !"".equals(cond.getString("query").trim())) {
								// Query the vector store
								String queryStr = cond.getString("query").trim();
								int total = vectorResourceDao.getResourceTotal(className, cond.getString("field"), domainId);
								List<VectorResource> vectorResources = vectorResourceDao.find(queryStr, total, className, cond.getString("field"), domainId);
								Set<String> objIds = new HashSet<String>();
								for (VectorResource vectorResource : vectorResources) {
									objIds.add(vectorResource.getObjectId());
								}
								objIdsList.add(objIds);
							}
						}
						if (objIdsList.size() > 0) {
							Set<String> objIds = objIdsList.get(0);
							for (int j = 1; j < objIdsList.size(); j++) {
								if ("and".equals(andOr)) {
									objIds.retainAll(objIdsList.get(j));
								} else if ("or".equals(andOr)) {
									objIds.addAll(objIdsList.get(j));
								}
							}
							whereClassIdsMap.put(className, objIds);
						}
					}
					conditions.remove("vector");
				}
			}
			
			// Handle the vector of select
			Map<String, Set<String>> selectClassIdsMap = new HashMap<String, Set<String>>();
			Map<String, List<String>> selectAsFilePathsMap = new HashMap<String, List<String>>();
			Set<String> vectorResourceAsSet = new HashSet<String>();
			Map<String, DslConsanguinity> consanguinityMap = findConsanguinityFromDsl(dsl, classDefs);
			JSONObject lastStep = steps.getJSONObject(steps.size() - 1);
			JSONArray fields = lastStep.getJSONObject("output").getJSONArray("fields");
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				String as = field.getString("as");
				DslConsanguinity consanguinity = consanguinityMap.get(as);
				if (consanguinity == null) {
					continue;
				}
				String className = consanguinity.getClassName();
				String attrName = consanguinity.getAttrName();
				Map<String, Object> classDef = classDefMap.get(className);
				boolean typeIsVector = false;
				if (classDef != null && classDef.get("attrs") != null) {
					for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
						if (attrName.equals(attrDef.get("name")) && "vector".equals(attrDef.get("type"))) {
							typeIsVector = true;
							break;
						}
					}
				}
				if (typeIsVector) {
					if (field.getString("query") != null && !"".equals(field.getString("query").trim())) {
						// Query the vector store
						String queryStr = field.getString("query").trim();
						int total = vectorResourceDao.getResourceTotal(className, attrName, domainId);
						List<VectorResource> vectorResources = vectorResourceDao.find(queryStr, total, className, attrName, domainId);
						Set<String> objIds = new HashSet<String>();
						List<String> filePaths = new ArrayList<String>();
						for (VectorResource vectorResource : vectorResources) {
							objIds.add(vectorResource.getObjectId());
							filePaths.add(vectorResource.getPath());
						}
						
						Set<String> ids = selectClassIdsMap.get(className);
						if (ids == null) {
							selectClassIdsMap.put(className, objIds);
						} else {
							ids.retainAll(objIds);
						}
						
						selectAsFilePathsMap.put(as, filePaths);
						field.remove("query");
					}
					vectorResourceAsSet.add(as);
				}
			}
			
			// Put the objIds corresponding to the vector back into the where conditions
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				String className = object.getString("class");
				
				Set<String> whereIds = whereClassIdsMap.get(className);
				Set<String> selectIds = selectClassIdsMap.get(className);
				Set<String> objIds = null;
				if (whereIds != null && selectIds != null) { // Both have: take the intersection
					objIds = whereIds;
					objIds.retainAll(selectIds);
				} else if (whereIds != null && selectIds == null) { // Only one has it
					objIds = whereIds;
				} else if (whereIds == null && selectIds != null) { // Only one has it
					objIds = selectIds;
				}
				
				if (objIds != null) {
					if (objIds.size() == 0) {
						objIds.add("not found");
					}
					JSONObject idInArray = new JSONObject();
					idInArray.put("field", useM3 ? "id" : getPrimaryKey(classDefMap.get(className)));
					idInArray.put("operator", "in");
					idInArray.put("value", objIds);
					
					JSONObject conditions = object.getJSONObject("conditions");
					if (conditions == null) {
						conditions = new JSONObject();
						object.put("conditions", conditions);
					}
					JSONObject properties = conditions.getJSONObject("properties");
					if (properties == null) {
						properties = new JSONObject();
						properties.put("operator", "logic");
						JSONArray and = new JSONArray();
						and.add(idInArray);
						properties.put("and", and);
						conditions.put("properties", properties);
					} else {
						JSONObject newProperties = new JSONObject();
						newProperties.put("operator", "logic");
						JSONArray and = new JSONArray();
						and.add(idInArray);
						and.add(properties);
						newProperties.put("and", and);
						conditions.put("properties", newProperties);
					}
				} // Neither has it: no need to merge
			}
			log.info("vector-dsl:" + JSON.toJSONString(dsl, JSONWriter.Feature.WriteNulls) + "    " + selectAsFilePathsMap + "    " + vectorResourceAsSet);
			
			return new Object[] {dsl, selectAsFilePathsMap, vectorResourceAsSet};
	}

	/**
	 * Resolve the primary-key field name of a class definition.
	 *
	 * <p>M3 objects always use the implicit {@code id} field; relational adapters use the attribute marked
	 * {@code primaryKey=true}. When no attribute is marked, this falls back to {@code "id"} so that the result
	 * stays identical to the historical hard-coded {@code "id"} for classes without an explicit primary key.</p>
	 */
	public static String getPrimaryKey(Map<String, Object> classDef) {
		String pk = "id";
		if (classDef != null && classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
						pk = (String)attrDef.get("name");
					}
				}
			}
		}
		return pk;
	}

	/**
	 * Parse a vector attribute value into a JSON array.
	 *
	 * <p>A vector attribute is stored as a text column holding the JSON array string
	 * {@code [{"path":"...","text":"..."},...]}. Accepts a {@link JSONArray}, a JSON array
	 * string, or {@code null}; anything else (or an unparseable string) yields an empty array.</p>
	 */
	public static JSONArray parseVectorAttr(Object value) {
		JSONArray result = new JSONArray();
		if (value == null) {
			return result;
		}
		if (value instanceof JSONArray) {
			return (JSONArray) value;
		}
		if (value instanceof String) {
			String s = ((String) value).trim();
			if (s.isEmpty()) {
				return result;
			}
			try {
				JSONArray parsed = JSON.parseArray(s);
				return parsed == null ? result : parsed;
			} catch (Exception e) {
				return result;
			}
		}
		return result;
	}

	public static boolean isSupportM3ModeV1(JSONObject dsl, List<Map<String, Object>> classDefs) {
		boolean fourBasic = false;
		Map<String, DslConsanguinity> consanguinityMap = findConsanguinityFromDsl(dsl, classDefs);
		for (String key : consanguinityMap.keySet()) {
			DslConsanguinity consanguinity = consanguinityMap.get(key);
			if (consanguinity.getAttrName() == null || "".equals(consanguinity.getAttrName().trim())) {
				fourBasic = true;
				break;
			}
		}
		return !fourBasic;
	}
	
}
