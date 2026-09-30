package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;

/**
 * DSL equivalence grouper
 *
 * Equivalence rules:
 * 1. Different variable names (variable) -> equivalent (ignored)
 * 2. Different temporary table names (save_table) -> equivalent (ignored)
 * 3. Different condition values -> not equivalent (kept)
 * 4. Different order within and/or conditions -> equivalent (sorted)
 * 5. Different objects order -> equivalent (sorted by class)
 * 6. Different relationship from/to indexes -> equivalent (normalized mapping)
 * 7. Different output field order -> equivalent (sorted by class+field)
 * 8. Different as aliases -> equivalent (ignored)
 * 9. Sorting of the array values of the in operator (["CPC member","CPC probationary member"] = ["CPC probationary member","CPC member"])
 */
public class DSLGrouper {

    /**
     * Groups a list of DSLs by equivalence
     * @param dslList list of DSL JSON strings
     * @return grouping result, sorted in descending order by the number of elements in each group
     */
    public List<List<Integer>> group(List<String> dslList) {
        if (dslList == null || dslList.isEmpty()) {
            return Collections.emptyList();
        }

        // Use LinkedHashMap to keep insertion order
        Map<String, List<Integer>> signatureMap = new LinkedHashMap<>();

        // Generate a signature for each DSL; DSLs with the same signature are considered equivalent
        for (int i = 0; i < dslList.size(); i++) {
            String dslJson = dslList.get(i);
            String signature = generateSignature(dslJson);
            signatureMap.computeIfAbsent(signature, k -> new ArrayList<>()).add(i);
        }

        // Extract the grouping result
        List<List<Integer>> result = new ArrayList<>(signatureMap.values());
        // Sort in descending order by the number of elements in each group
        result.sort((a, b) -> Integer.compare(b.size(), a.size()));

        return result;
    }

    /**
     * Generates the signature of a DSL (the normalized JSON string)
     * DSLs with the same signature are considered equivalent
     */
    private String generateSignature(String dslJson) {
        JSONArray dslArray = JSON.parseArray(dslJson);
        if (dslArray == null || dslArray.isEmpty()) {
            return "";
        }

        JSONObject dslItem = dslArray.getJSONObject(0);
        JSONObject normalized = normalizeDSL(dslItem);
        return normalized.toJSONString();
    }

    /**
     * Normalizes a DSL, removing differences that do not affect equivalence
     */
    private JSONObject normalizeDSL(JSONObject dslItem) {
        JSONObject result = new JSONObject();

        JSONObject answer = dslItem.getJSONObject("answer");
        if (answer != null) {
            JSONArray steps = answer.getJSONArray("steps");
            if (steps != null) {
                JSONArray normalizedSteps = new JSONArray();
                for (int i = 0; i < steps.size(); i++) {
                    JSONObject step = steps.getJSONObject(i);
                    normalizedSteps.add(normalizeStep(step));
                }
                result.put("steps", normalizedSteps);
            }
        }

        return result;
    }

    /**
     * Normalizes a single step
     */
    private JSONObject normalizeStep(JSONObject step) {
        JSONObject result = new JSONObject();

        // Handle the graph part and get patterns for subsequent field normalization
        JSONObject graph = step.getJSONObject("graph");
        JSONArray patterns = null;
        if (graph != null) {
            patterns = graph.getJSONArray("patterns");
            result.put("graph", normalizeGraph(graph));
        }

        // Handle the output part
        JSONObject output = step.getJSONObject("output");
        if (output != null) {
            result.put("output", normalizeOutput(output, patterns));
        }

        return result;
    }

    /**
     * Normalizes the graph part
     */
    private JSONObject normalizeGraph(JSONObject graph) {
        JSONObject result = new JSONObject();

        // Normalize the patterns array
        JSONArray patterns = graph.getJSONArray("patterns");
        if (patterns != null) {
            JSONArray normalizedPatterns = new JSONArray();
            for (int i = 0; i < patterns.size(); i++) {
                JSONObject pattern = patterns.getJSONObject(i);
                normalizedPatterns.add(normalizePattern(pattern));
            }
            result.put("patterns", normalizedPatterns);
        }

        // Keep pattern_logic
        String patternLogic = graph.getString("pattern_logic");
        if (patternLogic != null) {
            result.put("pattern_logic", patternLogic);
        }

        return result;
    }

