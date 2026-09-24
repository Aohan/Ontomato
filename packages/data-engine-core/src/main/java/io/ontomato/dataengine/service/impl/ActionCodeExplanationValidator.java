package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.BusinessMeaning;

/**
 * Shape validation for the code explainer's output. The LLM's output enters the system here: if any single part is invalid, the whole explanation is discarded (treated as an explanation failure,
 * the action's code segments and business meaning are empty), so the explanation stored in the database is always valid, and the frontend and other consumers can trust it directly.
 * The rules correspond to the definition in the prompt action_code_explainer.md.
 */
final class ActionCodeExplanationValidator {

	private static final Set<String> KINDS = Set.of("QUERY", "CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT",
			"CREATE_EDGE", "DELETE_EDGE", "COMPUTE", "EXTERNAL_CALL", "BRANCH", "LOOP", "TRY_CATCH", "ERROR_HANDLING",
			"CUSTOM");

	private static final List<String> TEXT_DETAILS = List.of("narrative", "class", "relation", "sourceClass",
			"sourceObjectIdFrom", "targetClass", "targetObjectIdFrom");

	private ActionCodeExplanationValidator() {
	}

	/** Validate and return non-empty segs; when invalid, throw IllegalArgumentException with the message giving the error location. */
	static JSONArray segments(JSONObject result) {
		require(result != null, "explanation result", "is not a JSON object");
		JSONArray segs = array(result.get("segs"), "segs");
		require(!segs.isEmpty(), "segs", "is empty");
		segmentList(segs, "segs");
		return segs;
	}

	/** Business meaning: operations are stripped of leading and trailing whitespace and empty entries are dropped, the negative effect is stripped of leading and trailing whitespace; if both are empty, return null. */
	static BusinessMeaning businessMeaning(JSONObject result) {
		List<String> operations = new ArrayList<>();
		if (result.get("operations") != null) {
			JSONArray items = array(result.get("operations"), "operations");
			for (int i = 0; i < items.size(); i++) {
				String operation = text(items.get(i), "operations[" + i + "]").strip();
				if (!operation.isEmpty()) {
					operations.add(operation);
				}
			}
		}
		String negativeEffect = result.get("negativeEffect") == null ? "" : text(result.get("negativeEffect"), "negativeEffect").strip();
		if (operations.isEmpty() && negativeEffect.isEmpty()) {
			return null;
		}
		BusinessMeaning meaning = new BusinessMeaning();
		meaning.setOperations(operations);
		meaning.setNegativeEffect(negativeEffect);
		return meaning;
	}

	private static void segmentList(JSONArray segs, String path) {
		for (int i = 0; i < segs.size(); i++) {
			segment(object(segs.get(i), path + "[" + i + "]"), path + "[" + i + "]");
		}
	}

	private static void segment(JSONObject seg, String path) {
		requiredText(seg, "id", path);
		String kind = requiredText(seg, "kind", path);
		require(KINDS.contains(kind), path + ".kind", "is not a defined kind: " + kind);
		requiredText(seg, "title", path);
		// The line number only requires 1 <= start <= end: the model counts one extra line for code ending with a newline, and comparing against the line count would wrongly reject a usable explanation
		JSONObject range = object(seg.get("codeRange"), path + ".codeRange");
		int start = integer(range.get("start"), path + ".codeRange.start");
		int end = integer(range.get("end"), path + ".codeRange.end");
		require(1 <= start && start <= end, path + ".codeRange", "line range " + start + "-" + end + " is invalid");

		for (String key : TEXT_DETAILS) {
			if (seg.get(key) != null) {
				text(seg.get(key), path + "." + key);
			}
		}
		if (seg.get("estRows") != null) {
			require(seg.get("estRows") instanceof String || seg.get("estRows") instanceof Number, path + ".estRows", "is not a string or number");
		}
		if (seg.get("assignments") != null) {
			JSONArray assignments = array(seg.get("assignments"), path + ".assignments");
			for (int i = 0; i < assignments.size(); i++) {
				String item = path + ".assignments[" + i + "]";
				JSONObject assignment = object(assignments.get(i), item);
				requiredText(assignment, "field", item);
				requiredText(assignment, "valueFrom", item);
			}
		}
		if (seg.get("conditions") != null) {
			condition(seg.get("conditions"), path + ".conditions");
		}
		if (seg.get("filters") != null) {
			filters(object(seg.get("filters"), path + ".filters"), path + ".filters");
		}
		if (seg.get("output") != null) {
			output(object(seg.get("output"), path + ".output"), path + ".output");
		}

		if (seg.get("trySegs") != null) {
			segmentList(array(seg.get("trySegs"), path + ".trySegs"), path + ".trySegs");
		}
		if (seg.get("segs") != null) {
			segmentList(array(seg.get("segs"), path + ".segs"), path + ".segs");
		}
		labelledGroups(seg, "catchs", "error", path);
		labelledGroups(seg, "branchArms", "condition", path);
	}

