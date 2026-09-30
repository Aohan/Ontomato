package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONWriter;
import io.ontomato.dataengine.service.JSONCorrector;

import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
public class JSONCheckUtil {
	public static class Result {
		public String queryJson;
		public boolean legal;
		public Map<String, String> illegalMap; // answer, steps, graph, patterns, checkObjectsColumn, checkRelationShip, checkOutputColumn
		
		public String getQueryJson() {
			return queryJson;
		}
		public void setQueryJson(String queryJson) {
			this.queryJson = queryJson;
		}
		public boolean isLegal() {
			return legal;
		}
		public void setLegal(boolean legal) {
			this.legal = legal;
		}
		public Map<String, String> getIllegalMap() {
			return illegalMap;
		}
		public void setIllegalMap(Map<String, String> illegalMap) {
			this.illegalMap = illegalMap;
		}
		
		public String toIllegalContent() {
			StringBuffer sb = new StringBuffer();
			if (this.illegalMap != null) {
				for (String key: this.illegalMap.keySet()) {
					sb.append(this.illegalMap.get(key));
				}
			}
			return sb.toString();
		}
	}
	
	private static void appendIllegalMap(Result result, String illegalType, String illegalMessage) {
		if (illegalMessage != null && !"".equals(illegalMessage.trim())) {
			Map<String, String> illegalMap = result.getIllegalMap();
			if (illegalMap == null) {
				illegalMap = new HashMap<String, String>();
				result.setIllegalMap(illegalMap);
			}
			if (illegalMap.containsKey(illegalType)) {
				illegalMap.put(illegalType, illegalMap.get(illegalType) + illegalMessage.trim());
			} else {
				illegalMap.put(illegalType, illegalMessage.trim());
			}
			result.setLegal(false);
		}
	}
	
    public static Result checkJSON(String queryJson, Map<String, Object> mapRule, JSONCorrector jsonCorrector, String domainId, String sessionId) {
    	Result result = null;
    	
        if (queryJson == null || queryJson.length() == 0) {
            return result;
        }

        // Load the JSON rule file
        Map mapRuleRelationships = (Map) mapRule.get("relationship_rule");
        List classDefs = (List) mapRule.get("classDef");

        if (queryJson.trim().startsWith("{")) {
        	queryJson = "[" + queryJson + "]";
        }
        List<Map> listQuery = jsonCorrector == null ? JSONArray.parseArray(queryJson).toList(Map.class) : jsonCorrector.parseArray(queryJson, domainId, sessionId).toList(Map.class);
        result = new Result();
//        result.setQueryJson(queryJson);
        result.setLegal(true);
        for (Map mapQuery : listQuery) {
        	if (mapQuery.get("answer") != null && mapQuery.get("answer") instanceof Map) {
        		Map mapAnswer = (Map) mapQuery.get("answer");
        		if (mapAnswer.get("steps") != null && mapAnswer.get("steps") instanceof List) {
        			List<Map> listSteps = (List<Map>) mapAnswer.get("steps");
                    int stepNum = 0;
                    
                    // Alias to real className and attrName mapping
                    Map<String, String> variableClassMap = new HashMap<String, String>();
                    Map<String, String[]> asClassFieldMap = new HashMap<String, String[]>();
                    for (Map mapStep : listSteps) {

                        // Step check
                        String stepCheckResult = checkSteps(stepNum, mapStep);
                        appendIllegalMap(result, "steps", stepCheckResult);

                        // Check the where part
                        if (mapStep.get("graph") != null && mapStep.get("graph") instanceof Map) {
                        	Map mapGraph = (Map) mapStep.get("graph");
                        	if (mapGraph.get("patterns") != null && mapGraph.get("patterns") instanceof List) {
                        		List<Map> listPatterns = (List<Map>) mapGraph.get("patterns");
                                for (Map mapPattern : listPatterns) {
                                    List<Map> listRelationship = mapPattern.get("relationship") != null && mapPattern.get("relationship") instanceof List ? (List<Map>) mapPattern.get("relationship") : new ArrayList<Map>();
                                    List<Map> listObjects = mapPattern.get("objects") != null && mapPattern.get("objects") instanceof List ? (List<Map>) mapPattern.get("objects") : new ArrayList<Map>();

                                    // Check whether the fields in objects belong to the class, and check the validity of the indicator in the bucket field
                                    appendIllegalMap(result, "checkObjectsColumn", checkObjectsColumn(listObjects, classDefs, stepNum, variableClassMap));
                                    // Check the relationship direction
                                    if (listRelationship.size() > 0) {
                                        String checkResult = checkRelationShip(listObjects, listRelationship, mapRuleRelationships);
                                        appendIllegalMap(result, "checkRelationShip", checkResult);
                                    }
                                }
                        	} else {
                        		appendIllegalMap(result, "patterns", "The graph object must have a patterns attribute and it should be an array, ");
                        	}
                        } else {
                        	appendIllegalMap(result, "graph", "The step object must have a graph attribute and it should be an object, ");
                        }
                        // Check the select part
                        appendIllegalMap(result, "checkOutputColumn", checkOutputColumn(mapStep, classDefs, stepNum, variableClassMap, asClassFieldMap));

                        stepNum++;
                    }
        		} else {
        			appendIllegalMap(result, "steps", "The answer object must have a steps attribute and it should be an array, ");
        		}
        	} else {
        		appendIllegalMap(result, "answer", "There must be an answer attribute and it should be an object, ");
        	}
        }

        result.setQueryJson(JSON.toJSONString(listQuery,JSONWriter.Feature.WriteNulls));
        return result;
    }