    /**
     * Normalizes the relationship
     * Converts the original from/to indexes into normalized indexes and sorts the type array
     */
    private JSONArray normalizeRelationship(JSONArray relationship, Map<String, Integer> classToIdx, Map<Integer, Integer> idxMapping) {
        List<JSONObject> relList = new ArrayList<>();
        for (int i = 0; i < relationship.size(); i++) {
            relList.add(relationship.getJSONObject(i));
        }
        // Sort by normalized index
        relList.sort((r1, r2) -> {
            Integer from1 = idxMapping.get(r1.getIntValue("from"));
            Integer from2 = idxMapping.get(r2.getIntValue("from"));
            Integer to1 = idxMapping.get(r1.getIntValue("to"));
            Integer to2 = idxMapping.get(r2.getIntValue("to"));
            if (from1 == null || from2 == null || to1 == null || to2 == null) {
                return 0;
            }
            int cmp = from1.compareTo(from2);
            if (cmp != 0) return cmp;
            return to1.compareTo(to2);
        });

        JSONArray result = new JSONArray();
        for (JSONObject rel : relList) {
            JSONObject normalizedRel = new JSONObject();
            // Map the original index to the normalized index
            int fromIdx = rel.getIntValue("from");
            int toIdx = rel.getIntValue("to");
            normalizedRel.put("from", idxMapping.get(fromIdx));
            normalizedRel.put("to", idxMapping.get(toIdx));
            // Sort the type array to ensure order independence
            JSONArray types = rel.getJSONArray("type");
            List<String> typeList = new ArrayList<>();
            for (int i = 0; i < types.size(); i++) {
                typeList.add(types.getString(i));
            }
            Collections.sort(typeList);
            JSONArray sortedTypes = new JSONArray();
            for (String t : typeList) sortedTypes.add(t);
            normalizedRel.put("type", sortedTypes);
            normalizedRel.put("min_hops", rel.getIntValue("min_hops"));
            normalizedRel.put("max_hops", rel.getIntValue("max_hops"));
            result.add(normalizedRel);
        }
        return result;
    }

    /**
     * Normalizes a single pattern
     */
    private JSONObject normalizePattern(JSONObject pattern) {
        JSONObject result = new JSONObject();

        // Normalize the objects array and generate the index mapping
        JSONArray objects = pattern.getJSONArray("objects");
        Map<String, Integer> classToIdx = new HashMap<>();
        Map<Integer, Integer> idxMapping = new HashMap<>();
        if (objects != null) {
            JSONArray sortedObjects = sortObjectsByClass(objects, classToIdx, idxMapping);
            result.put("objects", sortedObjects);
        }

        // Normalize relationship
        JSONArray relationship = pattern.getJSONArray("relationship");
        if (relationship != null) {
            result.put("relationship", normalizeRelationship(relationship, classToIdx, idxMapping));
        }

        return result;
    }

    /**
     * Normalizes the class path, unifying temporary table paths to "/temp"
     */
    private String normalizeClassPath(String classPath) {
        if (classPath != null && classPath.startsWith("/temp")) {
            return "/temp";
        }
        return classPath;
    }

    /**
     * Normalizes the variable name, unifying the variable of a temporary table to "temp"
     */
    private String normalizeVariable(String variable, String classPath) {
        if (classPath != null && classPath.startsWith("/temp")) {
            return "temp";
        }
        return variable;
    }

