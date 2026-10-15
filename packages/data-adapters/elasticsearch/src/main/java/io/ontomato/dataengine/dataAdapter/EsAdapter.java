package io.ontomato.dataengine.dataAdapter;

import java.io.IOException;
import java.sql.Connection;
import java.util.concurrent.TimeUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

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
 * Elasticsearch / OpenSearch data adapter.
 *
 * <p>The engine has no JDBC connection and no cross-index join operator. This adapter therefore
 * translates the object-graph DSL itself: single-class reads push down to the query DSL, and a
 * cross-class join is executed here with bounded operators — a term semi-join pushdown, a hash
 * join with a bounded build side, or a streaming sort-merge — never by materializing an
 * unbounded result. Object CRUD mirrors the relational adapters one class (index) at a time.</p>
 */
@Slf4j
public class EsAdapter implements DataAdapter {

	/** Preferred size of a hash build side; a larger class is streamed instead of materialized. */
	static final int BUILD_SIZE = 1000;
	/** Engine cap on a single terms clause. */
	static final int MAX_TERMS = 65536;
	/** Page size for streaming reads. */
	static final int PAGE = 1000;
	/** Default in-memory intermediate cap: beyond it the query fails loudly instead of risking an OOM. */
	static final long DEFAULT_MAX_MATERIALIZE = 100_000;

	private static final Set<String> SUPPORTED_TYPES = Set.of(
			"varchar", "text", "int", "long", "double", "date", "timestamp", "vector");

	private final DataAdapterConnection connection;
	private final Map<String, Object> jsonRule;
	private final EsDialect dialect;
	private final long maxMaterialize;
	private final int maxTerms;
	private final Map<String, Map<String, String>> fieldCaps = new HashMap<>();
	private EsHttp http;