    public static String correctJson(String queryJson){
        // Replace the non-JSON characters in the LLM output
//        if (queryJson.startsWith("```json") || queryJson.endsWith("```")) {
//            queryJson = queryJson.replace("```json", "");
//            queryJson = queryJson.replace("```", "");
//        }
//        queryJson = queryJson.replace("<s>", "");
//        queryJson = queryJson.replace("</s>", "");
//        queryJson = queryJson.replace("<final_answer>", "");
//        queryJson = queryJson.replace("</final_answer>", "");
//        queryJson = queryJson.replace("<thinking>", "");
//        queryJson = queryJson.replace("</thinking>", "");
//        queryJson = queryJson.replace("<response>", "").replace("</response>", "");
    	
    	int startJson = queryJson.indexOf("```json");
    	int endJson = queryJson.lastIndexOf("```");
    	if (startJson >= 0 && endJson > startJson) {
    		queryJson = queryJson.substring(startJson + 7, endJson);
    	}
    	
    	queryJson.replace("```json", "");
    	queryJson.replace("```", "");
    	
        return queryJson;
    }

    /**
     * Check whether the relationships comply with the rules
     * This method is used to verify whether the given object list and relationship list comply with the specific relationship rules
     *
     * @param listObjects          object list, containing the information of each object
     * @param listRelationship     relationship list, containing the relationship information to be verified
     * @param mapRuleRelationships relationship rule dictionary, defining the rules of different relationship types
     * @return returns a string describing the check result; if there is an error, returns the error message; otherwise returns an empty string
     */
    private static String checkRelationShip(List<Map> listObjects, List<Map> listRelationship, Map mapRuleRelationships) {
        String checkResult = null;
        StringBuffer sbCheckResult = new StringBuffer();

        // Convert the object list into dictionary form for fast access by index
        Map<Integer, Map> mapObjects = new HashMap<>();
        for (Map mapObject : listObjects) {
        	if (mapObject.get("idx") != null && mapObject.get("idx") instanceof Integer) {
        		int objectIDX = (int) mapObject.get("idx");
                mapObjects.put(objectIDX, mapObject);
        	} else {
        		return "The object must have an idx attribute and it should be an integer, ";
        	}
        }

        // Iterate over the relationship list and check whether each relationship complies with the rules
        for (Map mapRelationship : listRelationship) {
        	if (mapRelationship.get("type") != null && mapRelationship.get("type") instanceof List) {
        		List<String> listRelationshipType = (List<String>) mapRelationship.get("type");
                
                Integer relationshipFrom = null;
                if (mapRelationship.get("from") != null && mapRelationship.get("from") instanceof Integer) {
                	relationshipFrom = (int) mapRelationship.get("from");
                } else {
                	sbCheckResult.append("The relationship object must have a from attribute and it should be an integer, ");
                }
                Integer relationshipTo = null;
                if (mapRelationship.get("to") != null && mapRelationship.get("to") instanceof Integer) {
                	relationshipTo = (int) mapRelationship.get("to");
                } else {
                	sbCheckResult.append("The relationship object must have a to attribute and it should be an integer, ");
                }
                
                if (relationshipFrom != null && relationshipTo != null) {
                	// Get the information of the source object and target object of the relationship
                    if (mapObjects.get(relationshipFrom) != null) {
                    	Map mapObjectFrom = mapObjects.get(relationshipFrom);
                    	if (mapObjects.get(relationshipTo) != null) {
                    		Map mapObjectTo = mapObjects.get(relationshipTo);

                            // Iterate over the relationship type list and verify each relationship type
                            for (String relationshipType : listRelationshipType) {
                            	if (!"*".equals(relationshipType)) {
                            		if (mapRuleRelationships.get(relationshipType) != null) {
                                		Map mapRuleRelationship = (Map) mapRuleRelationships.get(relationshipType);

                                        // Verify the relationship type according to the relationship rules
                                        if (mapObjectFrom.get("class") != null && mapObjectFrom.get("class").equals(mapRuleRelationship.get("toclass")) &&
                                        		mapObjectTo.get("class") != null && mapObjectTo.get("class").equals(mapRuleRelationship.get("fromclass"))) {
                                        	if (!mapObjectFrom.get("class").equals(mapRuleRelationship.get("fromclass")) || !mapObjectTo.get("class").equals(mapRuleRelationship.get("toclass"))) {
                                        		// Error, the class direction is reversed
                                                // sbCheckResult.append(relationshipType).append("the direction of the source class and target class of the relationship is reversed,");
                                                // The direction of the source class and target class of the relationship is reversed, forcibly modify the direction
                                                mapRelationship.put("from",relationshipTo);
                                                mapRelationship.put("to",relationshipFrom);
                                                log.warn(">>>{} the direction of the source class and target class of the relationship is reversed, forcibly modify the direction",relationshipType);
                                        	}
                                        } else if (mapObjectFrom.get("class") != null && !mapObjectFrom.get("class").equals(mapRuleRelationship.get("fromclass"))) {
                                            // Error, wrong source class
                                            sbCheckResult.append(relationshipType).append(" relationship source class error, ");
                                        } else if (mapObjectTo.get("class") != null && !mapObjectTo.get("class").equals(mapRuleRelationship.get("toclass"))) {
                                            // Error, wrong target class
                                            sbCheckResult.append(relationshipType).append(" relationship target class error, ");
                                        } else {
                                            // Correct
                                        }
                                	} else {
                                		sbCheckResult.append(relationshipType).append(" relationship type '" + relationshipType + "' does not exist in the database, ");
                                	}
                            	}
                            }
                    	} else {
                    		sbCheckResult.append("The to value of the relationship has no corresponding idx in objects, ");
                    	}
                    } else {
                    	sbCheckResult.append("The from value of the relationship has no corresponding idx in objects, ");
                    }
                }
        	} else {
        		sbCheckResult.append("The relationship object must have a type attribute and it should be an array, ");
        	}
        }

        // Convert the check result to a string and return it
        checkResult = sbCheckResult.toString();
        return checkResult;
    }