    /**
     * Sorts the objects array by class path and generates the index mapping
     */
    private JSONArray sortObjectsByClass(JSONArray objects, Map<String, Integer> classToIdx, Map<Integer, Integer> idxMapping) {
        List<JSONObject> objectList = new ArrayList<>();
        for (int i = 0; i < objects.size(); i++) {
            objectList.add(objects.getJSONObject(i));
        }
        // Sort by class path
        objectList.sort(Comparator.comparing(o -> {
            String classPath = normalizeClassPath(o.getString("class"));
            return classPath != null ? classPath : "";
        }));

        // Generate the index mapping: old index -> new index
        JSONArray sorted = new JSONArray();
        int newIdx = 0;
        for (JSONObject obj : objectList) {
            String classPath = normalizeClassPath(obj.getString("class"));
            Integer oldIdx = obj.getInteger("idx");
            if (oldIdx != null && classPath != null) {
                idxMapping.put(oldIdx, newIdx);
            }
            if (classPath != null) {
                classToIdx.put(classPath, newIdx++);
            }
            sorted.add(normalizeObject(obj));
        }
        return sorted;
    }

    /**
     * Normalizes a single object
     */
    private JSONObject normalizeObject(JSONObject object) {
        JSONObject result = new JSONObject();

        // Normalize the class path
        String classPath = normalizeClassPath(object.getString("class"));
        if (classPath != null) {
            result.put("class", classPath);
        }

        // Normalize conditions
        JSONObject conditions = object.getJSONObject("conditions");
        if (conditions != null) {
            result.put("conditions", normalizeConditions(conditions));
        }

        return result;
    }

    /**
     * Normalizes conditions
     */
    private JSONObject normalizeConditions(JSONObject conditions) {
        JSONObject result = new JSONObject();

        // Normalize properties
        JSONObject properties = conditions.getJSONObject("properties");
        if (properties != null) {
            result.put("properties", normalizeProperties(properties));
        }

        // Keep other types of conditions
        JSONObject text = conditions.getJSONObject("text");
        if (text != null) {
            result.put("text", text);
        }

        JSONObject vector = conditions.getJSONObject("vector");
        if (vector != null) {
            result.put("vector", vector);
        }

        JSONObject timeseries = conditions.getJSONObject("timeseries");
        if (timeseries != null) {
            result.put("timeseries", timeseries);
        }

        return result;
    }

    /**
     * Normalizes properties
     */
    private JSONObject normalizeProperties(JSONObject properties) {
        JSONObject result = new JSONObject();

        String operator = properties.getString("operator");
        if (operator != null) {
            result.put("operator", operator);
        }

        // Normalize the and array
        JSONArray and = properties.getJSONArray("and");
        if (and != null) {
            result.put("and", normalizePropertyConditions(and));
        }

        // Normalize the or array
        JSONArray or = properties.getJSONArray("or");
        if (or != null) {
            result.put("or", normalizePropertyConditions(or));
        }

        // Handle simple key-value conditions
        if (and == null && or == null) {
            String field = properties.getString("field");
            if (field != null) {
                result.put("field", field);
            }
            String op = properties.getString("operator");
            if (op != null) {
                result.put("operator", op);
            }
            Object value = properties.get("value");
            if (value != null) {
                result.put("value", value);
            }
        }

        return result;
    }