	public EsAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule, EsDialect dialect) {
		this.connection = connection;
		this.jsonRule = jsonRule == null ? new HashMap<>() : jsonRule;
		this.dialect = dialect;
		this.maxMaterialize = Long.getLong("ontomato.es.maxMaterialize", DEFAULT_MAX_MATERIALIZE);
		this.maxTerms = Long.getLong("ontomato.es.maxTerms", MAX_TERMS).intValue();
	}

	private EsHttp http() {
		if (http == null) {
			http = new EsHttp(connection);
		}
		return http;
	}

	// ----------------------------------------------------------------------------------
	// Connection (non-JDBC)
	// ----------------------------------------------------------------------------------

	@Override
	public Connection openConnection() {
		throw new UnsupportedOperationException(dialect.label() + " is not a JDBC data source");
	}

	@Override
	public JSONObject testConnection() throws Exception {
		return new DataAdapterConnectionTester().test(() -> {
			long startNanos = System.nanoTime();
			try (EsHttp probeHttp = new EsHttp(connection)) {
				JSONObject info = probeHttp.get("/", null);
				JSONObject version = info.getJSONObject("version");
				String databaseVersion = version == null ? null : version.getString("number");
				String clusterName = info.getString("cluster_name");

				JSONArray catIndices = probeHttp.getArray("/_cat/indices/*", Map.of(
						"format", "json",
						"h", "index",
						"expand_wildcards", "open"));
				List<String> indices = new ArrayList<>();
				for (int i = 0; i < catIndices.size(); i++) {
					JSONObject item = catIndices.getJSONObject(i);
					String indexName = item == null ? null : item.getString("index");
					if (indexName == null || indexName.isBlank()) {
						throw new IOException(dialect.label() + " index listing returned a row without an index name");
					}
					indices.add(indexName);
				}
				indices.sort(String::compareTo);

				JSONObject report = new JSONObject();
				report.put("kind", "search");
				report.put("elapsedMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos));
				report.put("databaseProduct", dialect.label());
				report.put("databaseVersion", databaseVersion);
				report.put("clusterName", clusterName);
				report.put("indices", indices);
				return report;
			}
		});
	}

	// ----------------------------------------------------------------------------------
	// Statement / sample data / validation
	// ----------------------------------------------------------------------------------

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			JSONObject body = new JSONObject();
			body.put("size", 1);
			JSONArray source = new JSONArray();
			attrs.forEach(source::add);
			body.put("_source", source);
			JSONObject response = http().post("/" + EsNaming.sanitize(className) + "/_search", body);
			JSONArray hits = response.getJSONObject("hits").getJSONArray("hits");
			if (hits != null && !hits.isEmpty()) {
				JSONObject datum = hits.getJSONObject(0).getJSONObject("_source");
				for (String key : new ArrayList<>(datum.keySet())) {
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
	public void validateClassNameFormat(String className) {
	}

	@Override
	public void validatePrimaryKeyName(String attrName) {
	}

	// ----------------------------------------------------------------------------------
	// Namespace lifecycle
	// ----------------------------------------------------------------------------------

	@Override
	public void createNamespace(String namespace) {
		// Indices are created per class; a namespace is only an index-name prefix.
	}

	@Override
	public void truncateNamespace(String namespace) {
			try {
				for (String index : indicesOf(namespace)) {
					JSONObject body = new JSONObject();
					body.put("query", matchAll());
					http().post("/" + index + "/_delete_by_query", body, Map.of("refresh", "true"));
				}
			} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void dropNamespace(String namespace) {
		try {
			for (String index : indicesOf(namespace)) {
				http().delete("/" + index);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	/** Every non-system index whose name starts with the namespace; a blank namespace matches all. */
	private List<String> indicesOf(String namespace) throws Exception {
		String pattern = namespace == null || namespace.isBlank() ? "*" : namespace + "*";
		JSONArray rows = http().getArray("/_cat/indices/" + pattern, Map.of("format", "json", "h", "index"));
		List<String> indices = new ArrayList<>();
		for (int i = 0; i < rows.size(); i++) {
			String index = rows.getJSONObject(i).getString("index");
			if (index != null && !index.startsWith(".")) {
				indices.add(index);
			}
		}
		return indices;
	}

	// ----------------------------------------------------------------------------------
	// Schema
	// ----------------------------------------------------------------------------------

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		try {
			String index = EsNaming.indexName(namespace, (String) classDef.get("className"));
			JSONObject properties = new JSONObject();
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
			if (attrs != null) {
				for (Map<String, Object> attr : attrs) {
					if (attr.get("enable") == null || (Boolean) attr.get("enable")) {
						String name = (String) attr.get("name");
						String type = (String) attr.get("type");
						if (name != null && isSupportedType(type)) {
							properties.put(name, mappingOf(type));
						}
					}
				}
			}
			JSONObject body = new JSONObject();
			JSONObject mappings = new JSONObject();
			mappings.put("properties", properties);
			body.put("mappings", mappings);
			try {
				http().put("/" + index, body);
			} catch (Exception e) {
				if (!String.valueOf(e.getMessage()).contains("resource_already_exists_exception")) {
					throw e;
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
		// Edges are foreign-key fields; there is no separate type to create.
	}

	private JSONObject mappingOf(String type) {
		JSONObject mapping = new JSONObject();
		switch (type) {
			case "varchar" -> mapping.put("type", "keyword");
			case "text", "vector" -> mapping.put("type", "text");
			case "int" -> mapping.put("type", "integer");
			case "long" -> mapping.put("type", "long");
			case "double" -> mapping.put("type", "double");
			case "date" -> {
				mapping.put("type", "date");
				mapping.put("format", "yyyy-MM-dd");
			}
			case "timestamp" -> {
				mapping.put("type", "date");
				mapping.put("format", "yyyy-MM-dd HH:mm:ss");
			}
			default -> mapping.put("type", "keyword");
		}
		return mapping;
	}

	private boolean isSupportedType(String type) {
		return type != null && SUPPORTED_TYPES.contains(type);
	}

	// ----------------------------------------------------------------------------------
	// Object CRUD
	// ----------------------------------------------------------------------------------

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		String className = (String) classDef.get("className");
		String index = EsNaming.indexName(namespace, className);
		Map<String, String> attrTypes = attrTypes(classDef);
		String pk = DslUtil.getPrimaryKey(classDef);
		if (pk == null) {
			throw new Exception("The insert statement must contain the primary key field");
		}

		StringBuilder bulk = new StringBuilder();
		for (int i = 0; i < objs.size(); i++) {
			JSONObject obj = objs.getJSONObject(i);
			if (obj.get(pk) == null || obj.getString(pk) == null || obj.getString(pk).trim().isEmpty()) {
				throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
			}
			String id = obj.getString(pk);
			JSONObject doc = new JSONObject();
			for (Map.Entry<String, String> attr : attrTypes.entrySet()) {
				Object value = obj.get(attr.getKey());
				if (value != null) {
					doc.put(attr.getKey(), normalizeForWrite(attr.getValue(), value));
				}
			}
			JSONObject action = new JSONObject();
			JSONObject meta = new JSONObject();
			meta.put("_index", index);
			meta.put("_id", id);
			action.put("index", meta);
			bulk.append(action.toJSONString()).append('\n').append(doc.toJSONString()).append('\n');
		}
		if (bulk.length() > 0) {
			http().request("POST", "/_bulk", bulk.toString(), Map.of("refresh", "true"));
		}
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		String className = (String) classDef.get("className");
		String index = EsNaming.indexName(namespace, className);
		Map<String, String> attrTypes = attrTypes(classDef);
		String pk = DslUtil.getPrimaryKey(classDef);

		StringBuilder script = new StringBuilder();
		JSONObject params = new JSONObject();
		int n = 0;
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			String type = attrTypes.get(key);
			if (type == null) {
				throw new Exception("Field [" + key + "] does not exist");
			}
			Object raw = setValues.get(key);
			if (raw == null) {
				// JSON omits null map values, so a null cannot ride in as a script parameter.
				script.append("ctx._source['").append(key).append("'] = null; ");
			} else {
				String param = "v" + n++;
				script.append("ctx._source['").append(key).append("'] = params.").append(param).append("; ");
				params.put(param, normalizeForWrite(type, raw));
			}
		}
		JSONObject body = new JSONObject();
		body.put("query", buildWhereQuery(where, attrTypes, index));
		JSONObject scriptObj = new JSONObject();
		scriptObj.put("lang", "painless");
		scriptObj.put("source", script.toString());
		scriptObj.put("params", params);
		body.put("script", scriptObj);
		http().post("/" + index + "/_update_by_query", body, Map.of("refresh", "true"));
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		String className = (String) classDef.get("className");
		String index = EsNaming.indexName(namespace, className);
		Map<String, String> attrTypes = attrTypes(classDef);
		String whereStr = generateWhereSql(where);
		JSONObject body = new JSONObject();
		body.put("query", whereStr.isBlank() ? matchAll() : buildWhereQuery(where, attrTypes, index));
		http().post("/" + index + "/_delete_by_query", body, Map.of("refresh", "true"));
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		applyEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, true);
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		applyEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, false);
	}

	/** Mirrors the relational four-branch foreign-key maintenance, one document update at a time. */
	private void applyEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId, boolean connect) throws Exception {
		Map<String, Object> sourceClassDef = classDefOf(sourceClassName);
		Map<String, Object> targetClassDef = classDefOf(targetClassName);
		Map<String, Object> relDef = relationshipRule().get(relationName) instanceof Map<?, ?> map
				? castMap(map) : null;
		if (relDef == null || sourceClassDef == null || targetClassDef == null
				|| !sourceClassName.equals(relDef.get("fromclass")) || !targetClassName.equals(relDef.get("toclass"))) {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName
					+ "] have no relationship definition [" + relationName + "]");
		}
		String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
		String targetPk = DslUtil.getPrimaryKey(targetClassDef);
		String sourceInnerField = (String) relDef.get("fromField");
		String targetInnerField = (String) relDef.get("toField");

		if (sourcePk.equals(sourceInnerField)) {
			if (!targetPk.equals(targetInnerField)) {
				String index = EsNaming.indexName(namespace, (String) targetClassDef.get("className"));
				setFieldByPk(index, targetPk, targetObjId, targetInnerField, connect ? sourceObjId : null);
			}
		} else if (targetPk.equals(targetInnerField)) {
			String index = EsNaming.indexName(namespace, (String) sourceClassDef.get("className"));
			setFieldByPk(index, sourcePk, sourceObjId, sourceInnerField, connect ? targetObjId : null);
		}
	}

	private void setFieldByPk(String index, String pk, String pkValue, String field, Object value) throws Exception {
		JSONObject body = new JSONObject();
		JSONObject term = new JSONObject();
		term.put(pk, pkValue);
		JSONObject query = new JSONObject();
		query.put("term", term);
		body.put("query", query);
		JSONObject scriptObj = new JSONObject();
		scriptObj.put("lang", "painless");
		if (value == null) {
			// JSON omits null map values, so a null cannot ride in as a script parameter.
			scriptObj.put("source", "ctx._source['" + field + "'] = null;");
		} else {
			scriptObj.put("source", "ctx._source['" + field + "'] = params.v;");
			JSONObject params = new JSONObject();
			params.put("v", value);
			scriptObj.put("params", params);
		}
		body.put("script", scriptObj);
		http().post("/" + index + "/_update_by_query", body, Map.of("refresh", "true"));
	}

	// ----------------------------------------------------------------------------------
	// Vector attribute
	// ----------------------------------------------------------------------------------

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String index = EsNaming.indexName(null, (String) classDef.get("className"));
		JSONObject response = http().get("/" + index + "/_doc/" + objectId, null);
		if (response.getBooleanValue("found") == false) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + index + " does not exist");
		}
		return DslUtil.parseVectorAttr(response.getJSONObject("_source").get(attrName));
	}

	// ----------------------------------------------------------------------------------
	// Object-graph query (mirrors the relational adapters)
	// ----------------------------------------------------------------------------------

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao,
			DataRagConfig dataRagConfig) throws Exception {
		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs, timeConditionsAsEpochMillis(), timeConditionZone());
		JSONObject dataMap = new JSONObject();
		DslExecutionResult result;
		if (sandboxId != null && !sandboxId.trim().isEmpty()) {
			for (Map<String, Object> classDef : classDefs) {
				classDef.put("className", sandboxId + ((String) classDef.get("className")).trim());
			}
			String sandboxDsl = addSandboxId(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDsl, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
		}
		dataMap.putAll(result.data());
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

	private String addSandboxId(String dslStr, String sandboxId) {
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject steps = dsls.getJSONObject(dslIndex).getJSONObject("answer");
			JSONArray stepList = steps == null ? null : steps.getJSONArray("steps");
			if (stepList == null) {
				continue;
			}
			JSONObject graph = stepList.getJSONObject(0).getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
			if (objects == null) {
				continue;
			}
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				if (object != null) {
					object.put("class", sandboxId + object.getString("class").trim());
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}

	// ----------------------------------------------------------------------------------
	// Read path: DSL -> rows
	// ----------------------------------------------------------------------------------

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls)
			throws Exception {
		log.info("[" + sessionId + "] DSL to query " + dialect.label() + ": " + queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		JSONObject dsl = dsls.getJSONObject(0);
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		DslRowLimit.Tracker rowLimit = new DslRowLimit.Tracker();
		List<JSONObject> rows = steps.size() <= 1
				? executeStep(steps.getJSONObject(0), generatedMqls, rowLimit, true)
				: executeTwoStep(steps.getJSONObject(0), steps.getJSONObject(1), generatedMqls, rowLimit);
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", JSONArray.of(rows.toArray()));
		answer.put("mqls", generatedMqls);
		if (rowLimit.truncated()) {
			answer.put(DslRowLimit.TRUNCATED, true);
			answer.put(DslRowLimit.ROW_LIMIT, rowLimit.effectiveLimit());
			answer.put(DslRowLimit.TRUNCATION_HINT, DslRowLimit.truncationHint(rowLimit.effectiveLimit()));
			log.warn("[" + sessionId + "] DSL result truncated at the default row limit of "
					+ rowLimit.effectiveLimit());
		}
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	/**
	 * Two-step DSL: step 0 is the graph pattern and its projection; step 1 aggregates / sorts / limits
	 * over step 0's result. The engine has no cross-query temporary relation, so the adapter wraps each
	 * step 0 row as the object of step 1's first variable and runs step 1 in memory — the relational
	 * {@code select ... from (subquery) as tmp} shape.
	 */
	private List<JSONObject> executeTwoStep(JSONObject first, JSONObject second, List<String> generatedMqls,
			DslRowLimit.Tracker rowLimit) throws Exception {
		List<JSONObject> firstRows = executeStep(first, generatedMqls, rowLimit, false);
		JSONArray secondObjects = second.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
				.getJSONArray("objects");
		String tmpAlias = secondObjects.getJSONObject(0).getString("variable");
		List<Map<String, JSONObject>> rows = new ArrayList<>();
		for (JSONObject row : firstRows) {
			Map<String, JSONObject> wrapped = new LinkedHashMap<>();
			wrapped.put(tmpAlias, row);
			rows.add(wrapped);
		}
		if (generatedMqls != null) {
			generatedMqls.add("TWO-STEP " + tmpAlias + " rows=" + rows.size());
		}
		return project(rows, second.getJSONObject("output"), rowLimit, true);
	}

	/** One step: join the graph's objects, then project / aggregate / sort / limit. */
	private List<JSONObject> executeStep(JSONObject step, List<String> generatedMqls, DslRowLimit.Tracker rowLimit,
			boolean terminal) throws Exception {
		JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
		JSONArray objects = pattern.getJSONArray("objects");
		JSONArray relationships = pattern.getJSONArray("relationship");

		Map<String, Map<String, String>> attrTypesByClass = new HashMap<>();
		Map<String, Set<String>> enabledAttrsByClass = new HashMap<>();
		for (Map<String, Object> classDef : classDefs()) {
			String index = EsNaming.sanitize((String) classDef.get("className"));
			Map<String, String> types = new HashMap<>();
			Set<String> enabled = new HashSet<>();
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
			if (attrs != null) {
				for (Map<String, Object> attr : attrs) {
					String name = (String) attr.get("name");
					types.put(name, (String) attr.get("type"));
					if (attr.get("enable") == null || (Boolean) attr.get("enable")) {
						enabled.add(name);
					}
				}
			}
			attrTypesByClass.put(index, types);
			enabledAttrsByClass.put(index, enabled);
		}

		Map<Integer, JSONObject> byIdx = new LinkedHashMap<>();
		for (int i = 0; i < objects.size(); i++) {
			byIdx.put(objects.getJSONObject(i).getInteger("idx"), objects.getJSONObject(i));
		}

		// Leaf filters and cardinalities.
		Map<Integer, JSONObject> filters = new LinkedHashMap<>();
		Map<Integer, Long> counts = new LinkedHashMap<>();
		Map<Integer, List<JSONObject>> fetched = new LinkedHashMap<>();
		for (Map.Entry<Integer, JSONObject> e : byIdx.entrySet()) {
			JSONObject obj = e.getValue();
			String index = EsNaming.sanitize(obj.getString("class"));
			JSONObject query = objectQuery(obj, attrTypesByClass, enabledAttrsByClass);
			filters.put(e.getKey(), query);
			counts.put(e.getKey(), count(index, query));
		}

		// Edges, resolved to the two ends and their join fields.
		List<Edge> edges = new ArrayList<>();
		if (relationships != null) {
			for (int i = 0; i < relationships.size(); i++) {
				JSONObject rel = relationships.getJSONObject(i);
				String relName = rel.getJSONArray("type").getString(0).trim();
				Map<String, Object> relDef = relationshipRule().get(relName) instanceof Map<?, ?> m ? castMap(m) : null;
				if (relDef == null) {
					continue;
				}
				edges.add(new Edge(rel.getInteger("from"), rel.getInteger("to"),
						(String) relDef.get("fromField"), (String) relDef.get("toField")));
			}
		}

		// Early termination: with no sort, no aggregation and no distinct, only the first `limit` rows matter.
		JSONObject output = step.getJSONObject("output");
		long stopAfter = earlyStopCount(output);

		// Connected components over the edge endpoints.
		List<Set<Integer>> components = components(byIdx.keySet(), edges);
		if (isAggregated(output) && components.size() == 1) {
			// Stream joined rows straight into the accumulators: memory stays proportional to the number
			// of groups, not to the number of joined rows.
			AggregatingSink sink = new AggregatingSink(output);
			joinComponent(components.get(0), byIdx, edges, filters, counts, generatedMqls, stopAfter, sink);
			List<JSONObject> grouped = sink.finish(output);
			sort(grouped, output.getJSONObject("sort"));
			return limit(grouped, output.getJSONObject("limit"), rowLimit, terminal);
		}
		List<Map<String, JSONObject>> rows = null;
		for (Set<Integer> component : components) {
			List<Map<String, JSONObject>> componentRows = joinComponent(component, byIdx, edges, filters, counts,
					generatedMqls, stopAfter, null);
			rows = rows == null ? componentRows : cross(rows, componentRows);
		}
		if (rows == null) {
			rows = new ArrayList<>();
		}
		return project(rows, output, rowLimit, terminal);
	}

	private boolean isAggregated(JSONObject output) {
		if (output.getJSONObject("group_by") != null) {
			return true;
		}
		JSONArray fields = output.getJSONArray("fields");
		for (int i = 0; i < fields.size(); i++) {
			String function = fields.getJSONObject(i).getString("function");
			if (function != null && !function.isBlank()) {
				return true;
			}
		}
		return false;
	}

	private List<Map<String, JSONObject>> joinComponent(Set<Integer> component, Map<Integer, JSONObject> byIdx,
			List<Edge> edges, Map<Integer, JSONObject> filters, Map<Integer, Long> counts, List<String> generatedMqls,
			long stopAfter, RowSink sink) throws Exception {
		List<Edge> componentEdges = new ArrayList<>();
		for (Edge edge : edges) {
			if (component.contains(edge.from) && component.contains(edge.to)) {
				componentEdges.add(edge);
			}
		}

		// Greedy order: start at the smallest filtered class, then add the cheapest connected one.
		Set<Integer> inSet = new LinkedHashSet<>();
		List<Integer> order = new ArrayList<>();
		Integer root = component.stream().min((a, b) -> Long.compare(counts.get(a), counts.get(b))).orElseThrow();
		inSet.add(root);
		order.add(root);
		while (inSet.size() < component.size()) {
			Integer best = null;
			long bestCount = Long.MAX_VALUE;
			for (Edge edge : componentEdges) {
				Integer other = null;
				if (inSet.contains(edge.from) && !inSet.contains(edge.to)) {
					other = edge.to;
				} else if (inSet.contains(edge.to) && !inSet.contains(edge.from)) {
					other = edge.from;
				}
				if (other != null && counts.get(other) < bestCount) {
					bestCount = counts.get(other);
					best = other;
				}
			}
			if (best == null) {
				break;
			}
			inSet.add(best);
			order.add(best);
		}

		Integer last = order.get(order.size() - 1);
		List<Map<String, JSONObject>> rows = null;
		for (Integer idx : order) {
			JSONObject obj = byIdx.get(idx);
			String alias = obj.getString("variable");
			String index = EsNaming.sanitize(obj.getString("class"));
			JSONObject query = filters.get(idx);
			long estimate = counts.getOrDefault(idx, 0L);
			boolean emit = sink != null && idx.equals(last);
			if (rows == null) {
				if (estimate > maxMaterialize) {
					throw budgetError(index, estimate, maxMaterialize);
				}
				List<JSONObject> docs = searchAll(index, query, generatedMqls, maxMaterialize);
				if (emit) {
					for (JSONObject doc : docs) {
						Map<String, JSONObject> row = new LinkedHashMap<>();
						row.put(alias, doc);
						sink.accept(row);
					}
					return null;
				}
				rows = new ArrayList<>();
				for (JSONObject doc : docs) {
					Map<String, JSONObject> row = new LinkedHashMap<>();
					row.put(alias, doc);
					rows.add(row);
				}
			} else {
				Edge edge = edgeConnecting(idx, inSet, componentEdges);
				if (edge == null) {
					continue; // disconnected object inside a component: skipped, mirrors the relational FROM
				}
				boolean newIsTo = edge.to.equals(idx);
				String existingAlias = byIdx.get(newIsTo ? edge.from : edge.to).getString("variable");
				String existingKey = newIsTo ? edge.fromField : edge.toField;
				String newKey = newIsTo ? edge.toField : edge.fromField;
				if (estimate <= maxMaterialize) {
					List<JSONObject> docs = searchAll(index, query, generatedMqls, maxMaterialize);
					if (emit) {
						hashJoinTo(rows, existingAlias, existingKey, docs, alias, newKey, sink);
						return null;
					}
					rows = hashJoin(rows, existingAlias, existingKey, docs, alias, newKey);
				} else {
					// Too large to materialize: stream it, probing the bounded build side. When the build keys
					// fit one terms clause, push them down so the engine returns only the matching documents.
					JSONArray buildKeys = distinctKeys(rows, existingAlias, existingKey);
					JSONArray push = buildKeys.size() <= maxTerms ? buildKeys : null;
					if (emit) {
						streamJoinTo(rows, existingAlias, existingKey, index, query, alias, newKey, generatedMqls, push, sink);
						return null;
					}
					rows = streamJoin(rows, existingAlias, existingKey, index, query, alias, newKey, generatedMqls, stopAfter, push);
				}
			}
			if (rows.size() > maxMaterialize) {
				throw budgetError("joined intermediate", rows.size(), maxMaterialize);
			}
		}
		return rows == null ? new ArrayList<>() : rows;
	}

	/** The number of rows the first `limit` needs when neither ordering, aggregation nor distinct applies. */
	private long earlyStopCount(JSONObject output) {
		JSONObject sort = output.getJSONObject("sort");
		JSONObject groupBy = output.getJSONObject("group_by");
		JSONArray fields = output.getJSONArray("fields");
		JSONObject limit = output.getJSONObject("limit");
		if (sort != null || groupBy != null || limit == null || limit.getInteger("count") == null) {
			return -1;
		}
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			if ((field.getString("function") != null && !field.getString("function").isBlank())
					|| Boolean.TRUE.equals(field.getBoolean("distinct"))) {
				return -1;
			}
		}
		return limit.getInteger("count");
	}

	private void streamJoinTo(List<Map<String, JSONObject>> rows, String existingAlias, String existingKey,
			String index, JSONObject query, String newAlias, String newKey, List<String> generatedMqls,
			JSONArray buildKeys, RowSink sink) throws Exception {
		Map<String, List<Map<String, JSONObject>>> build = new HashMap<>();
		for (Map<String, JSONObject> row : rows) {
			JSONObject existing = row.get(existingAlias);
			if (existing != null) {
				build.computeIfAbsent(keyOf(existing.get(existingKey)), k -> new ArrayList<>()).add(row);
			}
		}
		JSONObject effectiveQuery = query;
		if (buildKeys != null && !buildKeys.isEmpty()) {
			JSONObject terms = new JSONObject();
			terms.put(exactField(index, newKey), buildKeys);
			JSONObject bool = new JSONObject();
			bool.put("must", JSONArray.of(query, new JSONObject(Map.of("terms", terms))));
			effectiveQuery = new JSONObject(Map.of("bool", bool));
			if (generatedMqls != null) {
				generatedMqls.add("TERMS pushdown /" + index + " keys=" + buildKeys.size());
			}
		}
		String pit = openPit(index);
		try {
			JSONArray searchAfter = null;
			while (true) {
				PageResult page = searchPage(index, pit, effectiveQuery, searchAfter);
				pit = page.pitId();
				JSONArray hits = page.hits();
				if (hits.isEmpty()) {
					break;
				}
				for (int i = 0; i < hits.size(); i++) {
					JSONObject hit = hits.getJSONObject(i);
					JSONObject doc = hit.getJSONObject("_source");
					List<Map<String, JSONObject>> matches = build.get(keyOf(doc.get(newKey)));
					if (matches != null) {
						for (Map<String, JSONObject> match : matches) {
							Map<String, JSONObject> joined = new LinkedHashMap<>(match);
							joined.put(newAlias, doc);
							sink.accept(joined);
						}
					}
					searchAfter = hit.getJSONArray("sort");
				}
				if (hits.size() < PAGE || searchAfter == null) {
					break;
				}
			}
		} finally {
			closePit(pit);
		}
	}

	/** Distinct keys of the build side, in encounter order; the input to a terms pushdown. */
	private JSONArray distinctKeys(List<Map<String, JSONObject>> rows, String alias, String keyField) {
		Set<String> keys = new LinkedHashSet<>();
		for (Map<String, JSONObject> row : rows) {
			JSONObject object = row.get(alias);
			if (object != null && object.get(keyField) != null) {
				keys.add(keyOf(object.get(keyField)));
			}
		}
		JSONArray array = new JSONArray();
		keys.forEach(array::add);
		return array;
	}

	private IllegalStateException budgetError(String what, long size, long cap) {
		return new IllegalStateException(dialect.label() + " graph query too large: " + what + " needs " + size
				+ " rows in memory, above the " + cap + " cap. Add filters or narrow the join; streaming/spill beyond this cap is not enabled.");
	}

	/**
	 * Probe a bounded build side while streaming a large index page by page (PIT + search_after):
	 * the large side is never materialized, so the join stays memory-bounded.
	 */
	private List<Map<String, JSONObject>> streamJoin(List<Map<String, JSONObject>> rows, String existingAlias,
			String existingKey, String index, JSONObject query, String newAlias, String newKey,
			List<String> generatedMqls, long stopAfter, JSONArray buildKeys) throws Exception {
		Map<String, List<Map<String, JSONObject>>> build = new HashMap<>();
		for (Map<String, JSONObject> row : rows) {
			JSONObject existing = row.get(existingAlias);
			if (existing != null) {
				build.computeIfAbsent(keyOf(existing.get(existingKey)), k -> new ArrayList<>()).add(row);
			}
		}
		JSONObject effectiveQuery = query;
		if (buildKeys != null && !buildKeys.isEmpty()) {
			JSONObject terms = new JSONObject();
			terms.put(exactField(index, newKey), buildKeys);
			JSONObject bool = new JSONObject();
			bool.put("must", JSONArray.of(query, new JSONObject(Map.of("terms", terms))));
			effectiveQuery = new JSONObject(Map.of("bool", bool));
			if (generatedMqls != null) {
				generatedMqls.add("TERMS pushdown /" + index + " keys=" + buildKeys.size());
			}
		}
		List<Map<String, JSONObject>> out = new ArrayList<>();
		if (generatedMqls != null) {
			generatedMqls.add("STREAM /" + index + " (PIT) probing build=" + rows.size());
		}
		String pit = openPit(index);
		try {
			JSONArray searchAfter = null;
			while (true) {
				PageResult page = searchPage(index, pit, effectiveQuery, searchAfter);
				pit = page.pitId();
				JSONArray hits = page.hits();
				if (hits.isEmpty()) {
					break;
				}
				for (int i = 0; i < hits.size(); i++) {
					JSONObject hit = hits.getJSONObject(i);
					JSONObject doc = hit.getJSONObject("_source");
					List<Map<String, JSONObject>> matches = build.get(keyOf(doc.get(newKey)));
					if (matches != null) {
						for (Map<String, JSONObject> match : matches) {
							Map<String, JSONObject> joined = new LinkedHashMap<>(match);
							joined.put(newAlias, doc);
							out.add(joined);
							if (stopAfter > 0 && out.size() >= stopAfter) {
								return out;
							}
						}
					}
					searchAfter = hit.getJSONArray("sort");
				}
				if (hits.size() < PAGE || searchAfter == null) {
					break;
				}
			}
		} finally {
			closePit(pit);
		}
		return out;
	}

	private Edge edgeConnecting(Integer idx, Set<Integer> inSet, List<Edge> edges) {
		for (Edge edge : edges) {
			if (edge.from.equals(idx) && inSet.contains(edge.to) && !edge.to.equals(idx)) {
				return edge;
			}
			if (edge.to.equals(idx) && inSet.contains(edge.from) && !edge.from.equals(idx)) {
				return edge;
			}
		}
		return null;
	}

	private List<Map<String, JSONObject>> hashJoin(List<Map<String, JSONObject>> rows, String existingAlias,
			String existingKey, List<JSONObject> newDocs, String newAlias, String newKey) {
		Map<String, List<JSONObject>> build = new HashMap<>();
		for (JSONObject doc : newDocs) {
			build.computeIfAbsent(keyOf(doc.get(newKey)), k -> new ArrayList<>()).add(doc);
		}
		List<Map<String, JSONObject>> out = new ArrayList<>();
		for (Map<String, JSONObject> row : rows) {
			JSONObject existing = row.get(existingAlias);
			if (existing == null) {
				continue;
			}
			List<JSONObject> matches = build.get(keyOf(existing.get(existingKey)));
			if (matches == null) {
				continue;
			}
			for (JSONObject match : matches) {
				Map<String, JSONObject> joined = new LinkedHashMap<>(row);
				joined.put(newAlias, match);
				out.add(joined);
			}
		}
		return out;
	}

	private void hashJoinTo(List<Map<String, JSONObject>> rows, String existingAlias, String existingKey,
			List<JSONObject> newDocs, String newAlias, String newKey, RowSink sink) {
		Map<String, List<JSONObject>> build = new HashMap<>();
		for (JSONObject doc : newDocs) {
			build.computeIfAbsent(keyOf(doc.get(newKey)), k -> new ArrayList<>()).add(doc);
		}
		for (Map<String, JSONObject> row : rows) {
			JSONObject existing = row.get(existingAlias);
			if (existing == null) {
				continue;
			}
			List<JSONObject> matches = build.get(keyOf(existing.get(existingKey)));
			if (matches == null) {
				continue;
			}
			for (JSONObject match : matches) {
				Map<String, JSONObject> joined = new LinkedHashMap<>(row);
				joined.put(newAlias, match);
				sink.accept(joined);
			}
		}
	}

	private List<Map<String, JSONObject>> cross(List<Map<String, JSONObject>> left, List<Map<String, JSONObject>> right) {
		List<Map<String, JSONObject>> out = new ArrayList<>();
		for (Map<String, JSONObject> l : left) {
			for (Map<String, JSONObject> r : right) {
				Map<String, JSONObject> row = new LinkedHashMap<>(l);
				row.putAll(r);
				out.add(row);
			}
		}
		return out;
	}

	private List<Set<Integer>> components(Set<Integer> ids, List<Edge> edges) {
		Map<Integer, Integer> parent = new HashMap<>();
		for (Integer id : ids) {
			parent.put(id, id);
		}
		for (Edge edge : edges) {
			union(parent, edge.from, edge.to);
		}
		Map<Integer, Set<Integer>> groups = new LinkedHashMap<>();
		for (Integer id : ids) {
			groups.computeIfAbsent(find(parent, id), k -> new LinkedHashSet<>()).add(id);
		}
		return new ArrayList<>(groups.values());
	}

	private int find(Map<Integer, Integer> parent, int x) {
		while (parent.get(x) != x) {
			parent.put(x, parent.get(parent.get(x)));
			x = parent.get(x);
		}
		return x;
	}

	private void union(Map<Integer, Integer> parent, int a, int b) {
		parent.put(find(parent, a), find(parent, b));
	}

	// ----------------------------------------------------------------------------------
	// Projection / aggregation / sort / limit
	// ----------------------------------------------------------------------------------

	/** Consumes joined rows one at a time; the aggregation path never materializes them. */
	private interface RowSink {
		void accept(Map<String, JSONObject> row);
	}

	/** A single running accumulator for one aggregate output column. */
	private final class Acc {
		private final String fn;
		private final boolean distinct;
		private final Set<String> seen = new HashSet<>();
		private long count;
		private double sum;
		private Object min;
		private Object max;

		Acc(String fn, boolean distinct) {
			this.fn = fn.toLowerCase(Locale.ROOT);
			this.distinct = distinct;
		}

		void add(Object value) {
			if (value == null) {
				return;
			}
			if (distinct && !seen.add(String.valueOf(value))) {
				return;
			}
			count++;
			if (value instanceof Number number) {
				sum += number.doubleValue();
			}
			if (min == null || compare(value, min) < 0) {
				min = value;
			}
			if (max == null || compare(value, max) > 0) {
				max = value;
			}
		}

		Object value() {
			return switch (fn) {
				case "count" -> count;
				case "sum" -> sum;
				case "avg" -> count == 0 ? null : sum / count;
				case "min" -> min;
				case "max" -> max;
				default -> null;
			};
		}
	}

	/** One group's state: a representative value per plain column and an accumulator per aggregate. */
	private final class Group {
		private final Map<String, Object> plain = new LinkedHashMap<>();
		private final Map<String, Acc> accs = new LinkedHashMap<>();

		void accept(Map<String, JSONObject> row, JSONArray fields) {
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				String function = field.getString("function");
				if (function != null && !function.isBlank()) {
					accs.computeIfAbsent(sig(field),
							k -> new Acc(function, Boolean.TRUE.equals(field.getBoolean("distinct")))).add(value(row, field));
				} else {
					plain.putIfAbsent(field.getString("as"), value(row, field));
				}
			}
		}

		JSONObject project(JSONArray fields) {
			JSONObject out = new JSONObject();
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				String function = field.getString("function");
				if (function != null && !function.isBlank()) {
					Acc acc = accs.get(sig(field));
					out.put(field.getString("as"), acc == null ? null : acc.value());
				} else {
					out.put(field.getString("as"), plain.get(field.getString("as")));
				}
			}
			return out;
		}

		boolean havingMatches(JSONArray having) {
			for (int i = 0; i < having.size(); i++) {
				JSONObject cond = having.getJSONObject(i);
				Acc acc = accs.get(sig(cond));
				int c = compare(acc == null ? null : acc.value(), cond.get("value"));
				String operator = cond.getString("operator");
				boolean ok = switch (operator) {
					case ">" -> c > 0;
					case ">=" -> c >= 0;
					case "<" -> c < 0;
					case "<=" -> c <= 0;
					case "!=" -> c != 0;
					default -> c == 0;
				};
				if (!ok) {
					return false;
				}
			}
			return true;
		}
	}

	/** Accumulates groups as joined rows stream in; finish() yields one row per group. */
	private final class AggregatingSink implements RowSink {
		private final JSONArray fields;
		private final JSONArray groupFields;
		private final Map<String, Group> groups = new LinkedHashMap<>();

		AggregatingSink(JSONObject output) {
			this.fields = output.getJSONArray("fields");
			JSONObject groupBy = output.getJSONObject("group_by");
			this.groupFields = groupBy == null ? null : groupBy.getJSONArray("fields");
		}

		@Override
		public void accept(Map<String, JSONObject> row) {
			StringBuilder key = new StringBuilder();
			if (groupFields != null) {
				for (int i = 0; i < groupFields.size(); i++) {
					key.append(String.valueOf(value(row, groupFields.getJSONObject(i)))).append('\u0001');
				}
			}
			groups.computeIfAbsent(key.toString(), k -> new Group()).accept(row, fields);
		}

		List<JSONObject> finish(JSONObject output) {
			JSONArray having = output.getJSONObject("group_by") == null ? null
					: output.getJSONObject("group_by").getJSONArray("having");
			List<JSONObject> result = new ArrayList<>();
			for (Group group : groups.values()) {
				if (having != null && !group.havingMatches(having)) {
					continue;
				}
				result.add(group.project(fields));
			}
			return result;
		}
	}

	/** Stable key of an aggregate column, so projection and having share one accumulator. */
	private String sig(JSONObject field) {
		return String.valueOf(field.getString("variable")) + '\u0002' + field.getString("field") + '\u0002'
				+ field.getString("function") + '\u0002' + Boolean.TRUE.equals(field.getBoolean("distinct"));
	}

	private List<JSONObject> project(List<Map<String, JSONObject>> rows, JSONObject output,
			DslRowLimit.Tracker rowLimit, boolean terminal) {
		JSONArray fields = output.getJSONArray("fields");
		JSONObject groupBy = output.getJSONObject("group_by");
		boolean aggregate = groupBy != null;
		for (int i = 0; i < fields.size(); i++) {
			if (fields.getJSONObject(i).getString("function") != null && !fields.getJSONObject(i).getString("function").isBlank()) {
				aggregate = true;
			}
		}

		List<JSONObject> result = new ArrayList<>();
		if (!aggregate) {
			boolean distinct = false;
			for (int i = 0; i < fields.size(); i++) {
				if (Boolean.TRUE.equals(fields.getJSONObject(i).getBoolean("distinct"))) {
					distinct = true;
				}
			}
			Set<String> seen = new LinkedHashSet<>();
			for (Map<String, JSONObject> row : rows) {
				JSONObject projected = new JSONObject();
				for (int i = 0; i < fields.size(); i++) {
					JSONObject field = fields.getJSONObject(i);
					projected.put(field.getString("as"), value(row, field));
				}
				if (distinct && !seen.add(projected.toJSONString())) {
					continue;
				}
				result.add(projected);
			}
		} else {
			JSONArray groupFields = groupBy == null ? null : groupBy.getJSONArray("fields");
			Map<String, List<Map<String, JSONObject>>> groups = new LinkedHashMap<>();
			if (groupFields != null && !groupFields.isEmpty()) {
				for (Map<String, JSONObject> row : rows) {
					StringBuilder key = new StringBuilder();
					for (int i = 0; i < groupFields.size(); i++) {
						JSONObject groupField = groupFields.getJSONObject(i);
						key.append(String.valueOf(value(row, groupField))).append('\u0001');
					}
					groups.computeIfAbsent(key.toString(), k -> new ArrayList<>()).add(row);
				}
			} else {
				groups.put("", rows);
			}
			JSONArray having = groupBy == null ? null : groupBy.getJSONArray("having");
			for (List<Map<String, JSONObject>> group : groups.values()) {
				if (having != null && !havingMatches(having, group)) {
					continue;
				}
				JSONObject projected = new JSONObject();
				for (int i = 0; i < fields.size(); i++) {
					JSONObject field = fields.getJSONObject(i);
					if (field.getString("function") != null && !field.getString("function").isBlank()) {
						projected.put(field.getString("as"), aggregate(field, group));
					} else {
						projected.put(field.getString("as"), value(group.get(0), field));
					}
				}
				result.add(projected);
			}
		}

		sort(result, output.getJSONObject("sort"));
		return limit(result, output.getJSONObject("limit"), rowLimit, terminal);
	}

	private Object value(Map<String, JSONObject> row, JSONObject field) {
		JSONObject object = row.get(field.getString("variable"));
		return object == null ? null : object.get(field.getString("field"));
	}

	private Object aggregate(JSONObject field, List<Map<String, JSONObject>> group) {
		String function = field.getString("function").toLowerCase(Locale.ROOT);
		List<Object> values = new ArrayList<>();
		Set<String> distinct = new LinkedHashSet<>();
		for (Map<String, JSONObject> row : group) {
			Object value = value(row, field);
			if (value == null) {
				continue;
			}
			if (Boolean.TRUE.equals(field.getBoolean("distinct"))) {
				if (distinct.add(String.valueOf(value))) {
					values.add(value);
				}
			} else {
				values.add(value);
			}
		}
		switch (function) {
			case "count":
				return (long) values.size();
			case "sum": {
				double sum = 0;
				for (Object value : values) {
					sum += ((Number) value).doubleValue();
				}
				return sum;
			}
			case "avg": {
				if (values.isEmpty()) {
					return null;
				}
				double sum = 0;
				for (Object value : values) {
					sum += ((Number) value).doubleValue();
				}
				return sum / values.size();
			}
			case "min": {
				Object min = null;
				for (Object value : values) {
					if (min == null || compare(value, min) < 0) {
						min = value;
					}
				}
				return min;
			}
			case "max": {
				Object max = null;
				for (Object value : values) {
					if (max == null || compare(value, max) > 0) {
						max = value;
					}
				}
				return max;
			}
			default:
				return null;
		}
	}

	private boolean havingMatches(JSONArray having, List<Map<String, JSONObject>> group) {
		for (int i = 0; i < having.size(); i++) {
			JSONObject cond = having.getJSONObject(i);
			Object actual = aggregate(cond, group);
			Object expected = cond.get("value");
			int c = compare(actual, expected);
			String operator = cond.getString("operator");
			boolean ok = switch (operator) {
				case ">" -> c > 0;
				case ">=" -> c >= 0;
				case "<" -> c < 0;
				case "<=" -> c <= 0;
				case "!=" -> c != 0;
				default -> c == 0;
			};
			if (!ok) {
				return false;
			}
		}
		return true;
	}

	@SuppressWarnings("unchecked")
	private int compare(Object a, Object b) {
		if (a instanceof Number na && b instanceof Number nb) {
			return Double.compare(na.doubleValue(), nb.doubleValue());
		}
		return String.valueOf(a).compareTo(String.valueOf(b));
	}

	private void sort(List<JSONObject> rows, JSONObject sort) {
		if (sort == null || sort.getJSONArray("fields") == null || sort.getJSONArray("fields").isEmpty()) {
			return;
		}
		JSONArray fields = sort.getJSONArray("fields");
		rows.sort((a, b) -> {
			for (int i = 0; i < fields.size(); i++) {
				JSONObject order = fields.getJSONObject(i);
				int c = compare(a.get(order.getString("field")), b.get(order.getString("field")));
				if (c != 0) {
					return "desc".equalsIgnoreCase(order.getString("order")) ? -c : c;
				}
			}
			return 0;
		});
	}

	private List<JSONObject> limit(List<JSONObject> rows, JSONObject limit, DslRowLimit.Tracker rowLimit,
			boolean terminal) {
		boolean defaulted = limit == null || limit.getInteger("count") == null;
		if (defaulted && !terminal) {
			// A non-terminal step's rows are an internal working set, bounded by maxMaterialize rather
			// than by the caller-facing cap; capping it here would silently truncate what the next step
			// aggregates over.
			return rows;
		}
		int count = defaulted ? DslRowLimit.defaultRowLimit() : limit.getInteger("count");
		int offset = defaulted || limit.getInteger("offset") == null ? 0 : limit.getInteger("offset");
		if (terminal) {
			rowLimit.terminalLimit(count, defaulted);
		}
		if (offset >= rows.size()) {
			return new ArrayList<>();
		}
		int end = Math.min(rows.size(), offset + count);
		if (terminal && defaulted && rows.size() > end) {
			rowLimit.markTruncated();
		}
		return new ArrayList<>(rows.subList(offset, end));
	}

	// ----------------------------------------------------------------------------------
	// Query building
	// ----------------------------------------------------------------------------------

	private JSONObject objectQuery(JSONObject object, Map<String, Map<String, String>> attrTypesByClass,
			Map<String, Set<String>> enabledAttrsByClass) {
		String index = EsNaming.sanitize(object.getString("class"));
		Map<String, String> attrTypes = attrTypesByClass.getOrDefault(index, new HashMap<>());
		Set<String> enabled = enabledAttrsByClass.getOrDefault(index, new HashSet<>());
		JSONObject conditions = object.getJSONObject("conditions");
		List<JSONObject> clauses = new ArrayList<>();
		if (conditions != null) {
			if (conditions.getJSONObject("timeseries") != null) {
				throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
						"conditions.timeseries",
						"the timeseries condition is not implemented by " + getClass().getSimpleName());
			}
			JSONObject properties = conditions.getJSONObject("properties");
			if (properties != null) {
				JSONObject clause = propertyQuery(properties, attrTypes, true, index);
				if (clause != null) {
					clauses.add(clause);
				}
			}
			JSONObject text = conditions.getJSONObject("text");
			if (text != null && text.getString("query") != null && !text.getString("query").trim().isEmpty()) {
				JSONArray should = new JSONArray();
				String query = text.getString("query").trim();
				for (String attr : enabled) {
					String type = attrTypes.get(attr);
					if ("text".equals(type)) {
						JSONObject match = new JSONObject();
						match.put(attr, query);
						should.add(new JSONObject(Map.of("match", match)));
					} else if ("varchar".equals(type)) {
						JSONObject wildcard = new JSONObject();
						JSONObject inner = new JSONObject();
						inner.put("value", "*" + query + "*");
						inner.put("case_insensitive", true);
						wildcard.put(exactField(index, attr), inner);
						should.add(new JSONObject(Map.of("wildcard", wildcard)));
					}
				}
				if (!should.isEmpty()) {
					JSONObject bool = new JSONObject();
					bool.put("should", should);
					bool.put("minimum_should_match", 1);
					clauses.add(new JSONObject(Map.of("bool", bool)));
				}
			}
		}
		if (clauses.isEmpty()) {
			return matchAll();
		}
		if (clauses.size() == 1) {
			return clauses.get(0);
		}
		JSONObject bool = new JSONObject();
		bool.put("must", JSONArray.of(clauses.toArray()));
		return new JSONObject(Map.of("bool", bool));
	}

	private JSONObject propertyQuery(JSONObject cond, Map<String, String> attrTypes, boolean readPath, String index) {
		if (cond.getJSONArray("and") != null && !cond.getJSONArray("and").isEmpty()) {
			JSONArray must = new JSONArray();
			for (int i = 0; i < cond.getJSONArray("and").size(); i++) {
				JSONObject part = propertyQuery(cond.getJSONArray("and").getJSONObject(i), attrTypes, readPath, index);
				if (part != null) {
					must.add(part);
				}
			}
			return new JSONObject(Map.of("bool", new JSONObject(Map.of("must", must))));
		}
		if (cond.getJSONArray("or") != null && !cond.getJSONArray("or").isEmpty()) {
			JSONArray should = new JSONArray();
			for (int i = 0; i < cond.getJSONArray("or").size(); i++) {
				JSONObject part = propertyQuery(cond.getJSONArray("or").getJSONObject(i), attrTypes, readPath, index);
				if (part != null) {
					should.add(part);
				}
			}
			JSONObject bool = new JSONObject();
			bool.put("should", should);
			bool.put("minimum_should_match", 1);
			return new JSONObject(Map.of("bool", bool));
		}
		if (cond.getJSONArray("not") != null && !cond.getJSONArray("not").isEmpty()) {
			JSONObject negated = propertyQuery(DslGrammarValidator.negated(cond), attrTypes, readPath, index);
			return new JSONObject(Map.of("bool", new JSONObject(Map.of("must_not", JSONArray.of(negated)))));
		}
		return conditionQuery(cond, attrTypes, readPath, index);
	}

	private JSONObject conditionQuery(JSONObject cond, Map<String, String> attrTypes, boolean readPath, String index) {
		String field = cond.getString("field");
		if (field == null) {
			throw new DslContractViolationException(
					DslContractViolationException.Code.INVALID_GRAMMAR,
					"conditions.properties",
					"a condition has no 'field' property");
		}
		String type = attrTypes.get(field);
		String exact = exactField(index, field);
		String operator = cond.getString("operator");
		if (operator == null) {
			operator = "";
		}
		switch (operator) {
			case "=", "!=": {
				Object value = cond.get("value");
				JSONObject query = termLikeQuery(exact, type, value);
				if (query == null) {
					throw new DslContractViolationException(
							DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
							"conditions.properties",
							"operator '" + operator + "' on field '" + field + "' is not supported by "
									+ getClass().getSimpleName());
				}
				if ("!=".equals(operator)) {
					return new JSONObject(Map.of("bool", new JSONObject(Map.of("must_not", JSONArray.of(query)))));
				}
				return query;
			}
			case ">", ">=", "<", "<=": {
				Object value = cond.get("value");
				String op = switch (operator) {
					case ">" -> "gt";
					case ">=" -> "gte";
					case "<" -> "lt";
					default -> "lte";
				};
				JSONObject range = new JSONObject();
				range.put(op, value);
				return new JSONObject(Map.of("range", new JSONObject(Map.of(exact, range))));
			}
			case "between": {
				JSONArray value = cond.getJSONArray("value");
				JSONObject range = new JSONObject();
				range.put("gte", value.get(0));
				range.put("lte", value.get(1));
				return new JSONObject(Map.of("range", new JSONObject(Map.of(exact, range))));
			}
			case "in": {
				JSONArray value = cond.getJSONArray("value");
				JSONArray values = new JSONArray();
				for (int i = 0; i < value.size(); i++) {
					values.add(value.get(i));
				}
				return new JSONObject(Map.of("terms", new JSONObject(Map.of(exact, values))));
			}
			case "like", "not like": {
				String pattern = wildcardPattern(String.valueOf(cond.get("value")), readPath);
				JSONObject wildcard = new JSONObject();
				JSONObject inner = new JSONObject();
				inner.put("value", pattern);
				inner.put("case_insensitive", true);
				wildcard.put(exact, inner);
				JSONObject query = new JSONObject(Map.of("wildcard", wildcard));
				if ("not like".equals(operator)) {
					return new JSONObject(Map.of("bool", new JSONObject(Map.of("must_not", JSONArray.of(query)))));
				}
				return query;
			}
			case "is", "is not": {
				JSONObject exists = new JSONObject(Map.of("field", field));
				JSONObject query = new JSONObject(Map.of("exists", exists));
				// "is" means IS NULL, "is not" means IS NOT NULL (mirrors the relational buildWhere).
				if ("is".equals(operator)) {
					return new JSONObject(Map.of("bool", new JSONObject(Map.of("must_not", JSONArray.of(query)))));
				}
				return query;
			}
			default:
				throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
						"conditions.properties",
						"operator '" + operator + "' on field '" + field + "' is not supported by "
								+ getClass().getSimpleName());
		}
	}

	private JSONObject termLikeQuery(String field, String type, Object value) {
		if ("text".equals(type)) {
			JSONObject match = new JSONObject();
			match.put(field, value);
			return new JSONObject(Map.of("match_phrase", match));
		}
		JSONObject term = new JSONObject();
		term.put(field, value);
		return new JSONObject(Map.of("term", term));
	}

	private String wildcardPattern(String raw, boolean readPath) {
		String pattern = raw == null ? "" : raw;
		if (readPath && !pattern.startsWith("%") && !pattern.endsWith("%")) {
			pattern = "%" + pattern + "%";
		}
		return pattern.replace("%", "*").replace("_", "?");
	}

	// ----------------------------------------------------------------------------------
	// Write-path where (mirrors the relational buildWhere)
	// ----------------------------------------------------------------------------------

	private JSONObject buildWhereQuery(JSONObject condition, Map<String, String> attrTypes, String index) {
		if (condition == null || condition.isEmpty()) {
			return matchAll();
		}
		JSONObject part = propertyQuery(condition, attrTypes, false, index);
		return part == null ? matchAll() : part;
	}

	private String generateWhereSql(JSONObject condition) {
		return condition == null || condition.isEmpty() ? "" : condition.toJSONString();
	}

	// ----------------------------------------------------------------------------------
	// Engine helpers
	// ----------------------------------------------------------------------------------

	/** Field name -> engine type from _field_caps (including .keyword subfields); empty when the probe fails. */
	private Map<String, String> fieldCaps(String index) {
		return fieldCaps.computeIfAbsent(index, idx -> {
			Map<String, String> types = new HashMap<>();
			try {
				JSONObject response = http().get("/" + idx + "/_field_caps", Map.of("fields", "*"));
				JSONObject fields = response.getJSONObject("fields");
				if (fields != null) {
					for (String name : fields.keySet()) {
						JSONObject byType = fields.getJSONObject(name);
						for (String type : byType.keySet()) {
							types.put(name, type);
							break;
						}
					}
				}
			} catch (Exception e) {
				log.warn("_field_caps failed for {}: {}", idx, e.getMessage());
			}
			return types;
		});
	}

	/**
	 * The physical field for exact match / terms / range: the field itself when it is a keyword,
	 * otherwise its .keyword subfield when the index exposes one (typical dynamic mapping).
	 */
	private String exactField(String index, String field) {
		Map<String, String> types = fieldCaps(index);
		if (types.isEmpty() || "keyword".equals(types.get(field))) {
			return field;
		}
		if ("keyword".equals(types.get(field + ".keyword"))) {
			return field + ".keyword";
		}
		return field;
	}

	/** Approximate number of distinct values of a field (HyperLogLog++); used to size a join. */
	private long cardinality(String index, String field, JSONObject query) throws Exception {
		JSONObject cardinality = new JSONObject();
		cardinality.put("field", exactField(index, field));
		JSONObject agg = new JSONObject();
		agg.put("cardinality", cardinality);
		JSONObject aggs = new JSONObject();
		aggs.put("distinct_keys", agg);
		JSONObject body = new JSONObject();
		body.put("size", 0);
		body.put("query", query);
		body.put("aggs", aggs);
		JSONObject response = http().post("/" + index + "/_search", body);
		return response.getJSONObject("aggregations").getJSONObject("distinct_keys").getLongValue("value");
	}

	private JSONObject matchAll() {
		JSONObject matchAll = new JSONObject();
		matchAll.put("match_all", new JSONObject());
		return matchAll;
	}

	private long count(String index, JSONObject query) throws Exception {
		JSONObject body = new JSONObject();
		body.put("query", query);
		JSONObject response = http().post("/" + index + "/_count", body);
		return response.getLongValue("count");
	}

	private record PageResult(String pitId, JSONArray hits) {}

	/** Every matching document's _source, capped and streamed through PIT + search_after so deep reads never use from/size. */
	private List<JSONObject> searchAll(String index, JSONObject query, List<String> generatedMqls, long cap) throws Exception {
		List<JSONObject> rows = new ArrayList<>();
		if (generatedMqls != null) {
			generatedMqls.add("PIT /" + index + " cap=" + cap);
		}
		String pit = openPit(index);
		try {
			JSONArray searchAfter = null;
			while (rows.size() < cap) {
				PageResult page = searchPage(index, pit, query, searchAfter);
				pit = page.pitId();
				JSONArray hits = page.hits();
				if (hits.isEmpty()) {
					break;
				}
				for (int i = 0; i < hits.size() && rows.size() < cap; i++) {
					JSONObject hit = hits.getJSONObject(i);
					rows.add(hit.getJSONObject("_source"));
					searchAfter = hit.getJSONArray("sort");
				}
				if (hits.size() < PAGE || searchAfter == null) {
					break;
				}
			}
		} finally {
			closePit(pit);
		}
		return rows;
	}

	private String openPit(String index) throws Exception {
		JSONObject response = http().post(dialect.openPitPath(index), null, Map.of("keep_alive", "2m"));
		String id = dialect.parsePitId(response);
		if (id == null || id.isBlank()) {
			throw new IOException("Failed to obtain point-in-time ID from " + dialect.label());
		}
		return id;
	}

	/** Best-effort cleanup; a PIT that cannot be closed must not fail an already successful query. */
	private void closePit(String id) {
		try {
			http().request("DELETE", dialect.closePitPath(), dialect.closePitBody(id), null);
		} catch (Exception e) {
			log.debug("closing PIT failed: {}", e.getMessage());
		}
	}

	private PageResult searchPage(String index, String pit, JSONObject query, JSONArray searchAfter) throws Exception {
		JSONObject body = new JSONObject();
		body.put("size", PAGE);
		body.put("query", query);
		body.put("sort", dialect.pitSort(openSearchSortField(index)));
		if (searchAfter != null) {
			body.put("search_after", searchAfter);
		}
		body.put("pit", new JSONObject(Map.of("id", pit, "keep_alive", "2m")));
		JSONObject response = http().post("/_search", body);
		// Elasticsearch may return a new pit_id per page; OpenSearch answers without one, so the
		// current ID stays valid for the next page and for the final close.
		String nextPit = response.getString("pit_id");
		if (nextPit == null || nextPit.isBlank()) {
			nextPit = pit;
		}
		JSONObject hitsObj = response.getJSONObject("hits");
		if (hitsObj == null) {
			throw new IOException(dialect.label() + " search response has no hits object: " + response);
		}
		JSONArray hits = hitsObj.getJSONArray("hits");
		if (hits == null) {
			throw new IOException(dialect.label() + " search response has no hits array: " + response);
		}
		return new PageResult(nextPit, hits);
	}

	/**
	 * The field OpenSearch pages by. Elasticsearch's {@code _shard_doc} needs none; OpenSearch has no
	 * shard-document tiebreaker before 3.3, so it sorts by the class primary key, which must be a
	 * sortable keyword field. The class is resolved through the physical index, because EsNaming may
	 * change the class name's case and characters.
	 */
	private String openSearchSortField(String index) throws Exception {
		if (dialect != EsDialect.OPENSEARCH) {
			return null;
		}
		Map<String, Object> classDef = classDefOfIndex(index);
		if (classDef == null) {
			throw new IOException("No object class maps to index [" + index + "]");
		}
		String field = exactField(index, DslUtil.getPrimaryKey(classDef));
		if (!"keyword".equals(fieldCaps(index).get(field))) {
			throw new IOException("The primary key field [" + field + "] of index [" + index
					+ "] is not a sortable keyword field, so OpenSearch cannot page it");
		}
		return field;
	}

	// ----------------------------------------------------------------------------------
	// Metadata / value helpers
	// ----------------------------------------------------------------------------------

	@SuppressWarnings("unchecked")
	private List<Map<String, Object>> classDefs() {
		Object classDefs = jsonRule.get("classDef");
		return classDefs instanceof List<?> list ? (List<Map<String, Object>>) list : new ArrayList<>();
	}

	@SuppressWarnings("unchecked")
	private Map<String, Object> relationshipRule() {
		Object rule = jsonRule.get("relationship_rule");
		return rule instanceof Map<?, ?> map ? (Map<String, Object>) map : new HashMap<>();
	}

	private Map<String, Object> classDefOf(String className) {
		for (Map<String, Object> classDef : classDefs()) {
			if (className.equals(classDef.get("className"))) {
				return classDef;
			}
		}
		return null;
	}

	/** The class whose physical index is `index`; compared after EsNaming normalization, not by raw class name. */
	private Map<String, Object> classDefOfIndex(String index) {
		for (Map<String, Object> classDef : classDefs()) {
			if (index.equals(EsNaming.sanitize((String) classDef.get("className")))) {
				return classDef;
			}
		}
		return null;
	}

	private Map<String, String> attrTypes(Map<String, Object> classDef) {
		Map<String, String> types = new LinkedHashMap<>();
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
		if (attrs != null) {
			for (Map<String, Object> attr : attrs) {
				if (attr.get("enable") == null || (Boolean) attr.get("enable")) {
					if (isSupportedType((String) attr.get("type"))) {
						types.put((String) attr.get("name"), (String) attr.get("type"));
					}
				}
			}
		}
		return types;
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> castMap(Map<?, ?> map) {
		return (Map<String, Object>) map;
	}

	/** A vector value is serialized; everything else (dates/timestamps included) is written verbatim. */
	private Object normalizeForWrite(String type, Object value) {
		if (value == null) {
			return null;
		}
		if ("vector".equals(type) && !(value instanceof String)) {
			return JSON.toJSONString(value);
		}
		return value;
	}


	private static String keyOf(Object value) {
		return value == null ? null : String.valueOf(value);
	}

	// ----------------------------------------------------------------------------------
	// Sandbox naming
	// ----------------------------------------------------------------------------------

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		return EsNaming.indexName(sandboxId, className);
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	/** One relationship, resolved to its two ends and their key fields. */
	private record Edge(Integer from, Integer to, String fromField, String toField) {
	}
}