    /**
     * Check whether the value corresponding to the "class" key of an object in the list can be found in the given class definitions, and verify whether all attributes in the conditions are among the attributes of the class definition
     *
     * @param listObjects list containing multiple objects, each object is a mapping
     * @param classDefs   list of class definitions, each class definition is also a mapping
     * @return returns a string containing the error messages found during verification
     */
    private static String checkObjectsColumn(List<Map> listObjects, List classDefs, int stepNum, Map<String, String> variableClassMap) {
        // Used to store the error messages during verification
        StringBuffer sbCheckResult = new StringBuffer();
        
        // Build the indicator mapping of the bucket type fields
        Map<String, Map<String, Set<String>>> classBucketIndicatorMap = new HashMap<String, Map<String, Set<String>>>();
        for (Object cd : classDefs) {
        	Map def = (Map) cd;
        	String className = (String) def.get("className");
        	Map<String, Set<String>> bucketIndicatorMap = classBucketIndicatorMap.get(className);
        	if (bucketIndicatorMap == null) {
        		bucketIndicatorMap = new HashMap<String, Set<String>>();
        		classBucketIndicatorMap.put(className, bucketIndicatorMap);
        	}
        	for (Map<String, Object> attrDef : (List<Map<String, Object>>)def.get("attrs")) {
        		if ("bucket".equals(attrDef.get("type"))) {
        			String bucketName = (String)attrDef.get("name");
        			Set<String> indicators = bucketIndicatorMap.get(bucketName);
        			if (indicators == null) {
        				indicators = new HashSet<String>();
        				bucketIndicatorMap.put(bucketName, indicators);
        			}
        			for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
        				indicators.add((String)indicatorDef.get("name"));
        			}
        		}
        	}
        }