    /**
     * Normalizes the attribute condition array
     * Sorts the conditions inside and/or to ensure order independence
     */
    private JSONArray normalizePropertyConditions(JSONArray conditions) {
        List<JSONObject> condList = new ArrayList<>();
        for (int i = 0; i < conditions.size(); i++) {
            Object item = conditions.get(i);
            if (item instanceof JSONObject) {
                JSONObject obj = (JSONObject) item;
                String operator = obj.getString("operator");
                // Handle nested logic conditions
                if ("logic".equals(operator)) {
                    JSONObject nested = new JSONObject();
                    nested.put("operator", operator);
                    JSONArray nestedAnd = obj.getJSONArray("and");
                    if (nestedAnd != null) {
                        JSONArray sortedAnd = normalizeAndOrArray(nestedAnd);
                        nested.put("and", sortedAnd);
                    }
                    JSONArray nestedOr = obj.getJSONArray("or");
                    if (nestedOr != null) {
                        JSONArray sortedOr = normalizeAndOrArray(nestedOr);
                        nested.put("or", sortedOr);
                    }
                    condList.add(nested);
                } else {
                    condList.add(normalizeConditionValue(obj));
                }
            } else {
                condList.add((JSONObject) item);
            }
        }

        // Sort the conditions by field, and by operator when field is the same
        condList.sort((c1, c2) -> {
            String field1 = c1.getString("field");
            String field2 = c2.getString("field");

            if (field1 == null && field2 == null) return 0;
            if (field1 == null) return 1;
            if (field2 == null) return -1;

            int cmp = field1.compareTo(field2);
            if (cmp != 0) return cmp;

            // Sort by operator when field is the same
            Object val1 = c1.get("value");
            Object val2 = c2.get("value");

            // Sort the array values
            if (val1 instanceof JSONArray && val2 instanceof JSONArray) {
                JSONArray arr1 = (JSONArray) val1;
                JSONArray arr2 = (JSONArray) val2;
                List<String> list1 = new ArrayList<>();
                List<String> list2 = new ArrayList<>();
                for (Object o : arr1) list1.add(o.toString());
                for (Object o : arr2) list2.add(o.toString());
                Collections.sort(list1);
                Collections.sort(list2);
                int minLen = Math.min(list1.size(), list2.size());
                for (int i = 0; i < minLen; i++) {
                    int c = list1.get(i).compareTo(list2.get(i));
                    if (c != 0) return c;
                }
                return Integer.compare(list1.size(), list2.size());
            }
            if (val1 == null && val2 == null) return 0;
            if (val1 == null) return -1;
            if (val2 == null) return 1;
            return val1.toString().compareTo(val2.toString());
        });

        JSONArray result = new JSONArray();
        for (JSONObject c : condList) {
            result.add(c);
        }
        return result;
    }

    /**
     * Normalizes a condition value, sorting the array values of the in operator
     */
    private JSONObject normalizeConditionValue(JSONObject cond) {
        JSONObject result = new JSONObject();
        result.put("field", cond.getString("field"));
        result.put("operator", cond.getString("operator"));
        Object value = cond.get("value");
        // Sort the array values of the in operator
        if (value instanceof JSONArray) {
            JSONArray arr = (JSONArray) value;
            List<String> list = new ArrayList<>();
            for (Object o : arr) list.add(o.toString());
            Collections.sort(list);
            JSONArray sorted = new JSONArray();
            for (String s : list) sorted.add(s);
            result.put("value", sorted);
        } else {
            result.put("value", value);
        }
        return result;
    }

    /**
     * Normalizes the and/or array
     * Sorts by field, and by operator when field is the same
     */
    private JSONArray normalizeAndOrArray(JSONArray arr) {
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < arr.size(); i++) {
            Object item = arr.get(i);
            if (item instanceof JSONObject) {
                list.add(normalizeConditionValue((JSONObject) item));
            }
        }
        // Sort by field, and by operator when field is the same
        list.sort((c1, c2) -> {
            String field1 = c1.getString("field");
            String field2 = c2.getString("field");
            if (field1 == null && field2 == null) return 0;
            if (field1 == null) return 1;
            if (field2 == null) return -1;
            int cmp = field1.compareTo(field2);
            if (cmp != 0) return cmp;
            // Sort by operator when field is the same
            String op1 = c1.getString("operator");
            String op2 = c2.getString("operator");
            if (op1 == null && op2 == null) return 0;
            if (op1 == null) return 1;
            if (op2 == null) return -1;
            return op1.compareTo(op2);
        });

