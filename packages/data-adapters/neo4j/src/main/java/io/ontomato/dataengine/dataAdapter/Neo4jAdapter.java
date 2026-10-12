package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.SQLException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Record;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;
import org.neo4j.driver.Value;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

/**
 * Neo4j adapter over the Bolt driver.
 *
 * <p>Neo4j is a non-JDBC data source: {@link #openConnection()} throws, and {@link #testConnection()}
 * runs a Bolt probe instead of the JDBC tester. Classes map to node labels, objects to nodes, edges to
 * relationship-free key fields (the graph DSL joins objects by shared key fields, mirroring the relational
 * adapters so the shared contract suite passes without materializing relationships), and the read path
 * translates a graph DSL to a single Cypher {@code MATCH ... WHERE ... RETURN ...} query.</p>
 */
@Slf4j
public class Neo4jAdapter implements DataAdapter {

	private static final String DEFAULT_DATABASE = "neo4j";

	private final DataAdapterConnection connection;
	private final Map<String, Object> jsonRule;

	public Neo4jAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	private Driver driver() {
		return GraphDatabase.driver(connection.getUrl(), AuthTokens.basic(connection.getUser(), connection.getPassword()));
	}

	/** Every operation runs in a fresh driver+session, closed on exit, so no connection pool outlives the adapter. */
	private <T> T withSession(SessionFn<T> fn) throws Exception {
		try (Driver driver = driver()) {
			try (Session session = driver.session()) {
				return fn.apply(session);
			}
		}
	}

	@FunctionalInterface
	private interface SessionFn<T> {
		T apply(Session session) throws Exception;
	}

	@Override
	public Connection openConnection() throws SQLException {
		throw new UnsupportedOperationException("Neo4j is not a JDBC data source");
	}