        // Iterate over each object in the list
        for (Map object : listObjects) {
            // Check whether the object contains a non-empty "class" key
            if (object.containsKey("class") && object.get("class") != null) {
                // Initialize the class definition to null, used to store the found class definition
                Map classDef = null;
                // Iterate over the class definition list to find the class definition matching the "class" key of the object
                for (Object cd : classDefs) {
                    Map def = (Map) cd;
                    // When a matching class definition is found, store it in classDef and stop searching
                    if (((String) def.get("className")).equals(object.get("class"))) {
                        classDef = def;
                        break;
                    }
                }
                
                // If the corresponding class definition is found
                if (classDef != null) {
                	String className = (String)classDef.get("className");
                	if (stepNum == 0) {
                		variableClassMap.put((String)object.get("variable"), className);
                	}
                    // Check whether the object contains conditions and the conditions are a mapping
                    if (object.containsKey("conditions") && object.get("conditions") instanceof Map) {
                        Map conditions = (Map) object.get("conditions");
                        // Check the validity of the normal type conditions
                        if (conditions.containsKey("properties") && conditions.get("properties") instanceof Map) {
                            Map root = (Map) conditions.get("properties");

                            // Used to store the names of all attributes in the class definition
                            Set<String> columnSet = new HashSet<String>();
                            // Add all attribute names in the class definition to columnSet
                            for (Map attrDef : (List<Map>) classDef.get("attrs")) {
                                columnSet.add((String) attrDef.get("name"));
                            }

                            // Initialize a queue for breadth-first search of the condition tree
                            List<Map> queue = new ArrayList<Map>();
                            queue.add(root);
                            // While the queue is not empty, continue the breadth-first search
                            while (queue.size() > 0) {
                                Map map = queue.remove(0);
                                List<Map> children = null;
                                // Check whether the current condition contains and, or or not sub-conditions, and update the children variable accordingly
                                if (map.containsKey("and") && map.get("and") instanceof List) {
                                	map.put("operator", "logic");
                                    children = (List) map.get("and");
                                } else if (map.containsKey("or") && map.get("or") instanceof List) {
                                	map.put("operator", "logic");
                                    children = (List) map.get("or");
                                } else if (map.containsKey("not") && map.get("not") instanceof List) {
                                	map.put("operator", "logic");
                                    children = (List) map.get("not");
                                }
                                // If there are no sub-conditions
                                if (children == null) {
                                    // Check whether the current condition contains a field and whether the field is in columnSet
                                    if (map.containsKey("field") && !columnSet.contains(map.get("field"))) {
                                        // If the field is not in columnSet, add the error message to sbCheckResult
                                        sbCheckResult.append(classDef.get("className") + " class has no " + map.get("field") + " field, ");
                                    }
                                } else {
                                    // If there are sub-conditions, add the sub-conditions to the queue
                                    for (Map child : children) {
                                        queue.add(child);
                                    }
                                }
                            }
                        }
                        // Check the validity of the bucket type conditions
                        if (conditions.containsKey("timeseries") && conditions.get("timeseries") instanceof Map) {
                        	Map timeseries = (Map)conditions.get("timeseries");
                        	if (timeseries.containsKey("properties") && timeseries.get("properties") instanceof Map) {
                        		Map properties = (Map)timeseries.get("properties");
                        		List conds = null;
                        		if (properties.containsKey("and") && properties.get("and") instanceof List) {
                        			conds = (List)properties.get("and");
                        		} else if (properties.containsKey("or") && properties.get("or") instanceof List) {
                        			conds = (List)properties.get("or");
                        		} else if (properties.containsKey("not") && properties.get("not") instanceof List) {
                        			conds = (List)properties.get("not");
                        		}
                        		if (conds != null) {
                        			for (Object cond : conds) {
                        				if (cond instanceof Map) {
                        					Map bucketCond = (Map)cond;
                        					if (bucketCond.containsKey("field") && bucketCond.get("field") instanceof String && bucketCond.containsKey("conditions") && bucketCond.get("conditions") instanceof List) {
                        						String field = (String)bucketCond.get("field");
                        						if (classBucketIndicatorMap.get(className) == null || classBucketIndicatorMap.get(className).get(field) == null) {
                        							sbCheckResult.append(className + " class has no bucket type " + field + " field, ");
                        						} else {
                        							Map<String, Set<String>> bucketIndicatorMap = classBucketIndicatorMap.get(className);
                        							
                        							List bucketConditions = (List)bucketCond.get("conditions");
                            						for (Object bucketConditionObj : bucketConditions) {
                            							Map bucketCondition = (Map)bucketConditionObj;
                            							if ("name".equals(bucketCondition.get("metric")) && bucketCondition.containsKey("value") && bucketCondition.get("value") instanceof String) {
                            								String indicator = (String)bucketCondition.get("value");
                            								List<String> parentBuckets = new ArrayList<String>();
                            								for (String parentBucket : bucketIndicatorMap.keySet()) {
                            									if (bucketIndicatorMap.get(parentBucket).contains(indicator)) {
                            										parentBuckets.add(parentBucket);
                            									}
                            								}
                            								if (parentBuckets.size() > 0) {
                            									Set<String> indicators = bucketIndicatorMap.get(field);
                            									if (!indicators.contains(indicator)) {
                            										if (parentBuckets.size() == 1) {
                            											bucketCond.put("field", parentBuckets.get(0));
                            										} else {
                            											sbCheckResult.append(className + " class's bucket type " + field + " field has no " + indicator + " metric, ");
                            										}
                            									}
                            								} else {
                            									sbCheckResult.append(className + " class's bucket type " + field + " field has no " + indicator + " metric, ");
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
        // Return the error messages during verification
        return sbCheckResult.toString();
    }

    /**
     * Check whether the query conditions and output settings in a step comply with the specification
     * This method aims to ensure that query operations (attribute condition query, full-text search query, vector query, time series query)
     * and data operations (group_by, limit, sort) do not appear in the same step at the same time
     *
     * @param stepNum step number, used to identify the specific step in the result
     * @param mapStep mapping table containing the step details, used to check the step configuration
     * @return returns the check result string; if there is anything not compliant, it contains the corresponding error message
     */
    private static String checkSteps(int stepNum, Map mapStep) {
        StringBuffer sbCheckResult = new StringBuffer();

        // Get the query conditions
        boolean hasQuery = false;
        if (mapStep.get("graph") != null && mapStep.get("graph") instanceof Map) {
        	Map mapGraph = (Map) mapStep.get("graph");
        	if (mapGraph.get("patterns") != null && mapGraph.get("patterns") instanceof List) {
        		List<Map> listPatterns = (List<Map>) mapGraph.get("patterns");
                for (Map mapPattern : listPatterns) {
                	if (mapPattern.get("objects") != null && mapPattern.get("objects") instanceof List) {
                		List<Map> listObjects = (List<Map>) mapPattern.get("objects");
                        for (Map mapObject : listObjects) {
                            if (mapObject.get("conditions") != null && mapObject.get("conditions") instanceof Map) {
                            	Map mapConditions = (Map) mapObject.get("conditions");

								// Check the condition syntax and automatically correct it if there is an error
								checkConditions(mapConditions);

                            	if (mapConditions.containsKey("properties")
                                                || mapConditions.containsKey("text")
                                                || mapConditions.containsKey("vector")
                                                || mapConditions.containsKey("timeseries")) {
                                    // Attribute condition query / full-text search query / vector query / time series query
                                    hasQuery = true;
                                    break;
                                }
                            }
                        }

                        if (hasQuery) {
                            // There is a query, stop the check
                            break;
                        }
                	} else {
                		sbCheckResult.append("The pattern object must have an objects attribute and it should be an array, ");
                	}
                }
                // Get whether the Output contains group_by, limit, sort
                if (mapStep.get("output") != null && mapStep.get("output") instanceof Map) {
                	Map mapOutput = (Map) mapStep.get("output");
                    boolean hasGLS = false;
                    if (mapOutput.containsKey("group_by") || mapOutput.containsKey("limit") || mapOutput.containsKey("sort")) {
                        hasGLS = true;
                    }

                    if (hasQuery && hasGLS) {
                        sbCheckResult.append("Step " + stepNum + ": query and group_by/limit/sort cannot be implemented in the same step.\n");
                    }

					// Check whether the syntax in the Output is correct
					checkOutput(mapOutput);

                } else {
                	sbCheckResult.append("The step object must have an output attribute and it should be an object, ");
                }
        	} else {
        		sbCheckResult.append("The graph object must have a patterns attribute and it should be an array, ");
        	}
        } else {
        	sbCheckResult.append("The step object must have a graph attribute and it should be an object, ");
        }

        return sbCheckResult.toString();
    }
    
    private static String checkOutputColumn(Map mapStep, List classDefs, int stepNum, Map<String, String> variableClassMap, Map<String, String[]> asClassFieldMap) {
    	StringBuffer sbCheckResult = new StringBuffer();
    	
    	Map<String, Set<String>> objectVariableClassNameMap = new HashMap<String, Set<String>>();
    	if (mapStep.get("graph") != null && mapStep.get("graph") instanceof Map) {
    		Map mapGraph = (Map) mapStep.get("graph");
    		if (mapGraph.get("patterns") != null && mapGraph.get("patterns") instanceof List) {
    			List<Map> listPatterns = (List<Map>) mapGraph.get("patterns");
                for (Map mapPattern : listPatterns) {
                	if (mapPattern.get("objects") != null && mapPattern.get("objects") instanceof List) {
                		List<Map> listObjects = (List<Map>) mapPattern.get("objects");
                		for (Map object : listObjects) {
                    		String variable = object.get("variable") == null ? null : (String)object.get("variable");
                    		String className = object.get("class") == null ? null : (String)object.get("class");
                    		if (variable != null && className != null) {
                    			variable = variable.trim();
                    			Set<String> classNames = objectVariableClassNameMap.get(variable);
                    			if (classNames == null) {
                    				classNames = new HashSet<String>();
                    				objectVariableClassNameMap.put(variable, classNames);
                    			}
                    			classNames.add(className.trim());
                    		}
                    	}
                	}
                }
    		}
    	}
        
        for (String variable : objectVariableClassNameMap.keySet()) {
        	Set<String> classNames = objectVariableClassNameMap.get(variable);
        	if (classNames.size() > 1) {
        		sbCheckResult.append("the variable \"" + variable + "\" defined in graph.patterns.objects has more than 1 class name, which makes the definition of the output field in output ambiguous, ");
        	}
        }
        if (sbCheckResult.length() > 0) {
        	return sbCheckResult.toString();
        } else {
        	// Build the indicator mapping of the bucket type fields
            Map<String, Map<String, Set<String>>> classBucketIndicatorMap = new HashMap<String, Map<String, Set<String>>>();
            for (Object cd : classDefs) {
            	Map def = (Map) cd;
            	String className = (String) def.get("className");
            	Map<String, Set<String>> bucketIndicatorMap = classBucketIndicatorMap.get(className);
            	if (bucketIndicatorMap == null) {
            		bucketIndicatorMap = new HashMap<String, Set<String>>();
            		classBucketIndicatorMap.put(className, bucketIndicatorMap);
            	}
            	for (Map<String, Object> attrDef : (List<Map<String, Object>>)def.get("attrs")) {
            		if ("bucket".equals(attrDef.get("type"))) {
            			String bucketName = (String)attrDef.get("name");
            			Set<String> indicators = bucketIndicatorMap.get(bucketName);
            			if (indicators == null) {
            				indicators = new HashSet<String>();
            				bucketIndicatorMap.put(bucketName, indicators);
            			}
            			for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
            				indicators.add((String)indicatorDef.get("name"));
            			}
            		}
            	}
            }
        	
        	if (mapStep.get("output") != null && mapStep.get("output") instanceof Map) {
        		Map mapOutput = (Map) mapStep.get("output");
        		if (mapOutput.get("fields") != null && mapOutput.get("fields") instanceof List) {
        			List<Map> fields = (List<Map>)mapOutput.get("fields");
                	for (Map field : fields) {
                		// The first step: update the alias to real className and attrName mapping
                		if (stepNum == 0) {
                			if (variableClassMap.get(field.get("variable")) != null) {
                				asClassFieldMap.put((String)field.get("as"), new String[] {variableClassMap.get(field.get("variable")), (String)field.get("field")});
                			}
                		}
                		
                		if (objectVariableClassNameMap.containsKey(field.get("variable"))) {
                			String className = objectVariableClassNameMap.get(field.get("variable")).iterator().next();
                			boolean containColumn = false;
                			Object column = field.get("field");
                			Map classDef = null;
                			for (Object cd : classDefs) {
                				Map def = (Map)cd;
                				if (((String) def.get("className")).equals(className)) {
                                    classDef = def;
                                    break;
                                }
                			}
                			if (classDef != null) {
                				for (Map attrDef : (List<Map>) classDef.get("attrs")) {
                					if (attrDef.get("name").equals(column)) {
                						containColumn = true;
                						break;
                					}
                				}
                				if (!containColumn) {
                					sbCheckResult.append("the variable '" + field.get("variable") + "' referenced in output corresponds to the class '" + className + "' which has no " + column + " field, ");
                				}
                			}
                		}
                		if (field.get("expr") != null && field.get("expr") instanceof String) {
                			String expr = (String) field.get("expr");
                			Object[] correctExpr = null;
                			try {
                				correctExpr = setCorrectExpr(expr, (String)((Map)((List)((Map)((List)((Map)mapStep.get("graph")).get("patterns")).get(0)).get("objects")).get(0)).get("variable"));
                			} catch (Exception e) {}
                			if (correctExpr == null) {
                				field.put("field", expr);
                			} else {
                				field.put("field", (String)correctExpr[0]);
                				if ((Boolean)correctExpr[1]) {
                					field.remove("function");
                					field.remove("distinct");
                				} else {
                					if ((Boolean)correctExpr[2]) {
                						field.remove("distinct");
                					}
                				}
                			}
                		}
                		
                		// The second step: verify the output of the bucket type fields
                		if (stepNum == 1) {
                			if (field.get("time_range") != null) {
                				if (field.get("field") != null && field.get("field") instanceof String && field.get("conditions") != null && field.get("conditions") instanceof List) {
                					String lastAs = (String)field.get("field");
                					String[] class_field = asClassFieldMap.get(lastAs);
                					if (class_field != null) {
                						String className = class_field[0];
                    					String fieldName = class_field[1];
                    					Map<String, Set<String>> bucketIndicatorMap = classBucketIndicatorMap.get(className);
                    					if (bucketIndicatorMap != null) {
                    						Set<String> indicators = bucketIndicatorMap.get(fieldName);
                    						if (indicators != null) {
                    							List conditions = (List)field.get("conditions");
                            					for (Object conditionObj : conditions) {
                            						if (conditionObj instanceof Map) {
                            							Map condition = (Map)conditionObj;
                            							if ("name".equals(condition.get("metric")) && condition.get("value") != null && condition.get("value") instanceof String) {
                            								String indicator = (String)condition.get("value");
                            								if (!indicators.contains(indicator)) {
                            									sbCheckResult.append("class `" + className + "` bucket type field `" + fieldName + "` has no metric `" + indicator + "`, ");
                            								}
                            							}
                            						}
                            					}
                    						} else {
                    							sbCheckResult.append("class `" + className + "` has no bucket type field `" + fieldName + "`, ");
                    						}
                    					}
                					} else {
                						sbCheckResult.append("the field '" + lastAs + "' in output is not in the output of the previous step, ");
                					}
                				}
                			}
                		}
                	}
        		}
        	}
        	
        	return sbCheckResult.toString();
        }
    }
    
    public static Object[] setCorrectExpr(String exp, String tempTableName) {
    	List<String> distincts = new ArrayList<String>();
		List<int[]> leftRightIndexes = new ArrayList<int[]>();
		
		int index = 0;
        int length = exp.length();
        
        while (index < length) {
            // Find the position where "distinct" appears
            int start = exp.indexOf("distinct", index);
            if (start == -1) break;
            
            // Move the pointer to the position after "distinct"
            int current = start + "distinct".length();
            
            // Skip the spaces after distinct
            while (current < length && Character.isWhitespace(exp.charAt(current))) {
                current++;
            }
            
            int parenthesesLevel = 0;
            int expressionEnd = current;
            
            // Iterate until the end position of the expression is found
            while (expressionEnd < length) {
                char c = exp.charAt(expressionEnd);
                
                if (c == '(') {
                    parenthesesLevel++;
                } else if (c == ')') {
                    if (parenthesesLevel == 0) {
                        // Found the end position
                        break;
                    }
                    parenthesesLevel--;
                }
                expressionEnd++;
            }
            
            // Extract the expression (from start to expressionEnd, excluding the closing right parenthesis)
            String expr = exp.substring(start, expressionEnd);
            distincts.add(expr);
            leftRightIndexes.add(new int[] {start, expressionEnd});
            
            // Update the search start position
            index = expressionEnd + 1;
        }
        
        if (distincts.size() > 0) {
        	String noDistinctExp = "";
        	for (int i = 0; i < leftRightIndexes.size(); i++) {
    			int start = i == 0 ? 0 : leftRightIndexes.get(i - 1)[1];
    			noDistinctExp += exp.substring(start, leftRightIndexes.get(i)[0]) + "$" + i;
    		}
        	noDistinctExp += exp.substring(leftRightIndexes.get(leftRightIndexes.size() - 1)[1]);
        	Object[] noDistinctRet = setCorrectExprNoDistinct(noDistinctExp, tempTableName);
        	String correctExp = (String)noDistinctRet[0];
        	Boolean hasAggregate = (Boolean)noDistinctRet[1];
        	for (int i = 0; i < distincts.size(); i++) {
        		String distinct = distincts.get(i);
        		Object[] ret = setCorrectExprNoDistinct(distinct.substring(distinct.indexOf("distinct") + 8), tempTableName);
        		String dollar = "$" + i;
        		correctExp = correctExp.substring(0, correctExp.indexOf(dollar)) + "distinct " + (String)ret[0] + correctExp.substring(correctExp.indexOf(dollar) + dollar.length());
        		hasAggregate = hasAggregate || (Boolean)ret[1];
        	}
        	return new Object[] {correctExp, hasAggregate, true};
        } else {
        	Object[] ret = setCorrectExprNoDistinct(exp, tempTableName);
        	return new Object[] {ret[0], ret[1], false}; 
        }
    }
    
    private static Object[] setCorrectExprNoDistinct(String exp, String tempTableName) {
        String correctExp = "";
        boolean hasAggregate = false;
        
        // Improved regular expression:
        // 1. Match aggregate functions: \b(sum|avg|count|min|max)\s*\(\s*([\w.]+)\s*\)
        // 2. Match variables: \b([a-zA-Z_][\w.]*)\b (excluding identifiers starting with a digit)
        Pattern pattern = Pattern.compile(
            "\\b(sum|avg|count|min|max)\\s*\\(\\s*([\\$|\\w.]+)\\s*\\)|\\b([a-zA-Z_\\$][\\w.]*)\\b"
        );
        
        // Match numeric constants (used for filtering)
        Pattern numberPattern = Pattern.compile("^\\d*\\.?\\d+$");
        
        Matcher matcher = pattern.matcher(exp);
        
        int start = 0;
        while (matcher.find()) {
            if (matcher.group(1) != null) { 
                // Handle aggregate functions
                String function = matcher.group(1);
                String var = matcher.group(2);
                
                int s = matcher.start();
                int e = matcher.end();
                correctExp += exp.substring(start, s);
                correctExp += function + "(";
                correctExp += var.indexOf(".") >= 0 || var.startsWith("$") ? var : (tempTableName + "." + var);
                correctExp += ")";
                start = e;
                hasAggregate = true;
            } else if (matcher.group(3) != null) { 
                // Handle standalone variables
                String var = matcher.group(3);
                
                // Exclude numeric constants
                if (!numberPattern.matcher(var).matches()) {
                    Map<String, String> entry = new HashMap<>();
                    entry.put("var", var);
                    int s = matcher.start();
                    int e = matcher.end();
                    correctExp += exp.substring(start, s);
                    correctExp += var.indexOf(".") >= 0 || var.startsWith("$") ? var : (tempTableName + "." + var);
                    start = e;
                }
            }
        }
        correctExp += exp.substring(start);
        
        return new Object[] {correctExp, hasAggregate};
    }

	/**This function is used to check the correctness of the output configuration, mainly including two steps:
	 * Call checkOutputField to check and complete the missing fields in group_by into the output field list.
	 * Call checkSort to check and correct the sort fields, ensuring their references are correct, especially for the handling of aggregate functions and aliases.
	 * @param mapOutput
	 */
	private static void checkOutput(Map mapOutput){

		// Check whether the output fields are correct or missing
		checkOutputField(mapOutput);
		// Check the correctness of the sort fields
		checkSort(mapOutput);
	}


	/**This function is used to check and ensure that the variables and fields in the group_by fields exist in the output field list.
	 * If they do not exist, they are automatically added to the output field list to ensure data consistency.
	 * @param mapOutput
	 */
	private static void checkOutputField(Map mapOutput){

		// Check the output fields
		// If the output fields have group_by fields, determine whether the group_by fields exist in the output fields; if not, add them
		if(mapOutput.containsKey("group_by")){
			Map listGroupBy = (Map)mapOutput.get("group_by");
			List listOutputFields = (List)mapOutput.get("fields");

			List<Map> listGroupFields = (List<Map>) listGroupBy.get("fields");
			for(int i = 0; i < listGroupFields.size(); i++){
				Map mapGroupField = listGroupFields.get(i);
				if(mapGroupField.containsKey("variable") && mapGroupField.containsKey("field")){
					String groupVariable = (String)mapGroupField.get("variable");
					String groupField = (String)mapGroupField.get("field");
					boolean isGroupFieldExist = false;
					for (int j = 0; j < listOutputFields.size(); j++){
						Map mapOutputField = (Map) listOutputFields.get(j);
						String outputVariable = (String)mapOutputField.get("variable");
						String outputField = (String)mapOutputField.get("field");
						if(groupVariable.equals(outputVariable) && groupField.equals(outputField)
								&& !mapOutputField.containsKey("function")){
							isGroupFieldExist = true;
							break;
						}
					}
					// The group_by field does not exist in the output fields, so add it
					if(!isGroupFieldExist){
						Map mapOutputField = new HashMap();
						mapOutputField.put("variable", groupVariable);
						mapOutputField.put("field", groupField);
						listOutputFields.add(mapOutputField);
						log.warn("<<< forcibly add the group_by field to the output fields!");
					}
				}
			}
		}
	}

	/**
	 * Check and correct the function references in the sort fields
	 * When a sort field references an aggregate function, correct it to the corresponding alias field
	 * When an alias is used, the class cannot be used
	 * @param mapOutput mapping table containing the sort and output field information
	 */
	private static void checkSort(Map mapOutput) {

		Map mapSort = (Map)mapOutput.get("sort");
		List listOutputFields = (List)mapOutput.get("fields");

		if(mapSort != null){
			Object sortFields =mapSort.get("fields");
			if(sortFields != null && sortFields instanceof List){
				List listSortFields = (List)sortFields;
				for(int i = 0; i < listSortFields.size(); i++){
					Map mapSortField = (Map)listSortFields.get(i);

					String sortVariable = (String)mapSortField.get("variable");
					String sortField = (String)mapSortField.get("field");
					// Find the aggregate item alias from the output fields
					for(int j = 0; j < listOutputFields.size(); j++){
						Map mapOutputField = (Map)listOutputFields.get(j);
						if(sortVariable != null
						    &&sortVariable.equals(mapOutputField.get("variable"))
							&& mapOutputField.containsKey("function")
							&& mapOutputField.containsKey("as")
							&& (sortField.equals(mapOutputField.get("field")) || sortField.equals(mapOutputField.get("as"))||sortField.equals(mapOutputField.get("function")))){
							log.warn(">>> the sort field has an aggregate function, start correcting to sort by the aggregate result!");
							String strOutputAs = (String)mapOutputField.get("as");
							// Update to the alias of the aggregate field
							mapSortField.put("field", strOutputAs);
							// Delete the class and the function
							mapSortField.remove("variable");
							if(mapSortField.containsKey("function")){
								mapSortField.remove("function");
							}
							log.warn("<<< the sort field has been corrected!");
							// Break out of the loop and return to the upper layer
							break;
						} else if(sortVariable != null
								&&sortVariable.equals(mapOutputField.get("variable"))
								&&sortField.equals(mapOutputField.get("as"))) {
							log.warn(">>> the sort field uses an alias, start correcting and delete the class variable name!");
							// Delete the class
							mapSortField.remove("variable");
							log.warn("<<< the sort field has been corrected!");
						} else if(sortVariable == null
								&& mapOutputField.containsKey("function")
								&& mapOutputField.containsKey("as")
								&& sortField.equals(mapOutputField.get("function"))){
							log.warn(">>> the sort field uses a function name, start correcting and delete the class variable name!");
							String strOutputAs = (String)mapOutputField.get("as");
							// Update to the alias of the aggregate field
							mapSortField.put("field", strOutputAs);
							log.warn("<<< the sort field has been corrected!");
						}
					}

				}
			}
		}
	}

	private static void checkConditions(Map mapConditions){

		if(mapConditions.containsKey("properties")){
			Object objProperties = mapConditions.get("properties");
			if(objProperties instanceof List){
				log.warn(">>> condition syntax error, start correcting!");
				List listProperties = (List)objProperties;

				Map mapProperties = new HashMap();
				mapProperties.put("operator", "logic");
				mapProperties.put("and", listProperties);
				mapConditions.put("properties", mapProperties);
				log.warn("<<< the condition syntax has been corrected!");
			}
		}
	}
	
}
