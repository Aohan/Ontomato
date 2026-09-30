package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DslRuleUtil {

    /**
     * According to the types used by this query, replace the placeholders in main.md with the corresponding rule fragments, and leave the unused ones empty.
     * Rule file names are enumerated from the dslRule directory on the classpath, and the content is also read from the classpath -- for the same directory there is only one locating method.
     */
    private static String assembleDslRule(Set<String> types) {
        String dslRule = FileUtil.getResourceFileLoadAll("dslRule/main.md", "utf-8");
        for (String ruleFileName : FileUtil.listResourceNames("dslRule")) {
            boolean replace = false;
            for (String type : types) {
                if (ruleFileName.startsWith("replace_" + type)) {
                    replace = true;
                    break;
                }
            }
            String placeholder = "{$" + ruleFileName.substring(0, ruleFileName.length() - 3) + "}";
            dslRule = dslRule.replace(placeholder,
                    replace ? FileUtil.getResourceFileLoadAll("dslRule/" + ruleFileName, "utf-8") : "");
        }
        return dslRule;
    }

    public static String generateDslRule(JSONObject subQuery, Map<String, Object> jsonRule) {
        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");

        Set<String> types = new HashSet<String>();
        // relationship rule
        if (subQuery.containsKey("DSL_relationship") && subQuery.getBoolean("DSL_relationship")) {
            types.add("relationship");
        }
        // group by
        if (subQuery.containsKey("DSL_C_Step_group_by") && subQuery.getBoolean("DSL_C_Step_group_by") || subQuery.containsKey("DSL_C_Step_function") && subQuery.getBoolean("DSL_C_Step_function")) {
            types.add("cStep_group_by");
            types.add("cStep_function");
            types.add("cStep_select_distinct");
        }
        // four basic arithmetic operations
        if (subQuery.containsKey("DSL_C_Step_four_basic_math") && subQuery.getBoolean("DSL_C_Step_four_basic_math")) {
            types.add("cStep_four_basic_math");
        }
        // order by
        if (subQuery.containsKey("DSL_C_Step_sort") && subQuery.getBoolean("DSL_C_Step_sort")) {
            types.add("cStep_sort");
            types.add("cStep_limit");
        }
        // generic C step
        if (subQuery.containsKey("C_Step") && !"".equals(subQuery.getString("C_Step").trim())) {
            types.add("cStep_save_table");
            types.add("cStep_other");
        }
        JSONArray classes = subQuery.getJSONArray("classes");
        for (int i = 0; i < classes.size(); i++) {
            String className = classes.getString(i).trim();
            if (!className.startsWith("/")) {
                className = "/" + className;
            }
            if (className.endsWith("/")) {
                className = className.substring(0, className.length() - 1);
            }
            for (Map<String, Object> classDef : classDefs) {
                if (className.equals(classDef.get("className"))) {
                    List<Map<String, String>> attrs = (List<Map<String, String>>)classDef.get("attrs");
                    for (Map<String, String> attr : attrs) {
                        if ("text".equals(attr.get("type"))) {
                            types.add("text");
                        } else if ("bucket".equals(attr.get("type"))) {
                            types.add("timeseries");
                        } else if ("vector".equals(attr.get("type"))) {
                            types.add("vector");
                        }
                    }
                    break;
                }
            }
        }

        return assembleDslRule(types);
    }
    
    public static String generateWholeDslRule(Map<String, Object> jsonRule) {
        Set<String> types = new HashSet<String>();
        // relationship rule
        types.add("relationship");
        // group by
        types.add("cStep_group_by");
        types.add("cStep_function");
        types.add("cStep_select_distinct");
        // four basic arithmetic operations
        types.add("cStep_four_basic_math");
        // order by
        types.add("cStep_sort");
        types.add("cStep_limit");
        // generic C step
        types.add("cStep_save_table");
        types.add("cStep_other");
        // all attribute types
        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        for (Map<String, Object> classDef : classDefs) {
        	List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
        	for (Map<String, Object> attr : attrs) {
        		if (attr.get("enable") == null || (Boolean)attr.get("enable")) {
        			if ("bucket".equals(attr.get("type"))) {
        				types.add("timeseries");
        			}
        			if ("vector".equals(attr.get("type"))) {
        				types.add("vector");
        			}
        		}
        	}
        }

        return assembleDslRule(types);
    }
    
    public static String generateDslExample(JSONObject subQuery, Map<String, Object> jsonRule) {
        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");

        boolean cStepFlag = subQuery.containsKey("C_Step") && !"".equals(subQuery.getString("C_Step").trim());
        JSONArray classes = subQuery.getJSONArray("classes");
        boolean relationshipFlag = classes.size() > 1;
        boolean textFlag = false;
        boolean vectorFlag = false;
        boolean timeseriesFlag = false;
        for (int i = 0; i < classes.size(); i++) {
            String className = classes.getString(i).trim();
            if (!className.startsWith("/")) {
                className = "/" + className;
            }
            if (className.endsWith("/")) {
                className = className.substring(0, className.length() - 1);
            }
            for (Map<String, Object> classDef : classDefs) {
                if (className.equals(classDef.get("className"))) {
                    List<Map<String, String>> attrs = (List<Map<String, String>>)classDef.get("attrs");
                    for (Map<String, String> attr : attrs) {
                        if ("text".equals(attr.get("type"))) {
                            textFlag = true;
                        } else if ("bucket".equals(attr.get("type"))) {
                            timeseriesFlag = true;
                        } else if ("vector".equals(attr.get("type"))) {
                            vectorFlag = true;
                        }
                    }
                    break;
                }
            }
        }

        JSONObject dsl = new JSONObject();
        dsl.put("problem", "xxxxxxxxxx...");
        JSONObject answer = new JSONObject();
        dsl.put("answer", answer);
        JSONArray steps = new JSONArray();
        answer.put("steps", steps);
        JSONObject step0 = new JSONObject();
        steps.add(step0);
        JSONObject graph0 = new JSONObject();
        step0.put("graph", graph0);
        JSONArray patterns0 = new JSONArray();
        graph0.put("patterns", patterns0);
        JSONObject pattern0 = new JSONObject();
        patterns0.add(pattern0);
        JSONArray objects0 = new JSONArray();
        pattern0.put("objects", objects0);
        JSONObject baseObject = JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/baseObject.json", "utf-8"));
        objects0.add(baseObject);
        if (textFlag) {
            baseObject.getJSONObject("conditions").put("text", JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/textWhere.json", "utf-8")));
        }
        if (vectorFlag) {
            baseObject.getJSONObject("conditions").put("vector", JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/vectorWhere.json", "utf-8")));
        }
        if (timeseriesFlag) {
            baseObject.getJSONObject("conditions").put("timeseries", JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/timeseriesWhere.json", "utf-8")));
        }
        if (relationshipFlag) {
            objects0.addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/relationshipObjects.json", "utf-8")));
            pattern0.put("relationship", JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/relationships.json", "utf-8")));
        }
        graph0.put("pattern_logic", "and");

        JSONObject output0 = new JSONObject();
        step0.put("output", output0);
        JSONArray outputFields0 = new JSONArray();
        output0.put("fields", outputFields0);
        outputFields0.addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/baseOutputFields.json", "utf-8")));
        if (cStepFlag || timeseriesFlag) {
            output0.put("to_user", false);
            output0.put("save_table", "/temp01");
            if (timeseriesFlag) {
                outputFields0.addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/timeseries0OutputFields.json", "utf-8")));
            }
            if (cStepFlag) {
                outputFields0.addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/cStep0OutputFields.json", "utf-8")));
            }

            JSONObject step1 = new JSONObject();
            steps.add(step1);
            step1.put("graph", JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/graph1.json", "utf-8")));
            JSONObject output1 = JSONObject.parseObject(FileUtil.getResourceFileLoadAll("dslExample/output1.json", "utf-8"));
            step1.put("output", output1);
            if (timeseriesFlag) {
                output1.getJSONArray("fields").addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/timeseries1OutputFields.json", "utf-8")));
            }
            if (cStepFlag) {
                output1.getJSONArray("fields").addAll(JSONArray.parseArray(FileUtil.getResourceFileLoadAll("dslExample/cStep1OutputFields.json", "utf-8")));
            }
        } else {
            output0.put("to_user", true);
        }

        JSONArray dsls = new JSONArray();
        dsls.add(dsl);

        return "```json\n" + JSON.toJSONString(dsls, JSONWriter.Feature.PrettyFormat) + "\n```";
    }
}