        JSONArray result = new JSONArray();
        for (JSONObject obj : list) {
            result.add(obj);
        }
        return result;
    }

    /**
     * Normalizes the output part
     */
    private JSONObject normalizeOutput(JSONObject output, JSONArray patterns) {
        JSONObject result = new JSONObject();

        // Keep to_user
        Boolean toUser = output.getBoolean("to_user");
        if (toUser != null) {
            result.put("to_user", toUser);
        }

        // Normalize the fields array
        JSONArray fields = output.getJSONArray("fields");
        if (fields != null) {
            // Build the variable to class mapping
            Map<String, String> varToClass = new HashMap<>();
            if (patterns != null) {
                for (int i = 0; i < patterns.size(); i++) {
                    JSONObject pattern = patterns.getJSONObject(i);
                    JSONArray objects = pattern.getJSONArray("objects");
                    if (objects != null) {
                        for (int j = 0; j < objects.size(); j++) {
                            JSONObject obj = objects.getJSONObject(j);
                            String var = obj.getString("variable");
                            String cls = normalizeClassPath(obj.getString("class"));
                            if (var != null && cls != null) {
                                varToClass.put(var, cls);
                            }
                        }
                    }
                }
            }
            JSONArray sortedFields = sortFieldsByClassField(fields, varToClass);
            result.put("fields", sortedFields);
        }

        // Keep other fields
        JSONObject sort = output.getJSONObject("sort");
        if (sort != null) {
            result.put("sort", sort);
        }

        JSONObject limit = output.getJSONObject("limit");
        if (limit != null) {
            result.put("limit", limit);
        }

        JSONObject groupBy = output.getJSONObject("group_by");
        if (groupBy != null) {
            result.put("group_by", groupBy);
        }

        return result;
    }

    /**
     * Sorts the fields array by class+field
     */
    private JSONArray sortFieldsByClassField(JSONArray fields, Map<String, String> varToClass) {
        List<JSONObject> fieldList = new ArrayList<>();
        for (int i = 0; i < fields.size(); i++) {
            fieldList.add(fields.getJSONObject(i));
        }
        // Sort by class+field
        fieldList.sort(Comparator.comparing(f -> {
            String variable = f.getString("variable");
            String normalizedVar = normalizeVariable(variable, varToClass.get(variable));
            String cls = variable != null ? varToClass.getOrDefault(variable, normalizedVar) : "";
            String field = f.getString("field");
            String expr = f.getString("expr");
            return cls + ":" + (field != null ? field : "") + ":" + (expr != null ? expr : "");
        }));

        JSONArray sorted = new JSONArray();
        for (JSONObject f : fieldList) {
            sorted.add(normalizeField(f, varToClass));
        }
        return sorted;
    }

    /**
     * Normalizes a single field
     * Ignores the as alias and normalizes variable
     */
    private JSONObject normalizeField(JSONObject field, Map<String, String> varToClass) {
        JSONObject result = new JSONObject();

        // Normalize variable
        String variable = field.getString("variable");
        if (variable != null) {
            String normalizedVar = normalizeVariable(variable, varToClass.get(variable));
            result.put("variable", normalizedVar);
        }

        // Keep field (different field means not equivalent)
        String fieldName = field.getString("field");
        if (fieldName != null) {
            result.put("field", fieldName);
        }

        // Keep expr
        String expr = field.getString("expr");
        if (expr != null) {
            result.put("expr", expr);
        }

        // Keep function
        String function = field.getString("function");
        if (function != null) {
            result.put("function", function);
        }

        // Keep distinct
        Boolean distinct = field.getBoolean("distinct");
        if (distinct != null) {
            result.put("distinct", distinct);
        }

        // Keep time_range
        JSONObject timeRange = field.getJSONObject("time_range");
        if (timeRange != null) {
            result.put("time_range", timeRange);
        }

        // Keep conditions
        JSONArray conds = field.getJSONArray("conditions");
        if (conds != null) {
            result.put("conditions", conds);
        }

        // Keep query
        String query = field.getString("query");
        if (query != null) {
            result.put("query", query);
        }

        return result;
    }

    public static void main(String[] args) throws Exception {
        DSLGrouper grouper = new DSLGrouper();

        List<String> dslList = new ArrayList<>();
        dslList.add(new String(Files.readAllBytes(Paths.get("test/C01/A01.json"))));
        dslList.add(new String(Files.readAllBytes(Paths.get("test/C01/A02.json"))));
        dslList.add(new String(Files.readAllBytes(Paths.get("test/C01/A03.json"))));
        dslList.add(new String(Files.readAllBytes(Paths.get("test/C01/A04.json"))));

        List<List<Integer>> result = grouper.group(dslList);
        System.out.println("Grouping result: " + result);
    }
}