	/** Probes the Bolt connection and reports the installed labels as the source's "tables". */
	@Override
	public JSONObject testConnection() throws Exception {
		long startNanos = System.nanoTime();
		return withSession(session -> {
			Result ping = session.run("RETURN 1 AS ok");
			ping.consume();
			JSONArray tables = new JSONArray();
			Result labels = session.run("CALL db.labels()");
			while (labels.hasNext()) {
				Value label = labels.next().get("label");
				if (!label.isNull()) {
					tables.add(JSONObject.of("name", label.asString(), "type", "TABLE"));
				}
			}
			JSONObject report = new JSONObject();
			report.put("databaseProduct", "Neo4j");
			report.put("databaseVersion", "");
			report.put("driverName", "Neo4j Bolt");
			report.put("driverVersion", "");
			report.put("catalog", null);
			report.put("schema", null);
			report.put("tables", tables);
			report.put("elapsedMs", (System.nanoTime() - startNanos) / 1_000_000);
			return report;
		});
	}

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception {
		log.info("[" + sessionId + "] Neo4j DSL to query: " + queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		CypherQuery cypher = toCypher(dsls.getJSONObject(0), jsonRule);
		generatedMqls.add(cypher.text);
		log.info("[" + sessionId + "] Converted Neo4j cypher: " + cypher.text);
		JSONArray data = queryCypher(cypher);
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", data);
		answer.put("mqls", generatedMqls);
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	/** A Cypher statement and its parameters; parameter names are p0, p1, ... in generation order. */
	private static final class CypherQuery {
		String text;
		final Map<String, Object> params = new HashMap<>();
		int counter = 0;

		String next() {
			return "p" + counter++;
		}
	}

	/**
	 * Translate one graph DSL to a Cypher query. Two-step DSLs are chained with {@code WITH}: the first
	 * step's output fields become aliases the second step consumes.
	 */
	private CypherQuery toCypher(JSONObject dsl, Map<String, Object> jsonRule) throws Exception {
		try {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
			Map<String, Map<String, String>> classAttrTypeMap = new HashMap<>();
			Map<String, Set<String>> classEnableAttrsMap = new HashMap<>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> attrTypeMap = new HashMap<>();
				Set<String> enableAttrs = new HashSet<>();
				@SuppressWarnings("unchecked")
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
						enableAttrs.add((String) attrDef.get("name"));
					}
				}
				classAttrTypeMap.put((String) classDef.get("className"), attrTypeMap);
				classEnableAttrsMap.put((String) classDef.get("className"), enableAttrs);
			}
			@SuppressWarnings("unchecked")
			Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");

			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);
			CypherQuery query = new CypherQuery();
			buildStep(firstStep, classAttrTypeMap, classEnableAttrsMap, relationship_rule, query, steps.size() > 1);
			if (steps.size() == 1) {
				return query;
			}
			// Two-step DSL: the first step's output aliases feed the second step through WITH.
			JSONObject secondStep = steps.getJSONObject(1);
			String tmpClassAs = secondStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("objects").getJSONObject(0).getString("variable");
			CypherQuery step2 = new CypherQuery();
			step2.counter = query.counter;
			buildSecondStep(secondStep, query, step2, tmpClassAs);
			return step2;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Failed to convert DSL to Cypher");
		}
	}

	private void buildStep(JSONObject step, Map<String, Map<String, String>> classAttrTypeMap,
			Map<String, Set<String>> classEnableAttrsMap, Map<String, Object> relationship_rule, CypherQuery query,
			boolean twoStep) {
		JSONArray objects = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
		Map<Integer, String[]> idxMap = new HashMap<>();

		// MATCH clause: one node per object, labelled with its (namespace-prefixed) class.
		StringBuilder match = new StringBuilder("match ");
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			String className = object.getString("class");
			String alias = object.getString("variable");
			idxMap.put(object.getInteger("idx"), new String[] { className, alias });
			if (i > 0) {
				match.append(", ");
			}
			match.append("(").append(alias).append(":`").append(className).append("`)");
		}

		// WHERE clause: per-object conditions plus the relationship key-field joins.
		List<String> whereParts = new ArrayList<>();
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			String className = object.getString("class");
			String alias = object.getString("variable");
			Map<String, String> attrTypeMap = classAttrTypeMap.get(className);
			Set<String> enableAttrs = classEnableAttrsMap.get(className);
			String objWhere = buildConditions(object.getJSONObject("conditions"), alias, attrTypeMap, enableAttrs, query);
			if (!objWhere.isEmpty()) {
				whereParts.add(objWhere);
			}
		}
		JSONArray relationships = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
				.getJSONArray("relationship");
		if (relationships != null) {
			for (int i = 0; i < relationships.size(); i++) {
				JSONObject relationship = relationships.getJSONObject(i);
				String[] fromClassAlias = idxMap.get(relationship.getInteger("from"));
				String[] toClassAlias = idxMap.get(relationship.getInteger("to"));
				String relationshipName = relationship.getJSONArray("type").getString(0).trim();
				@SuppressWarnings("unchecked")
				Map<String, Object> relationDef = (Map<String, Object>) relationship_rule.get(relationshipName);
				if (relationDef != null) {
					String fromField = (String) relationDef.get("fromField");
					String toField = (String) relationDef.get("toField");
					whereParts.add(fromClassAlias[1] + "." + fromField + " = " + toClassAlias[1] + "." + toField);
				}
			}
		}

		JSONObject output = step.getJSONObject("output");
		StringBuilder where = new StringBuilder();
		if (!whereParts.isEmpty()) {
			where.append("\nwhere ").append(String.join("\nand ", whereParts));
		}

		// RETURN clause, with an explicit WITH+WHERE when a HAVING is present (Cypher filters aggregates there).
		StringBuilder body = new StringBuilder();
		body.append(match).append(where);

		ReturnPlan plan = buildReturn(output);
		boolean hasHaving = output.getJSONObject("group_by") != null
				&& output.getJSONObject("group_by").getJSONArray("having") != null
				&& !output.getJSONObject("group_by").getJSONArray("having").isEmpty();
		if (hasHaving) {
			body.append("\nwith ").append(plan.clause);
			body.append(buildHaving(output.getJSONObject("group_by").getJSONArray("having"), query, plan.aggAlias));
			body.append("\nreturn ").append(String.join(", ", plan.aliases));
		} else {
			body.append("\nreturn ").append(plan.clause);
		}

		String orderBy = buildOrderBy(output);
		if (orderBy != null) {
			body.append("\n").append(orderBy);
		}
		String limit = buildLimit(output);
		if (limit != null) {
			body.append("\n").append(limit);
		}
		query.text = body.toString();
	}

	private void buildSecondStep(JSONObject secondStep, CypherQuery first, CypherQuery second, String tmpClassAs) {
		// The first step's aliases are the intermediate rows; the second step re-projects and aggregates them.
		String firstText = first.text;
		StringBuilder body = new StringBuilder(firstText);

		JSONObject output = secondStep.getJSONObject("output");
		JSONArray fields = output.getJSONArray("fields");
		List<String> aliases = new ArrayList<>();
		Map<String, String> aggAlias = new HashMap<>();
		StringBuilder returnExprs = new StringBuilder();
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String as = field.getString("as");
			String function = field.getString("function");
			String fieldName = field.getString("field");
			String expr = secondStepExpr(field, tmpClassAs);
			if (as != null && !as.isBlank()) {
				aliases.add("`" + as + "`");
				if (function != null && !function.isBlank()) {
					aggAlias.put(function + "\u0000" + fieldName, as);
				}
			}
			returnExprs.append(expr).append(as != null && !as.isBlank() ? " as `" + as + "`" : "");
			if (i < fields.size() - 1) {
				returnExprs.append(", ");
			}
		}

		body.append("\nwith ").append(returnExprs);
		boolean hasHaving = output.getJSONObject("group_by") != null
				&& output.getJSONObject("group_by").getJSONArray("having") != null
				&& !output.getJSONObject("group_by").getJSONArray("having").isEmpty();
		if (hasHaving) {
			body.append(buildHaving(output.getJSONObject("group_by").getJSONArray("having"), second, aggAlias));
		}
		body.append("\nreturn ").append(String.join(", ", aliases));
		String orderBy = buildOrderBy(output);
		if (orderBy != null) {
			body.append("\n").append(orderBy);
		}
		String limit = buildLimit(output);
		if (limit != null) {
			body.append("\n").append(limit);
		}
		second.text = body.toString();
	}

	private String secondStepExpr(JSONObject field, String tmpClassAs) {
		String variable = field.getString("variable");
		String fieldName = field.getString("field");
		String function = field.getString("function");
		boolean distinct = field.getBoolean("distinct") != null && field.getBoolean("distinct");
		String ref;
		if (variable != null && !variable.isBlank()) {
			ref = "`" + fieldName + "`";
		} else {
			ref = fieldName;
		}
		if (function != null && !function.isBlank()) {
			return function + "(" + (distinct ? "distinct " : "") + ref + ")";
		}
		return ref;
	}

	/** Translate one object's conditions block to a Cypher predicate fragment, or "" when absent. */
	private String buildConditions(JSONObject conditions, String alias, Map<String, String> attrTypeMap,
			Set<String> enableAttrs, CypherQuery query) {
		if (conditions == null) {
			return "";
		}
		StringBuilder where = new StringBuilder();
		if (conditions.getJSONObject("properties") != null) {
			String props = buildConditionTree(conditions.getJSONObject("properties"), alias, attrTypeMap, query);
			if (!props.isEmpty()) {
				where.append(props);
			}
		}
		if (conditions.getJSONObject("text") != null) {
			JSONObject text = conditions.getJSONObject("text");
			String raw = text.getString("query");
			if (raw != null && !raw.trim().isEmpty()) {
				String param = query.next();
				query.params.put(param, raw.trim());
				List<String> parts = new ArrayList<>();
				for (String enableAttr : enableAttrs) {
					String type = attrTypeMap.get(enableAttr);
					if ("varchar".equals(type) || "text".equals(type)) {
						parts.add(alias + "." + enableAttr + " contains $" + param);
					}
				}
				if (!parts.isEmpty()) {
					if (!where.isEmpty()) {
						where.append(" and ");
					}
					where.append("(").append(String.join(" or ", parts)).append(")");
				}
			}
		}
		return where.toString();
	}

	/** Recursively build a Cypher predicate for an and/or nested condition tree. */
	private String buildConditionTree(JSONObject condition, String alias, Map<String, String> attrTypeMap, CypherQuery query) {
		JSONArray ands = condition.getJSONArray("and");
		if (ands != null && !ands.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ands.size(); i++) {
				parts.add(buildConditionTree(ands.getJSONObject(i), alias, attrTypeMap, query));
			}
			return "(" + String.join(" and ", parts) + ")";
		}
		JSONArray ors = condition.getJSONArray("or");
		if (ors != null && !ors.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ors.size(); i++) {
				parts.add(buildConditionTree(ors.getJSONObject(i), alias, attrTypeMap, query));
			}
			return "(" + String.join(" or ", parts) + ")";
		}
		return buildLeafCondition(condition, alias, attrTypeMap, query);
	}

	private String buildLeafCondition(JSONObject condition, String alias, Map<String, String> attrTypeMap, CypherQuery query) {
		String field = condition.getString("field");
		String operator = condition.getString("operator");
		String type = attrTypeMap.get(field);
		String col = alias + "." + field;
		if ("is".equals(operator)) {
			return col + " is null";
		}
		if ("is not".equals(operator)) {
			return col + " is not null";
		}
		if ("between".equals(operator)) {
			JSONArray value = condition.getJSONArray("value");
			String low = query.next();
			String high = query.next();
			query.params.put(low, coerce(type, value.get(0)));
			query.params.put(high, coerce(type, value.get(1)));
			return "(" + col + " >= $" + low + " and " + col + " <= $" + high + ")";
		}
		if ("in".equals(operator)) {
			JSONArray value = condition.getJSONArray("value");
			String param = query.next();
			List<Object> list = new ArrayList<>();
			for (int i = 0; i < value.size(); i++) {
				list.add(coerce(type, value.get(i)));
			}
			query.params.put(param, list);
			return col + " in $" + param;
		}
		if ("like".equals(operator) || "not like".equals(operator)) {
			String value = (String) condition.get("value");
			// The read path wraps a bare value in %..% like the SQL adapters do; the write path does not.
			if (!value.startsWith("%") && !value.endsWith("%")) {
				value = "%" + value + "%";
			}
			String param = query.next();
			query.params.put(param, likeToRegex(value));
			String predicate = col + " =~ $" + param;
			return "not like".equals(operator) ? "not " + predicate : predicate;
		}
		// =, !=, >, >=, <, <=
		String param = query.next();
		query.params.put(param, coerce(type, condition.get("value")));
		String cypherOperator = "!=".equals(operator) ? "<>" : operator;
		return col + " " + cypherOperator + " $" + param;
	}

	/**
	 * Neo4j has no SQL {@code like}; translate its pattern to a regex for {@code =~}:
	 * {@code %} becomes {@code .*}, {@code _} becomes {@code .}, and regex metacharacters are escaped.
	 */
	private String likeToRegex(String pattern) {
		StringBuilder regex = new StringBuilder();
		for (char c : pattern.toCharArray()) {
			if (c == '%') {
				regex.append(".*");
			} else if (c == '_') {
				regex.append('.');
			} else if (".+*?()[]{}|\\^$".indexOf(c) >= 0) {
				regex.append('\\').append(c);
			} else {
				regex.append(c);
			}
		}
		return regex.toString();
	}

	/** The return projection of one step: its expression clause, its aliases, and aggregate alias lookups for HAVING. */
	private static final class ReturnPlan {
		String clause;
		final List<String> aliases = new ArrayList<>();
		final Map<String, String> aggAlias = new HashMap<>();
	}

	private ReturnPlan buildReturn(JSONObject output) {
		ReturnPlan plan = new ReturnPlan();
		JSONArray fields = output.getJSONArray("fields");
		StringBuilder returnExprs = new StringBuilder();
		boolean plainDistinct = false;
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String variable = field.getString("variable");
			String fieldName = field.getString("field");
			String as = field.getString("as");
			String function = field.getString("function");
			boolean distinct = field.getBoolean("distinct") != null && field.getBoolean("distinct");
			String expr;
			if (function != null && !function.isBlank()) {
				expr = function + "(" + (distinct ? "distinct " : "") + variable + "." + fieldName + ")";
				if (as != null && !as.isBlank()) {
					plan.aggAlias.put(function + "\u0000" + fieldName, as);
				}
			} else {
				if (distinct) {
					plainDistinct = true;
				}
				expr = variable + "." + fieldName;
			}
			returnExprs.append(expr);
			if (as != null && !as.isBlank()) {
				returnExprs.append(" as `").append(as).append("`");
				plan.aliases.add("`" + as + "`");
			}
			if (i < fields.size() - 1) {
				returnExprs.append(", ");
			}
		}
		plan.clause = (plainDistinct ? "distinct " : "") + returnExprs;
		return plan;
	}

	private String buildHaving(JSONArray having, CypherQuery query, Map<String, String> aggAlias) {
		StringBuilder where = new StringBuilder();
		for (int i = 0; i < having.size(); i++) {
			JSONObject cond = having.getJSONObject(i);
			String field = cond.getString("field");
			String function = cond.getString("function");
			String alias;
			if (function != null && !function.isBlank()) {
				alias = aggAlias.getOrDefault(function + "\u0000" + field, function + "_" + field);
			} else {
				alias = field;
			}
			String operator = cond.getString("operator");
			String cypherOperator = "!=".equals(operator) ? "<>" : operator;
			String param = query.next();
			query.params.put(param, cond.get("value"));
			where.append("\nwhere `").append(alias).append("` ").append(cypherOperator).append(" $").append(param);
		}
		return where.toString();
	}

	private String buildOrderBy(JSONObject output) {
		JSONObject sort = output.getJSONObject("sort");
		if (sort == null || sort.getJSONArray("fields") == null || sort.getJSONArray("fields").isEmpty()) {
			return null;
		}
		StringBuilder orderBy = new StringBuilder("order by ");
		JSONArray fields = sort.getJSONArray("fields");
		for (int i = 0; i < fields.size(); i++) {
			JSONObject order = fields.getJSONObject(i);
			orderBy.append("`").append(order.getString("field")).append("`")
					.append("desc".equals(order.getString("order")) ? " desc" : "");
			if (i < fields.size() - 1) {
				orderBy.append(", ");
			}
		}
		return orderBy.toString();
	}

	private String buildLimit(JSONObject output) {
		JSONObject limit = output.getJSONObject("limit");
		if (limit == null || limit.getInteger("count") == null) {
			return null;
		}
		Integer offset = limit.getInteger("offset");
		if (offset == null) {
			offset = 0;
		}
		return "skip " + offset + " limit " + limit.getInteger("count");
	}

	private Object coerce(String type, Object value) {
		if (value == null) {
			return null;
		}
		if ("date".equals(type) || "timestamp".equals(type)) {
			return new Date(((Number) value).longValue());
		}
		return value;
	}

	private JSONArray queryCypher(CypherQuery cypher) throws Exception {
		log.info(cypher.text);
		return withSession(session -> {
			Result result = session.run(cypher.text, cypher.params);
			JSONArray rows = new JSONArray();
			while (result.hasNext()) {
				Record record = result.next();
				JSONObject row = new JSONObject();
				for (String key : record.keys()) {
					row.put(key, toJsonValue(record.get(key)));
				}
				rows.add(row);
			}
			return rows;
		});
	}

	private Object toJsonValue(Value value) {
		if (value.isNull()) {
			return null;
		}
		switch (value.type().name()) {
			case "INTEGER":
				return value.asLong();
			case "FLOAT":
				return value.asDouble();
			case "STRING":
				return value.asString();
			case "BOOLEAN":
				return value.asBoolean();
			case "LIST":
				return value.asList(Neo4jAdapter::toJsonValueStatic);
			case "MAP":
				JSONObject map = new JSONObject();
				value.asMap().forEach((k, v) -> map.put(k, toJsonValueStatic(v)));
				return map;
			case "DATE":
			case "LOCAL_TIME":
			case "LOCAL_DATE_TIME":
			case "ZONED_DATE_TIME":
			case "DURATION":
			case "POINT":
				return value.asObject().toString();
			default:
				return value.asObject();
		}
	}

	private static Object toJsonValueStatic(Object value) {
		if (value == null) {
			return null;
		}
		if (value instanceof Value v) {
			return v.asObject();
		}
		return value;
	}

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			StringBuilder select = new StringBuilder();
			for (int i = 0; i < attrs.size(); i++) {
				select.append("n.").append(attrs.get(i));
				if (i < attrs.size() - 1) {
					select.append(", ");
				}
			}
			CypherQuery cypher = new CypherQuery();
			cypher.text = "match (n:`" + className + "`) return " + select + " limit 1";
			JSONArray data = queryCypher(cypher);
			if (data.size() > 0) {
				JSONObject datum = data.getJSONObject(0);
				Set<String> keys = datum.keySet();
				for (String key : keys) {
					Object value = datum.get(key);
					if (value instanceof String str && str.length() > 100) {
						datum.put(key, str.substring(0, 100) + "...");
					}
				}
				return datum.toString();
			}
			return className + " class has no data";
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}

	@Override
	public void validatePrimaryKeyName(String attrName) throws Exception {
	}

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		return sandboxId + className;
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	@Override
	public void validateClassNameFormat(String className) throws Exception {
	}

	@Override
	public void createNamespace(String namespace) {
	}

	@Override
	public void truncateNamespace(String namespace) {
		try {
			CypherQuery cypher = new CypherQuery();
			String param = cypher.next();
			cypher.params.put(param, namespace);
			cypher.text = "match (n) where any(label in labels(n) where label starts with $" + param
					+ ") detach delete n";
			executeWrite(cypher);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void dropNamespace(String namespace) {
		truncateNamespace(namespace);
	}

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		// Neo4j creates labels on first use; no schema object to create.
	}

	private boolean isSupportedType(String type) {
		return "varchar".equals(type) || "text".equals(type) || "int".equals(type) || "long".equals(type)
				|| "double".equals(type) || "date".equals(type) || "timestamp".equals(type)
				|| "vector".equals(type);
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
		// Relationship types materialize on first use; nothing to create.
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		List<String> fields = new ArrayList<>();
		Map<String, String> attrTypeMap = new HashMap<>();
		String pk = DslUtil.getPrimaryKey(classDef);
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						fields.add((String) attrDef.get("name"));
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		CypherQuery cypher = new CypherQuery();
		String rowsParam = cypher.next();
		cypher.text = "unwind $" + rowsParam + " as row create (n:`" + fullClassName + "`) set n = row";
		List<Map<String, Object>> rows = new ArrayList<>();
		for (int i = 0; i < objs.size(); i++) {
			JSONObject obj = objs.getJSONObject(i);
			if (obj.get(pk) == null || "".equals(obj.getString(pk).trim())) {
				throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
			}
			Map<String, Object> row = new HashMap<>();
			for (String field : fields) {
				Object value = normalizeValue(attrTypeMap.get(field), obj.get(field));
				// Neo4j properties cannot be null; omitting a field reads back as absent (null).
				if (value != null) {
					row.put(field, value);
				}
			}
			rows.add(row);
		}
		cypher.params.put(rowsParam, rows);
		executeWrite(cypher);
	}

	/**
	 * A vector attribute is stored as a text property holding the JSON array string
	 * {@code [{"path":"...","text":"..."},...]}; serialize a non-string value before writing.
	 */
	private Object normalizeValue(String type, Object value) {
		if ("vector".equals(type) && value != null && !(value instanceof String)) {
			return JSON.toJSONString(value);
		}
		return value;
	}

	private boolean inSandbox(String sandboxId) {
		return sandboxId != null && !"".equals(sandboxId.trim());
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<>();
		Set<String> attrNames = new HashSet<>();
		String pk = DslUtil.getPrimaryKey(classDef);
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						attrNames.add((String) attrDef.get("name"));
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		CypherQuery cypher = new CypherQuery();
		StringBuilder set = new StringBuilder();
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			if (!attrNames.contains(key)) {
				throw new Exception("Field [" + key + "] does not exist");
			}
			String param = cypher.next();
			cypher.params.put(param, normalizeValue(attrTypeMap.get(key), setValues.get(key)));
			if (!set.isEmpty()) {
				set.append(", ");
			}
			set.append("n.").append(key).append(" = $").append(param);
		}

		cypher.text = "match (n:`" + fullClassName + "`)";
		WhereClause whereClause = buildWhere(where, attrTypeMap, cypher);
		if (!whereClause.fragment.isEmpty()) {
			cypher.text += "\nwhere " + whereClause.fragment;
		}
		cypher.text += "\nset " + set;
		executeWrite(cypher);
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + ((String) classDef.get("className")) : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<>();
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		CypherQuery cypher = new CypherQuery();
		cypher.text = "match (n:`" + fullClassName + "`)";
		WhereClause whereClause = buildWhere(where, attrTypeMap, cypher);
		if (!whereClause.fragment.isEmpty()) {
			cypher.text += "\nwhere " + whereClause.fragment;
		}
		cypher.text += "\ndetach delete n";
		executeWrite(cypher);
	}

	/** A WHERE fragment plus the parameters it registered. */
	private static final class WhereClause {
		String fragment = "";
	}

	private WhereClause buildWhere(JSONObject condition, Map<String, String> attrTypeMap, CypherQuery cypher) {
		WhereClause where = new WhereClause();
		if (condition != null) {
			where.fragment = buildWhereTree(condition, attrTypeMap, cypher, "n");
		}
		return where;
	}

	private String buildWhereTree(JSONObject condition, Map<String, String> attrTypeMap, CypherQuery cypher, String alias) {
		JSONArray ands = condition.getJSONArray("and");
		if (ands != null && !ands.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ands.size(); i++) {
				parts.add(buildWhereTree(ands.getJSONObject(i), attrTypeMap, cypher, alias));
			}
			return "(" + String.join(" and ", parts) + ")";
		}
		JSONArray ors = condition.getJSONArray("or");
		if (ors != null && !ors.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ors.size(); i++) {
				parts.add(buildWhereTree(ors.getJSONObject(i), attrTypeMap, cypher, alias));
			}
			return "(" + String.join(" or ", parts) + ")";
		}
		return buildWhereLeaf(condition, attrTypeMap, cypher, alias);
	}

	private String buildWhereLeaf(JSONObject condition, Map<String, String> attrTypeMap, CypherQuery cypher, String alias) {
		String field = condition.getString("field");
		String operator = condition.getString("operator");
		String type = attrTypeMap.get(field);
		String col = alias + "." + field;
		if ("is".equals(operator)) {
			return col + " is null";
		}
		if ("is not".equals(operator)) {
			return col + " is not null";
		}
		if ("between".equals(operator)) {
			JSONArray value = condition.getJSONArray("value");
			String low = cypher.next();
			String high = cypher.next();
			cypher.params.put(low, coerce(type, value.get(0)));
			cypher.params.put(high, coerce(type, value.get(1)));
			return "(" + col + " >= $" + low + " and " + col + " <= $" + high + ")";
		}
		if ("in".equals(operator)) {
			JSONArray value = condition.getJSONArray("value");
			String param = cypher.next();
			List<Object> list = new ArrayList<>();
			for (int i = 0; i < value.size(); i++) {
				list.add(coerce(type, value.get(i)));
			}
			cypher.params.put(param, list);
			return col + " in $" + param;
		}
		if ("like".equals(operator) || "not like".equals(operator)) {
			String value = (String) condition.get("value");
			String param = cypher.next();
			cypher.params.put(param, likeToRegex(value));
			String predicate = col + " =~ $" + param;
			return "not like".equals(operator) ? "not " + predicate : predicate;
		}
		String param = cypher.next();
		cypher.params.put(param, coerce(type, condition.get("value")));
		String cypherOperator = "!=".equals(operator) ? "<>" : operator;
		return col + " " + cypherOperator + " $" + param;
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		boolean inSandbox = inSandbox(namespace);

		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		Map<String, Object> relDef = (Map<String, Object>) relationship_rule.get(relationName);

		if (relDef != null && sourceClassDef != null && targetClassDef != null
				&& relDef.get("fromclass").equals(sourceClassName) && relDef.get("toclass").equals(targetClassName)) {
			String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
			String targetPk = DslUtil.getPrimaryKey(targetClassDef);
			String sourceInnerField = (String) relDef.get("fromField");
			String targetInnerField = (String) relDef.get("toField");

			String updateLabel = null;
			String setField = null;
			Object setValue = null;
			String idField = null;
			String idValue = null;
			if (sourcePk.equals(sourceInnerField)) {
				if (!targetPk.equals(targetInnerField)) {
					updateLabel = inSandbox ? namespace + targetClassName : targetClassName;
					setField = targetInnerField;
					setValue = sourceObjId;
					idField = targetPk;
					idValue = targetObjId;
				}
			} else {
				if (targetPk.equals(targetInnerField)) {
					updateLabel = inSandbox ? namespace + sourceClassName : sourceClassName;
					setField = sourceInnerField;
					setValue = targetObjId;
					idField = sourcePk;
					idValue = sourceObjId;
				}
			}
			if (updateLabel != null) {
				CypherQuery cypher = new CypherQuery();
				String idParam = cypher.next();
				String valParam = cypher.next();
				cypher.params.put(idParam, idValue);
				cypher.params.put(valParam, setValue);
				cypher.text = "match (n:`" + updateLabel + "`) where n." + idField + " = $" + idParam
						+ " set n." + setField + " = $" + valParam;
				executeWrite(cypher);
			}
		} else {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName
					+ "] have no relationship definition [" + relationName + "]");
		}
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		boolean inSandbox = inSandbox(namespace);

		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		Map<String, Object> relDef = (Map<String, Object>) relationship_rule.get(relationName);

		if (relDef != null && sourceClassDef != null && targetClassDef != null
				&& relDef.get("fromclass").equals(sourceClassName) && relDef.get("toclass").equals(targetClassName)) {
			String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
			String targetPk = DslUtil.getPrimaryKey(targetClassDef);
			String sourceInnerField = (String) relDef.get("fromField");
			String targetInnerField = (String) relDef.get("toField");

			String updateLabel = null;
			String setField = null;
			String idField = null;
			String idValue = null;
			if (sourcePk.equals(sourceInnerField)) {
				if (!targetPk.equals(targetInnerField)) {
					updateLabel = inSandbox ? namespace + targetClassName : targetClassName;
					setField = targetInnerField;
					idField = targetPk;
					idValue = targetObjId;
				}
			} else {
				if (targetPk.equals(targetInnerField)) {
					updateLabel = inSandbox ? namespace + sourceClassName : sourceClassName;
					setField = sourceInnerField;
					idField = sourcePk;
					idValue = sourceObjId;
				}
			}
			if (updateLabel != null) {
				CypherQuery cypher = new CypherQuery();
				String idParam = cypher.next();
				cypher.params.put(idParam, idValue);
				cypher.text = "match (n:`" + updateLabel + "`) where n." + idField + " = $" + idParam
						+ " set n." + setField + " = null";
				executeWrite(cypher);
			}
		} else {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName
					+ "] have no relationship definition [" + relationName + "]");
		}
	}

	private void executeWrite(CypherQuery cypher) throws Exception {
		withSession(session -> {
			log.info(cypher.text);
			session.run(cypher.text, cypher.params).consume();
			return null;
		});
	}

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String fullClassName = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		CypherQuery cypher = new CypherQuery();
		String idParam = cypher.next();
		cypher.params.put(idParam, objectId);
		cypher.text = "match (n:`" + fullClassName + "`) where n." + pk + " = $" + idParam
				+ " return n." + attrName + " as v";
		JSONArray rows = queryCypher(cypher);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + fullClassName + " does not exist");
		}
		return DslUtil.parseVectorAttr(rows.getJSONObject(0).get("v"));
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao,
			DataRagConfig dataRagConfig) throws Exception {
		boolean inSandbox = inSandbox(sandboxId);

		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs);

		JSONObject dataMap = new JSONObject();
		DslExecutionResult result;
		JSONObject data;
		if (inSandbox) {
			for (Map<String, Object> classDef : classDefs) {
				String className = sandboxId + ((String) classDef.get("className")).trim();
				classDef.put("className", className);
			}
			String sandboxDslStr = addSandboxId(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDslStr, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		}

		dataMap.putAll(data);
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

	private String addSandboxId(String dslStr, String sandboxId) {
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject dsl = dsls.getJSONObject(dslIndex);
			JSONObject answer = dsl == null ? null : dsl.getJSONObject("answer");
			JSONArray steps = answer == null ? null : answer.getJSONArray("steps");
			if (steps == null) {
				continue;
			}
			JSONObject step = steps.getJSONObject(0);
			JSONObject graph = step == null ? null : step.getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
			if (objects == null) {
				continue;
			}
			for (int objectIndex = 0; objectIndex < objects.size(); objectIndex++) {
				JSONObject object = objects.getJSONObject(objectIndex);
				if (object != null) {
					String fullClassName = sandboxId + object.getString("class").trim();
					object.put("class", fullClassName);
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}

}