	/** catchs / branchArms: each item is {label, segs}. */
	private static void labelledGroups(JSONObject seg, String key, String labelKey, String path) {
		if (seg.get(key) == null) {
			return;
		}
		JSONArray groups = array(seg.get(key), path + "." + key);
		for (int i = 0; i < groups.size(); i++) {
			String item = path + "." + key + "[" + i + "]";
			JSONObject group = object(groups.get(i), item);
			requiredText(group, labelKey, item);
			segmentList(array(group.get("segs"), item + ".segs"), item + ".segs");
		}
	}

	private static void filters(JSONObject filters, String path) {
		JSONArray objects = array(filters.get("objects"), path + ".objects");
		for (int i = 0; i < objects.size(); i++) {
			String item = path + ".objects[" + i + "]";
			JSONObject object = object(objects.get(i), item);
			requiredText(object, "alias", item);
			requiredText(object, "class", item);
			if (object.get("conditions") != null) {
				condition(object.get("conditions"), item + ".conditions");
			}
		}
		if (filters.get("relationship") != null) {
			JSONArray relations = array(filters.get("relationship"), path + ".relationship");
			for (int i = 0; i < relations.size(); i++) {
				String item = path + ".relationship[" + i + "]";
				JSONObject relation = object(relations.get(i), item);
				requiredText(relation, "from", item);
				requiredText(relation, "to", item);
				requiredText(relation, "type", item);
			}
		}
	}

	private static void output(JSONObject output, String path) {
		for (String key : List.of("fields", "group_by", "sort")) {
			if (output.get(key) == null) {
				continue;
			}
			JSONArray entries = array(output.get(key), path + "." + key);
			for (int i = 0; i < entries.size(); i++) {
				String item = path + "." + key + "[" + i + "]";
				JSONObject entry = object(entries.get(i), item);
				requiredText(entry, "source", item);
				requiredText(entry, "field", item);
				if ("sort".equals(key)) {
					requiredText(entry, "order", item);
				}
			}
		}
		if (output.get("limit") != null) {
			JSONObject limit = object(output.get("limit"), path + ".limit");
			for (String key : List.of("offset", "count")) {
				if (limit.get(key) != null) {
					integer(limit.get(key), path + ".limit." + key);
				}
			}
		}
	}

	/** Three forms of a condition: {properties: condition}, {operator: "logic", and/or: [condition]}, leaf {field, operator, value}. */
	private static void condition(Object value, String path) {
		JSONObject condition = object(value, path);
		if (condition.containsKey("properties")) {
			condition(condition.get("properties"), path + ".properties");
			return;
		}
		if ("logic".equals(condition.get("operator"))) {
			int children = 0;
			for (String key : List.of("and", "or")) {
				if (condition.get(key) != null) {
					JSONArray items = array(condition.get(key), path + "." + key);
					for (int i = 0; i < items.size(); i++) {
						condition(items.get(i), path + "." + key + "[" + i + "]");
					}
					children += items.size();
				}
			}
			require(children > 0, path, "logic condition has no child condition");
			return;
		}
		requiredText(condition, "field", path);
		requiredText(condition, "operator", path);
	}

	private static String requiredText(JSONObject object, String key, String path) {
		String value = text(object.get(key), path + "." + key);
		require(!value.isBlank(), path + "." + key, "is empty");
		return value;
	}

	private static String text(Object value, String path) {
		require(value instanceof String, path, "is not a string");
		return (String) value;
	}

	private static int integer(Object value, String path) {
		require(value instanceof Integer || value instanceof Long, path, "is not an integer");
		return ((Number) value).intValue();
	}

	private static JSONObject object(Object value, String path) {
		require(value instanceof JSONObject, path, "is not an object");
		return (JSONObject) value;
	}

	private static JSONArray array(Object value, String path) {
		require(value instanceof JSONArray, path, "is not an array");
		return (JSONArray) value;
	}

	private static void require(boolean condition, String path, String problem) {
		if (!condition) {
			throw new IllegalArgumentException(path + " " + problem);
		}
	}
}
