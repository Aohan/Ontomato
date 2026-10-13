package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * Proves the bounded join engine: a class larger than the in-memory cap is streamed (never
 * materialized) and a join whose intermediate exceeds the cap fails loudly instead of risking
 * an OOM. Runs against {@code ONTOMATO_TEST_ES_URL}; skipped when it is not set.
 *
 * <p>The cap is lowered through {@code ontomato.es.maxMaterialize} so a few hundred documents
 * exercise the streaming path.</p>
 */
class EsAdapterScaleTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_ES_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_ES_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_ES_PASSWORD");

	private static final String CAP = "ontomato.es.maxMaterialize";

	private static String url;
	private static String user;
	private static String password;

	private final String ns = "scale_" + System.nanoTime() + "_";

	@BeforeAll
	static void connect() {
		Assumptions.assumeTrue(EXTERNAL_URL != null,
				"ONTOMATO_TEST_ES_URL is not set; skipping the scale tests");
		url = EXTERNAL_URL;
		user = EXTERNAL_USER;
		password = EXTERNAL_PASSWORD;
	}

	@Test
	void streamingJoinBeyondTheBuildCapKeepsOnlyMatches() throws Exception {
		String previous = System.getProperty(CAP);
		System.setProperty(CAP, "100");
		try {
			seed(300, 5);
			List<JSONObject> rows = read(joinDsl());
			assertEquals(5, rows.size(), "only the 5 matching big rows survive the streamed join");
		} finally {
			restore(previous);
			cleanup();
		}
	}

	@Test
	void joinIntermediateBeyondTheCapFailsLoudly() throws Exception {
		String previous = System.getProperty(CAP);
		System.setProperty(CAP, "100");
		try {
			seed(300, 300); // every big row matches, so the joined set is 300 > cap
			assertThrows(IllegalStateException.class, () -> read(joinDsl()));
		} finally {
			restore(previous);
			cleanup();
		}
	}

	@Test
	void twoStepDslAggregatesOverStepZero() throws Exception {
		String previous = System.getProperty(CAP);
		System.setProperty(CAP, "100");
		try {
			seed(300, 5);
			List<JSONObject> rows = read(twoStepDsl());
			assertEquals(2, rows.size(), "one group per small_id in step0's rows");
			long total = rows.stream().mapToLong(row -> row.getLongValue("cnt")).sum();
			assertEquals(5, total, "the counts sum to the 5 matched rows");
		} finally {
			restore(previous);
			cleanup();
		}
	}

	@Test
	void streamingAggregationAvoidsTheIntermediateCap() throws Exception {
		String previous = System.getProperty(CAP);
		System.setProperty(CAP, "100");
		try {
			// The same 300 joined rows that make a plain join fail (test 2) are fine here: aggregation
			// streams into per-group accumulators instead of materializing the joined set.
			seed(300, 300);
			List<JSONObject> rows = read(aggregateOverJoinDsl());
			assertEquals(2, rows.size(), "one group per small_id");
			long total = rows.stream().mapToLong(row -> row.getLongValue("cnt")).sum();
			assertEquals(300, total, "every joined row was counted");
		} finally {
			restore(previous);
			cleanup();
		}
	}

	// ----------------------------------------------------------------------------------

	private void seed(int bigRows, int matchingRows) throws Exception {
		EsAdapter seeder = adapter(seedRule());
		seeder.createClass(ns, classDef("big"));
		seeder.createClass(ns, classDef("small"));
		seeder.insertObjects(ns, classDef("small"), JSONArray.of(small("s1", "one"), small("s2", "two")));
		JSONArray bigs = new JSONArray();
		for (int i = 0; i < bigRows; i++) {
			bigs.add(big("b" + i, i < matchingRows ? (i % 2 == 0 ? "s1" : "s2") : "nope"));
		}
		seeder.insertObjects(ns, classDef("big"), bigs);
	}

	private List<JSONObject> read(String dsl) throws Exception {
		EsAdapter adapter = adapter(readRule());
		JSONArray answers = JSONArray.parseArray(adapter.executeDsl(dsl, "scale", null, new java.util.ArrayList<>()));
		return answers.getJSONObject(0).getJSONArray("answer").toJavaList(JSONObject.class);
	}

	private void cleanup() {
		try {
			EsAdapter adapter = adapter(seedRule());
			adapter.dropNamespace(ns);
		} catch (Exception ignored) {
			// best effort
		}
	}

	private void restore(String previous) {
		if (previous == null) {
			System.clearProperty(CAP);
		} else {
			System.setProperty(CAP, previous);
		}
	}

	private EsAdapter adapter(JSONObject rule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		connection.setUser(user);
		connection.setPassword(password);
		return new EsAdapter(connection, rule, EsDialect.ELASTICSEARCH);
	}

	private JSONObject seedRule() {
		return rule(false);
	}

	private JSONObject readRule() {
		return rule(true);
	}

	private JSONObject rule(boolean prefixed) {
		JSONObject rule = new JSONObject();
		rule.put("classDef", JSONArray.of(classDef(prefixed ? ns + "big" : "big"),
				classDef(prefixed ? ns + "small" : "small")));
		JSONObject belongs = new JSONObject();
		belongs.put("fromclass", "big");
		belongs.put("toclass", "small");
		belongs.put("fromField", "small_id");
		belongs.put("toField", "id");
		JSONObject relationships = new JSONObject();
		relationships.put("belongs", belongs);
		rule.put("relationship_rule", relationships);
		return rule;
	}

	private JSONObject classDef(String className) {
		JSONObject classDef = new JSONObject();
		classDef.put("className", className);
		if (className.endsWith("small")) {
			classDef.put("attrs", JSONArray.of(attr("id", true), attr("label", false)));
		} else {
			classDef.put("attrs", JSONArray.of(attr("id", true), attr("name", false), attr("small_id", false)));
		}
		return classDef;
	}

	private JSONObject attr(String name, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", "varchar");
		attr.put("primaryKey", primaryKey);
		attr.put("enable", true);
		return attr;
	}

	private JSONObject small(String id, String label) {
		JSONObject object = new JSONObject();
		object.put("id", id);
		object.put("label", label);
		return object;
	}

	private JSONObject big(String id, String smallId) {
		JSONObject object = new JSONObject();
		object.put("id", id);
		object.put("name", id);
		object.put("small_id", smallId);
		return object;
	}

	private String joinDsl() {
		return JSONArray.of(oneStepAnswer(joinStep())).toJSONString();
	}

	/** Step 0 = the graph pattern and a plain projection; step 1 = group by + count over step 0. */
	private String twoStepDsl() {
		JSONObject answer = new JSONObject();
		answer.put("steps", JSONArray.of(joinStep("small_id", "small_id"), aggregateStep()));
		JSONObject dsl = new JSONObject();
		dsl.put("answer", answer);
		return JSONArray.of(dsl).toJSONString();
	}

	private JSONObject oneStepAnswer(JSONObject step) {
		JSONObject answer = new JSONObject();
		answer.put("steps", JSONArray.of(step));
		JSONObject dsl = new JSONObject();
		dsl.put("answer", answer);
		return dsl;
	}

	private JSONObject aggregateStep() {
		JSONObject tmp = new JSONObject();
		tmp.put("class", ns + "tmp");
		tmp.put("variable", "tmp");
		tmp.put("idx", 0);
		JSONObject pattern = new JSONObject();
		pattern.put("objects", JSONArray.of(tmp));
		JSONObject graph = new JSONObject();
		graph.put("patterns", JSONArray.of(pattern));
		JSONObject sid = new JSONObject();
		sid.put("variable", "tmp");
		sid.put("field", "small_id");
		sid.put("as", "sid");
		JSONObject cnt = new JSONObject();
		cnt.put("variable", "tmp");
		cnt.put("field", "small_id");
		cnt.put("as", "cnt");
		cnt.put("function", "count");
		JSONObject groupField = new JSONObject();
		groupField.put("variable", "tmp");
		groupField.put("field", "small_id");
		JSONObject groupBy = new JSONObject();
		groupBy.put("fields", JSONArray.of(groupField));
		JSONObject output = new JSONObject();
		output.put("fields", JSONArray.of(sid, cnt));
		output.put("group_by", groupBy);
		JSONObject step = new JSONObject();
		step.put("graph", graph);
		step.put("output", output);
		return step;
	}

	/** One step: join big ⋈ small, then group by small.id with a count. */
	private String aggregateOverJoinDsl() {
		JSONObject step = joinStep("id", "big_id");
		JSONObject sid = new JSONObject();
		sid.put("variable", "s");
		sid.put("field", "id");
		sid.put("as", "sid");
		JSONObject cnt = new JSONObject();
		cnt.put("variable", "s");
		cnt.put("field", "id");
		cnt.put("as", "cnt");
		cnt.put("function", "count");
		JSONObject groupField = new JSONObject();
		groupField.put("variable", "s");
		groupField.put("field", "id");
		JSONObject groupBy = new JSONObject();
		groupBy.put("fields", JSONArray.of(groupField));
		JSONObject output = new JSONObject();
		output.put("fields", JSONArray.of(sid, cnt));
		output.put("group_by", groupBy);
		step.put("output", output);
		return JSONArray.of(oneStepAnswer(step)).toJSONString();
	}

	private JSONObject joinStep() {
		return joinStep("id", "big_id");
	}

	private JSONObject joinStep(String fieldName, String as) {
		JSONObject bigObject = new JSONObject();
		bigObject.put("class", ns + "big");
		bigObject.put("variable", "b");
		bigObject.put("idx", 0);
		JSONObject smallObject = new JSONObject();
		smallObject.put("class", ns + "small");
		smallObject.put("variable", "s");
		smallObject.put("idx", 1);
		JSONObject relation = new JSONObject();
		relation.put("from", 0);
		relation.put("to", 1);
		relation.put("type", JSONArray.of("belongs"));
		JSONObject pattern = new JSONObject();
		pattern.put("objects", JSONArray.of(bigObject, smallObject));
		pattern.put("relationship", JSONArray.of(relation));
		JSONObject graph = new JSONObject();
		graph.put("patterns", JSONArray.of(pattern));
		JSONObject field = new JSONObject();
		field.put("variable", "b");
		field.put("field", fieldName);
		field.put("as", as);
		JSONObject output = new JSONObject();
		output.put("fields", JSONArray.of(field));
		JSONObject step = new JSONObject();
		step.put("graph", graph);
		step.put("output", output);
		return step;
	}
}
