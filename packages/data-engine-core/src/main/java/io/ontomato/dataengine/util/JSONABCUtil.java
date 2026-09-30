package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class JSONABCUtil {
    public static Map getABC(String queryJson, Map<String, Object> mapRule) {

        List<Map> listQuery = JSON.parseArray(queryJson, Map.class);

        //ABC
        Map<String,Object> mapABC = new HashMap();
        //Load the JSON rule file
        List<Map> classDefs = (List<Map>) mapRule.get("classDef");
        Map<String,Object> mapClassDefs = classDefs2Map(classDefs);

        Map<String,Map> relationship_rule = (Map) mapRule.get("relationship_rule");
        //A: get the objects
        List<Map<String,Object>> listObjects = getA(listQuery, mapClassDefs, relationship_rule);

        //Extract attributes
        List<Map<String,Object>> listProperties = getB();

        //Statistical computation
        List<Map<String,Object>> listComputations = getC();

        mapABC.put("a", listObjects);
        mapABC.put("b", listProperties);
        mapABC.put("c", listComputations);

        return mapABC;
    }

    public static Map<String,Object> classDefs2Map(List<Map> classDefs){
        Map<String,Object> mapClassDefs = new HashMap();

        for (Map mapClassDef : classDefs){
            String className = (String)mapClassDef.get("className");

            List<Map> listAttrs = (List<Map>)mapClassDef.get("attrs");
            Map<String,Object> mapAttrs = new HashMap();
            for (Map mapAttr : listAttrs){
                String attrName = (String)mapAttr.get("name");
                mapAttrs.put(attrName, mapAttr);
            }
            mapClassDef.put("attrs", mapAttrs);
            mapClassDefs.put(className, mapClassDef);
        }
        return mapClassDefs;
    }

    public static List<Map<String,Object>> getA(List<Map> listQuery, Map<String,Object>  mapClassDefs, Map<String,Map> relationship_rule) {
        List<Map<String,Object>> listObjects = new ArrayList();
        if(listQuery==null || listQuery.size()==0){
            return listObjects;
        }

        Map mapQuery = listQuery.get(0);
        Map mapAnswer = (Map) mapQuery.get("answer");
        List<Map> listSteps = (List<Map>) mapAnswer.get("steps");

        //Parse and get the extracted objects
        Map mapOutput = (Map) listSteps.get(0).get("output");

        Map mapGraph = (Map) listSteps.get(0).get("graph");
        List<Map> listPatterns = (List<Map>) mapGraph.get("patterns");
        Map<String,Object> mapObjects = new HashMap();
        for(Map mapPattern : listPatterns){
            List<Map> listPatternObjects = (List<Map>) mapPattern.get("objects");
            for(Map mapObject : listPatternObjects){
                String variable = (String)mapObject.get("variable");
                //Build the object to be output
                Map<String,String> mapAObject = new HashMap<>();
                String className = (String)mapObject.get("class");
                //Get the conditions
                Map<String,Object> mapConditions = (Map<String,Object>) mapObject.get("conditions");
                String strConditions = getConditions(className, mapConditions, mapClassDefs);

                Map mapClassDef = (Map)mapClassDefs.get(className);
                String strClassDesc = (String) mapClassDef.get("classDesc");

                mapAObject.put("object", strClassDesc);
                mapAObject.put("condition",strConditions);
                mapObjects.put(variable,mapAObject);
            }

            //Relationship conditions
            List<Map> listRelationships = (List<Map>) mapPattern.get("relationship");
            if(listRelationships!=null && listRelationships.size()>0){
                for(Map mapRelationship : listRelationships){

                }
            }

        }

        List<Map> listFields = (List<Map>) mapOutput.get("fields");
        //Keep the order of the Output objects
        for(Map mapField : listFields){
            String variable = (String)mapField.get("variable");
            //Avoid duplicates
            if(!listObjects.contains((Map<String, Object>) mapObjects.get(variable))){
                listObjects.add((Map<String, Object>) mapObjects.get(variable));
            }
        }

        return listObjects;
    }

    public static String getConditions(String className,Map<String,Object> mapConditions,Map<String,Object>  mapClassDefs) {
        StringBuffer sbConditions = new StringBuffer();

        //Attribute conditions
        Map<String,Object> mapProperties = (Map<String,Object>) mapConditions.get("properties");
        if(mapConditions.get("properties")!=null && mapProperties.size()>0){
            //Multiple attributes are joined by "and"/"or"/"not"
            if(mapProperties.containsKey("and")){
                List<Map> listAndConditions = (List<Map>) mapProperties.get("and");
                String strAndConditions = getAndCondition(className, listAndConditions, mapClassDefs);
                sbConditions.append(strAndConditions);
            } else if (mapProperties.containsKey("or")){
                List<Map> listOrConditions = (List<Map>) mapProperties.get("or");
                String strORConditions = getOrCondition(className, listOrConditions, mapClassDefs);
                sbConditions.append(strORConditions);

            } else if (mapProperties.containsKey("not")){
                List<Map> listNotConditions = (List<Map>) mapProperties.get("not");
                String strNotConditions = getNotCondition(className, listNotConditions, mapClassDefs);
                sbConditions.append(strNotConditions);
            } else {
                String strSingleCondition =getSingleCondition(className, mapProperties, mapClassDefs);
                sbConditions.append(strSingleCondition);
            }
        }

        //Full-text search conditions
        if (mapConditions.get("text") != null && mapConditions.get("text") instanceof Map) {
        	Map<String, Object> mapText = (Map<String, Object>)mapConditions.get("text");
        	if (mapText.get("query") != null && mapText.get("query") instanceof String && !"".equals(((String)mapText.get("query")).trim()) 
        			&& mapText.get("fields") != null && mapText.get("fields") instanceof List 
        			&& mapText.get("operator") != null && mapText.get("operator") instanceof String) {
        		Map<String, Map<String, String>> colDefMap = (Map<String, Map<String, String>>)((Map<String, Object>)mapClassDefs.get(className)).get("attrs");
        		
        		String query = ((String)mapText.get("query")).trim();
        		List fields = (List)mapText.get("fields");
        		String operator = ((String)mapText.get("operator")).trim();
        		if (sbConditions.length() > 0) {
        			sbConditions.append(" and ");
        		}
        		if (fields.size() == 0 || fields.size() == 1 && "*".equals(fields.get(0))) {
        			sbConditions.append("all fields ");
        		} else {
        			sbConditions.append("fields [");
        			for (int i = 0; i < fields.size(); i++) {
        				sbConditions.append((colDefMap.containsKey(fields.get(i)) ? colDefMap.get(fields.get(i)).get("attrDesc") : fields.get(i)) + (i < fields.size() - 1 ? ", " : ""));
        			}
        			sbConditions.append("] ");
        		}
        		if ("match".equals(operator)) {
        			sbConditions.append("match query ");
        		} else if ("phrase".equals(operator)) {
        			sbConditions.append("phrase query ");
        		} else if ("fuzzy".equals(operator)) {
        			sbConditions.append("fuzzy match ");
        		} else {
        			sbConditions.append("match query ");
        		}
        		sbConditions.append(query);
        	}
        }
        

        //Vector query
        mapConditions.get("vector");
        //Time series query
        mapConditions.get("timeseries");

        return sbConditions.toString();
    }

    public static String getAndCondition(String className,List<Map> listAndConditions,Map<String,Object>  mapClassDefs) {
        StringBuffer sbAndConditions = new StringBuffer();

        sbAndConditions.append("(");
        for(int i=0;i<listAndConditions.size();i++){
            Map mapAndCondition = listAndConditions.get(i);
            String strSingleCondition;
            //Nested "and"/"or"/"not"
            if(mapAndCondition.containsKey("and")){
                List<Map> listAndConditionsChild = (List<Map>) mapAndCondition.get("and");
                strSingleCondition = getAndCondition(className, listAndConditionsChild, mapClassDefs);
            } else if (mapAndCondition.containsKey("or")){
                List<Map> listOrConditionsChild = (List<Map>) mapAndCondition.get("or");
                strSingleCondition = getOrCondition(className, listOrConditionsChild, mapClassDefs);
            } else if (mapAndCondition.containsKey("not")){
                List<Map> listNotConditionsChild = (List<Map>) mapAndCondition.get("not");
                strSingleCondition = getNotCondition(className, listNotConditionsChild, mapClassDefs);
            } else {
                strSingleCondition =getSingleCondition(className, mapAndCondition, mapClassDefs);
            }

            sbAndConditions.append(strSingleCondition);
            if(i<listAndConditions.size()-1){
                sbAndConditions.append(" and ");
            }
        }
        sbAndConditions.append(")");
        return sbAndConditions.toString();
    }

    public static String getOrCondition(String className,List<Map> listOrConditions,Map<String,Object>  mapClassDefs) {
        StringBuffer sbORConditions = new StringBuffer();

        sbORConditions.append("(");
        for(int i=0;i<listOrConditions.size();i++){
            Map mapOrCondition = listOrConditions.get(i);
            String strSingleCondition;
            //Nested "and"/"or"/"not"
            if(mapOrCondition.containsKey("and")){
                List<Map> listAndConditionsChild = (List<Map>) mapOrCondition.get("and");
                strSingleCondition = getAndCondition(className, listAndConditionsChild, mapClassDefs);
            } else if (mapOrCondition.containsKey("or")){
                List<Map> listOrConditionsChild = (List<Map>) mapOrCondition.get("or");
                strSingleCondition = getOrCondition(className, listOrConditionsChild, mapClassDefs);
            } else if (mapOrCondition.containsKey("not")){
                List<Map> listNotConditionsChild = (List<Map>) mapOrCondition.get("not");
                strSingleCondition = getNotCondition(className, listNotConditionsChild, mapClassDefs);
            } else {
                strSingleCondition =getSingleCondition(className, mapOrCondition, mapClassDefs);
            }

            sbORConditions.append(strSingleCondition);
            if(i<listOrConditions.size()-1){
                sbORConditions.append(" or ");
            }
        }
        sbORConditions.append(")");
        return sbORConditions.toString();

    }

    public static String getNotCondition(String className,List<Map> listNotConditions,Map<String,Object>  mapClassDefs) {
        StringBuffer sbNotConditions = new StringBuffer();

        sbNotConditions.append("does not satisfy (");
        for(int i=0;i<listNotConditions.size();i++){
            Map mapNotCondition = listNotConditions.get(i);
            String strSingleCondition;
            //Nested "and"/"or"/"not"
            if(mapNotCondition.containsKey("and")){
                List<Map> listAndConditionsChild = (List<Map>) mapNotCondition.get("and");
                strSingleCondition = getAndCondition(className, listAndConditionsChild, mapClassDefs);
            } else if (mapNotCondition.containsKey("or")){
                List<Map> listOrConditionsChild = (List<Map>) mapNotCondition.get("or");
                strSingleCondition = getOrCondition(className, listOrConditionsChild, mapClassDefs);
            } else if (mapNotCondition.containsKey("not")){
                List<Map> listNotConditionsChild = (List<Map>) mapNotCondition.get("not");
                strSingleCondition = getNotCondition(className, listNotConditionsChild, mapClassDefs);
            } else {
                strSingleCondition =getSingleCondition(className, mapNotCondition, mapClassDefs);
            }

            sbNotConditions.append(strSingleCondition);
            if(i<listNotConditions.size()-1){
                sbNotConditions.append(" and ");
            }
        }
        sbNotConditions.append(")");
        return sbNotConditions.toString();
    }

    /**
     * Generate the string representation of a single query condition
     * This method builds a query condition string from the class name, the attribute map and the class definition map
     * It handles the different logical operators and builds the corresponding query condition accordingly
     *
     * @param className class name, used to get the class definition
     * @param mapProperties map containing the query attributes, such as field name, operator and value
     * @param mapClassDefs map containing the class definitions, used to get the attribute description and other information
     * @return the built query condition string
     */
    public static String getSingleCondition(String className,Map<String,Object> mapProperties,Map<String,Object> mapClassDefs) {
        StringBuffer sbCondition = new StringBuffer();
        //Get the class definition
        Map<String,Object> mapClassDef = (Map)  mapClassDefs.get(className);
        Map<String,Object> mapAttrs = (Map)mapClassDef.get("attrs");

        String strField = (String) mapProperties.get("field");
        Map<String,String> mapAttr = (Map) mapAttrs.get(strField);
        String strAttrDesc = mapAttr.get("attrDesc");
        sbCondition.append(strAttrDesc);

        String strOperator = (String) mapProperties.get("operator");
        //operator is the logical operator, including "=", "!=", ">", ">=", "<", "<=", "between", "like", "in", "is", "is not"
        //when operator is between, value is a two-element array,
        //when operator is in, value is a multi-element array,
        // when operator is is or is not, value is null.
        if(strOperator.trim().equals("=")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" equals ").append(strValue);
        } else if(strOperator.trim().equals("!=")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" not equal to ").append(strValue);
        } else if(strOperator.trim().equals(">")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" greater than ").append(strValue);
        } else if(strOperator.trim().equals(">=")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" greater than or equal to ").append(strValue);
        } else if(strOperator.trim().equals("<")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" less than ").append(strValue);
        } else if(strOperator.trim().equals("<=")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" less than or equal to ").append(strValue);
        } else if(strOperator.trim().equals("between")){

            List listValue = (List) mapProperties.get("value");
            sbCondition.append(" between ").append(listValue.get(0)).append(" and ").append(listValue.get(1));

        } else if(strOperator.trim().equals("like")){
            String strValue = (String) mapProperties.get("value");
            sbCondition.append(" matches ").append(strValue);
        } else if(strOperator.trim().equals("in")){
            List listValue = (List) mapProperties.get("value");
            sbCondition.append(" in ");
            if (listValue!=null && listValue.size()>0){
                sbCondition.append("(");
                for(int i=0;i<listValue.size();i++){
                    String strValue = (String) listValue.get(i);
                    sbCondition.append(strValue);
                    if(i<listValue.size()-1){
                        sbCondition.append(",");
                    }
                }
                sbCondition.append(")");
            }
        } else if(strOperator.trim().equals("is")){
            sbCondition.append(" is empty");
        } else if(strOperator.trim().equals("is not")){
            sbCondition.append(" is not empty");
        } else {

        }

        return sbCondition.toString();
    }

    public static List<Map<String,Object>> getB() {
        List<Map<String,Object>> listProperties = new ArrayList();
        Map<String,Object> mapProperty1 = new HashMap();
        mapProperty1.put("object", "Project");
        mapProperty1.put("property", "Project Name");
        Map<String,Object> mapProperty2 = new HashMap();
        mapProperty2.put("object", "Contract");
        mapProperty2.put("property", "Contract Amount");

        listProperties.add(mapProperty1);
        listProperties.add(mapProperty2);

        return listProperties;
    }

    public static List<Map<String,Object>> getC() {
        List<Map<String,Object>> listComputations = new ArrayList();
        Map<String,Object> mapCompute1 = new HashMap();
        mapCompute1.put("object", "Contract");
        mapCompute1.put("property", "Contract Amount");
        mapCompute1.put("compute", "descending sort");
        listComputations.add(mapCompute1);

        return listComputations;
    }
}
