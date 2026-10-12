package io.ontomato.dataengine.dataAdapter.test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.DataAdapter;

/**
 * The shared contract suite every data adapter test extends.
 *
 * <p>Each concrete test supplies a fresh adapter, the capabilities that adapter actually
 * supports, and a unique namespace (table prefix / sandbox id) so the tables it creates
 * never collide with leftovers. Every test method is gated on a capability: a read-only
 * SQL adapter silently skips the write-path tests, a full object-graph adapter runs them all.</p>
 *
 * <p>The suite is environment-agnostic on purpose: {@link #newAdapter()} decides where the
 * database comes from (a Testcontainers container, an external URL from an env var, or an
 * embedded file), and the base class never asks.</p>
 */
public abstract class AbstractDataAdapterTest {

	// ----------------------------------------------------------------------------------
	// Abstract contract (each concrete adapter test implements)
	// ----------------------------------------------------------------------------------

	/** A fresh adapter wired to this test's database and the given jsonRule (may be null). */
	protected abstract DataAdapter newAdapter(JSONObject jsonRule);

	/** A fresh adapter with no jsonRule, for write-only tests. */
	protected DataAdapter newAdapter() {
		return newAdapter(null);
	}

	/** The operations this adapter implements; everything else is skipped. */
	protected abstract Set<DataAdapterCapability> capabilities();

	/** A unique namespace/table-prefix for this test run (never collides with leftovers). */
	protected abstract String namespace();

	/**
	 * The class definition used by the write-path tests. It must carry one primary-key
	 * attribute and at least one attribute of every supported scalar type so the
	 * type/condition tests have real columns to exercise.
	 */
	protected abstract JSONObject classDef();

	/** The objects inserted by the object-CRUD tests. */
	protected abstract JSONArray testObjects();

	/** The primary-key attribute name of {@link #classDef()}. */
	protected String primaryKey() {
		return "id";
	}

	// ----------------------------------------------------------------------------------
	// Graph fixtures (3 classes + 2 edges) for the read-path and edge tests.
	// ----------------------------------------------------------------------------------

	/** The plain class definitions of the three graph classes, in order: source, middle, target. */
	protected abstract java.util.List<JSONObject> graphClassDefs();

	/** The relationship rule map: relation name -> {fromclass, toclass, fromField, toField}. */
	protected abstract JSONObject relationshipRule();

	/** Seed objects per plain class name, with the join fields already populated. */
	protected abstract java.util.Map<String, JSONArray> graphSeed();

	/** The plain class name at index {@code i} of {@link #graphClassDefs()}. */
	protected String graphClass(int i) {
		return graphClassDefs().get(i).getString("className");
	}

	/** The first relation name in {@link #relationshipRule()}. */
	protected String firstRelation() {
		return relationshipRule().keySet().iterator().next();
	}

	/** The second relation name in {@link #relationshipRule()}. */
	protected String secondRelation() {
		java.util.Iterator<String> it = relationshipRule().keySet().iterator();
		it.next();
		return it.next();
	}

	/** A jsonRule with plain class names (what createEdge/deleteEdge look up by). */
	protected JSONObject graphRule() {
		JSONObject rule = new JSONObject();
		rule.put("classDef", new JSONArray(graphClassDefs()));
		rule.put("relationship_rule", relationshipRule());
		return rule;
	}

	/** A jsonRule whose classDef class names carry the namespace prefix (what the read path resolves). */
	protected JSONObject prefixedGraphRule() {
		JSONArray classDefs = new JSONArray();
		for (JSONObject classDef : graphClassDefs()) {
			JSONObject copy = new JSONObject();
			for (String key : classDef.keySet()) {
				if ("className".equals(key)) {
					copy.put(key, namespace() + classDef.getString(key));
				} else {
					copy.put(key, classDef.get(key));
				}
			}
			classDefs.add(copy);
		}
		JSONObject rule = new JSONObject();
		rule.put("classDef", classDefs);
		rule.put("relationship_rule", relationshipRule());
		return rule;
	}

	/** Seed every graph class (namespace-prefixed tables), returning the adapter used. */
	protected DataAdapter seedGraph() throws Exception {
		DataAdapter adapter = newAdapter(graphRule());
		String ns = namespace();
		for (JSONObject classDef : graphClassDefs()) {
			String className = classDef.getString("className");
			adapter.createClass(ns, classDef);
			JSONArray objs = graphSeed().get(className);
			if (objs != null && !objs.isEmpty()) {
				adapter.insertObjects(ns, classDef, objs);
			}
		}
		return adapter;
	}

	/** Drop every graph class table. */
	protected void dropGraph() {
		newAdapter(graphRule()).dropNamespace(namespace());
	}

	protected void assume(DataAdapterCapability capability) {
		assumeTrue(capabilities().contains(capability),
				() -> "adapter does not support " + capability);
	}

	// ----------------------------------------------------------------------------------
	// JDBC read-back helpers (work for every JDBC adapter; M3 overrides where needed)
	// ----------------------------------------------------------------------------------

	/** The physical table name the adapter creates for a class under this namespace. */
	protected String fullTable(String className) {
		return namespace() + className;
	}

	/** Read every row of a class back through a raw JDBC connection. */
	protected List<JSONObject> selectAll(String className) throws Exception {
		List<JSONObject> rows = new ArrayList<>();
		try (Connection c = newAdapter().openConnection();
				Statement st = c.createStatement();
				ResultSet rs = st.executeQuery("select * from " + fullTable(className))) {
			ResultSetMetaData md = rs.getMetaData();
			int n = md.getColumnCount();
			while (rs.next()) {
				JSONObject row = new JSONObject();
				for (int i = 1; i <= n; i++) {
					row.put(md.getColumnName(i), rs.getObject(i));
				}
				rows.add(row);
			}
		}
		return rows;
	}

	/** Count the rows of a class. */
	protected long countRows(String className) throws Exception {
		try (Connection c = newAdapter().openConnection();
				Statement st = c.createStatement();
				ResultSet rs = st.executeQuery("select count(*) from " + fullTable(className))) {
			rs.next();
			return rs.getLong(1);
		}
	}

	/** Normalize a JDBC value to a comparable string (dates/timestamps to their literal form). */
	protected static String str(Object value) {
		if (value == null) {
			return null;
		}
		if (value instanceof LocalDateTime ldt) {
			return ldt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
		}
		if (value instanceof LocalDate ld) {
			return ld.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
		}
		if (value instanceof java.sql.Timestamp ts) {
			return ts.toLocalDateTime().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
		}
		if (value instanceof java.sql.Date sd) {
			return sd.toLocalDate().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
		}
		return value.toString();
	}

	/** Count rows whose field equals the given value (string-normalized comparison). */
	protected long countMatching(String className, String field, Object value) throws Exception {
		return selectAll(className).stream()
				.filter(row -> java.util.Objects.equals(str(row.get(field)), str(value)))
				.count();
	}

	// ----------------------------------------------------------------------------------
	// Connection
	// ----------------------------------------------------------------------------------

	@Test
	void connectionProbeReportsDatabase() throws Exception {
		assume(DataAdapterCapability.JDBC_CONNECTION);
		newAdapter().testConnection();
	}

	// ----------------------------------------------------------------------------------
	// Namespace lifecycle
	// ----------------------------------------------------------------------------------

	@Test
	void namespaceLifecycle() throws Exception {
		assume(DataAdapterCapability.NAMESPACE_LIFECYCLE);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createNamespace(ns);
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		assertEquals(testObjects().size(), countRows(classNameOf(classDef())));
		adapter.truncateNamespace(ns);
		assertEquals(0, countRows(classNameOf(classDef())));
		adapter.dropNamespace(ns);
	}

	private String classNameOf(JSONObject classDef) {
		return (String) classDef.get("className");
	}

	// ----------------------------------------------------------------------------------
	// INSERT — value types, nulls, quoting, batches, primary-key validation
	// ----------------------------------------------------------------------------------

	@Test
	void insertAllScalarTypesRoundTrip() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		JSONArray objs = allTypeObjects();
		adapter.insertObjects(ns, classDef(), objs);
		assertEquals(objs.size(), countRows(classNameOf(classDef())));
		List<JSONObject> rows = selectAll(classNameOf(classDef()));
		for (int i = 0; i < objs.size(); i++) {
			JSONObject obj = objs.getJSONObject(i);
			JSONObject actual = rows.stream()
					.filter(r -> str(obj.get(primaryKey())).equals(str(r.get(primaryKey()))))
					.findFirst()
					.orElseThrow(() -> new AssertionError("no row for pk " + obj.get(primaryKey())));
			assertRoundTrip(obj, actual);
		}
		adapter.dropNamespace(ns);
	}

	@Test
	void insertNullFieldsStayNull() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), nullFieldsObject());
		JSONObject row = selectAll(classNameOf(classDef())).get(0);
		assertEquals(null, row.get(nullFieldName()));
		adapter.dropNamespace(ns);
	}

	@Test
	void insertEscapesSingleQuotes() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), quoteObject());
		assertEquals(1, countMatching(classNameOf(classDef()), quotedFieldName(), quotedValue()));
		adapter.dropNamespace(ns);
	}

	@Test
	void insertWithoutPrimaryKeyThrows() {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		JSONObject missingPk = new JSONObject();
		missingPk.put("name", "NoKey");
		JSONArray objs = new JSONArray();
		objs.add(missingPk);
		assertThrows(Exception.class, () -> adapter.insertObjects(ns, classDef(), objs));
		adapter.dropNamespace(ns);
	}

	// ----------------------------------------------------------------------------------
	// UPDATE — every where operator
	// ----------------------------------------------------------------------------------

	@Test
	void updateWhereEquals() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("name", "=", "Alice"), 1);
	}

	@Test
	void updateWhereNotEquals() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("name", "!=", "Alice"), testObjects().size() - 1);
	}

	@Test
	void updateWhereGreaterThan() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("age", ">", 30), countOf("age", ">", 30));
	}

	@Test
	void updateWhereGreaterOrEqual() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("age", ">=", 30), countOf("age", ">=", 30));
	}

	@Test
	void updateWhereLessThan() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("age", "<", 30), countOf("age", "<", 30));
	}

	@Test
	void updateWhereLessOrEqual() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("age", "<=", 30), countOf("age", "<=", 30));
	}

	@Test
	void updateWhereBetween() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "between");
		where.put("field", "age");
		where.put("value", JSONArray.of(25, 40));
		assertUpdateAffects(where, countOf("age", "between", 25, 40));
	}

	@Test
	void updateWhereIn() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "in");
		where.put("field", "name");
		where.put("value", JSONArray.of("Alice", "Bob"));
		assertUpdateAffects(where, 2);
	}

	@Test
	void updateWhereLike() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertUpdateAffects(cond("name", "like", "A%"), 1);
	}

	@Test
	void updateWhereIsNull() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "is");
		where.put("field", nullFieldName());
		assertUpdateAffects(where, countOfNull(nullFieldName()));
	}

	@Test
	void updateWhereIsNotNull() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "is not");
		where.put("field", nullFieldName());
		assertUpdateAffects(where, testObjects().size() - countOfNull(nullFieldName()));
	}

	// ----------------------------------------------------------------------------------
	// UPDATE — and/or nesting
	// ----------------------------------------------------------------------------------

	@Test
	void updateWhereAndNesting() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("and", JSONArray.of(cond("age", ">", 20), cond("age", "<", 40)));
		assertUpdateAffects(where, countOf("age", ">", 20) - countOf("age", ">=", 40));
	}

	@Test
	void updateWhereOrNesting() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("or", JSONArray.of(cond("name", "=", "Alice"), cond("name", "=", "Bob")));
		assertUpdateAffects(where, 2);
	}

	@Test
	void updateWhereMixedNesting() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		// (age > 30 OR name = 'Bob') AND height >= 1.5
		JSONObject orBranch = new JSONObject();
		orBranch.put("or", JSONArray.of(cond("age", ">", 30), cond("name", "=", "Bob")));
		JSONObject where = new JSONObject();
		where.put("and", JSONArray.of(orBranch, cond("height", ">=", 1.5)));
		int expected = (int) (countOf("age", ">", 30) + 1); // age>30 rows plus Bob (Bob age 30 not >30)
		assertUpdateAffects(where, expected);
	}

	// ----------------------------------------------------------------------------------
	// UPDATE — set value types, primary-key guard, unknown field guard
	// ----------------------------------------------------------------------------------

	@Test
	void updateSetsEveryScalarType() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());

		JSONObject set = updatedValues();
		adapter.updateObjects(ns, classDef(), set, cond(primaryKey(), "=", firstPk()));

		JSONObject row = rowByPk(firstPk());
		for (String key : set.keySet()) {
			assertEquals(str(set.get(key)), str(row.get(key)), "field " + key);
		}
		adapter.dropNamespace(ns);
	}

	@Test
	void updatePrimaryKeyIsRejected() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		JSONObject set = new JSONObject();
		set.put(primaryKey(), "changed");
		assertThrows(Exception.class,
				() -> adapter.updateObjects(ns, classDef(), set, cond(primaryKey(), "=", firstPk())));
		adapter.dropNamespace(ns);
	}

	@Test
	void updateUnknownFieldIsRejected() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		JSONObject set = new JSONObject();
		set.put("no_such_field", "x");
		assertThrows(Exception.class,
				() -> adapter.updateObjects(ns, classDef(), set, cond(primaryKey(), "=", firstPk())));
		adapter.dropNamespace(ns);
	}

	// ----------------------------------------------------------------------------------
	// DELETE — every where operator, nesting, delete-all
	// ----------------------------------------------------------------------------------

	@Test
	void deleteWhereEquals() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertDeleteAffects(cond("name", "=", "Alice"), 1);
	}

	@Test
	void deleteWhereGreaterThan() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertDeleteAffects(cond("age", ">", 30), countOf("age", ">", 30));
	}

	@Test
	void deleteWhereBetween() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "between");
		where.put("field", "age");
		where.put("value", JSONArray.of(25, 40));
		assertDeleteAffects(where, countOf("age", "between", 25, 40));
	}

	@Test
	void deleteWhereIn() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("operator", "in");
		where.put("field", "name");
		where.put("value", JSONArray.of("Alice", "Bob"));
		assertDeleteAffects(where, 2);
	}

	@Test
	void deleteWhereLike() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		assertDeleteAffects(cond("name", "like", "A%"), 1);
	}

	@Test
	void deleteWhereAndNesting() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("and", JSONArray.of(cond("age", ">", 20), cond("age", "<", 40)));
		assertDeleteAffects(where, countOf("age", ">", 20) - countOf("age", ">=", 40));
	}

	@Test
	void deleteWhereOrNesting() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		JSONObject where = new JSONObject();
		where.put("or", JSONArray.of(cond("name", "=", "Alice"), cond("name", "=", "Bob")));
		assertDeleteAffects(where, 2);
	}

	@Test
	void deleteWithoutWhereRemovesAll() throws Exception {
		assume(DataAdapterCapability.OBJECT_CRUD);
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		adapter.deleteObjects(ns, classDef(), null);
		assertEquals(0, countRows(classNameOf(classDef())));
		adapter.dropNamespace(ns);
	}

	// ----------------------------------------------------------------------------------
	// READ — DSL conditions, join, group by, order by, limit
	// ----------------------------------------------------------------------------------

	@Test
	void readSimpleSelect() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray rows = queryPersons(null);
		assertEquals(totalPersonCount(), rows.size());
		dropGraph();
	}

	@Test
	void readWhereEqualsString() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray rows = queryPersons(readCond("name", "=", "Alice"));
		assertEquals(1, rows.size());
		assertEquals("Alice", rows.getJSONObject(0).getString("person_name"));
		dropGraph();
	}

	@Test
	void readWhereNumericComparison() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		assertEquals(2, queryPersons(readCond("age", ">", 30)).size());
		assertEquals(1, queryPersons(readCond("age", "<", 30)).size());
		assertEquals(3, queryPersons(readCond("age", ">=", 30)).size());
		assertEquals(2, queryPersons(readCond("age", "<=", 30)).size());
		dropGraph();
	}

	@Test
	void readWhereBetween() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray rows = queryPersons(readCond("age", "between", JSONArray.of(25, 40)));
		assertEquals(4, rows.size());
		dropGraph();
	}

	@Test
	void readWhereIn() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray rows = queryPersons(readCond("name", "in", JSONArray.of("Alice", "Bob")));
		assertEquals(2, rows.size());
		dropGraph();
	}

	@Test
	void readWhereLike() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray rows = queryPersons(readCond("name", "like", "ob"));
		assertEquals(1, rows.size());
		assertEquals("Bob", rows.getJSONObject(0).getString("person_name"));
		dropGraph();
	}

	@Test
	void readWhereAndNesting() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONObject and = readAnd(readCond("age", ">", 20), readCond("age", "<", 40));
		JSONArray rows = queryPersons(and);
		assertEquals(3, rows.size());
		dropGraph();
	}

	@Test
	void readWhereOrNesting() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONObject or = readOr(readCond("name", "=", "Alice"), readCond("name", "=", "Bob"));
		JSONArray rows = queryPersons(or);
		assertEquals(2, rows.size());
		dropGraph();
	}

	@Test
	void readJoinTwoClasses() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		objects.add(readObject(1, "o", 1));
		JSONArray rels = new JSONArray();
		rels.add(readRelation(0, 1, firstRelation()));
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "name", "person_name"));
		fields.add(readField("o", "title", "org_title"));
		JSONArray rows = readQuery(singleStepDsl(objects, rels, fields, null, null, null));
		assertEquals(totalPersonCount(), rows.size());
		dropGraph();
	}

	@Test
	void readJoinThreeClasses() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		objects.add(readObject(1, "o", 1));
		objects.add(readObject(2, "pr", 2));
		JSONArray rels = new JSONArray();
		rels.add(readRelation(0, 1, firstRelation()));
		rels.add(readRelation(1, 2, secondRelation()));
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "name", "person_name"));
		fields.add(readField("o", "title", "org_title"));
		fields.add(readField("pr", "name", "project_name"));
		JSONArray rows = readQuery(singleStepDsl(objects, rels, fields, null, null, null));
		assertEquals(totalPersonCount(), rows.size());
		dropGraph();
	}

	@Test
	void readGroupBy() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		JSONArray fields = new JSONArray();
		fields.add(readAggField("p", "id", "count", "cnt"));
		fields.add(readField("p", "org_id", "org_id"));
		JSONObject groupBy = new JSONObject();
		groupBy.put("fields", JSONArray.of(readGroupByField("p", "org_id")));
		JSONArray rows = readQuery(singleStepDsl(objects, null, fields, groupBy, null, null));
		assertEquals(2, rows.size());
		dropGraph();
	}

	@Test
	void readDistinct() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		JSONArray fields = new JSONArray();
		fields.add(readDistinctField("p", "org_id", "org_id"));
		JSONArray rows = readQuery(singleStepDsl(objects, null, fields, null, null, null));
		assertEquals(2, rows.size());
		dropGraph();
	}

	@Test
	void readHaving() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		JSONArray fields = new JSONArray();
		fields.add(readAggField("p", "id", "count", "cnt"));
		fields.add(readField("p", "org_id", "org_id"));
		JSONObject groupBy = new JSONObject();
		groupBy.put("fields", JSONArray.of(readGroupByField("p", "org_id")));
		groupBy.put("having", JSONArray.of(readHavingCond("p", "id", "count", ">", 1)));
		JSONArray rows = readQuery(singleStepDsl(objects, null, fields, groupBy, null, null));
		assertEquals(2, rows.size());
		// a stronger filter returns no group (both orgs hold exactly two members)
		groupBy.put("having", JSONArray.of(readHavingCond("p", "id", "count", ">", 2)));
		JSONArray filtered = readQuery(singleStepDsl(objects, null, fields, groupBy, null, null));
		assertEquals(0, filtered.size());
		dropGraph();
	}

	@Test
	void readOrderBy() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "age", "age"));
		JSONObject sort = new JSONObject();
		sort.put("fields", JSONArray.of(readSortField("age", "desc")));
		JSONArray rows = readQuery(singleStepDsl(objects, null, fields, null, sort, null));
		assertEquals(totalPersonCount(), rows.size());
		assertEquals(40, ((Number) rows.getJSONObject(0).get("age")).intValue());
		assertEquals(25, ((Number) rows.getJSONObject(rows.size() - 1).get("age")).intValue());
		dropGraph();
	}

	@Test
	void readLimit() throws Exception {
		assume(DataAdapterCapability.READ_QUERY);
		seedGraph();
		JSONArray objects = new JSONArray();
		objects.add(readObject(0, "p", 0));
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "name", "person_name"));
		JSONObject limit = new JSONObject();
		limit.put("count", 2);
		limit.put("offset", 0);
		JSONArray rows = readQuery(singleStepDsl(objects, null, fields, null, null, limit));
		assertEquals(2, rows.size());
		dropGraph();
	}

	// ----------------------------------------------------------------------------------
	// EDGE — createEdge / deleteEdge
	// ----------------------------------------------------------------------------------

	@Test
	void createEdgeStoresForeignKey() throws Exception {
		assume(DataAdapterCapability.EDGE_CRUD);
		DataAdapter adapter = seedGraph();
		adapter.createEdge(namespace(), firstRelation(), graphClass(0), "p1", graphClass(1), "o2");
		assertEquals("o2", str(graphRow(graphClass(0), "p1").get(joinField(0))));
		dropGraph();
	}

	@Test
	void deleteEdgeClearsForeignKey() throws Exception {
		assume(DataAdapterCapability.EDGE_CRUD);
		DataAdapter adapter = seedGraph();
		adapter.createEdge(namespace(), firstRelation(), graphClass(0), "p1", graphClass(1), "o2");
		adapter.deleteEdge(namespace(), firstRelation(), graphClass(0), "p1", graphClass(1), "o2");
		assertEquals(null, graphRow(graphClass(0), "p1").get(joinField(0)));
		dropGraph();
	}

	@Test
	void createEdgeUnknownRelationThrows() throws Exception {
		assume(DataAdapterCapability.EDGE_CRUD);
		DataAdapter adapter = seedGraph();
		assertThrows(Exception.class, () -> adapter.createEdge(namespace(), "no_such_rel", graphClass(0), "p1", graphClass(1), "o1"));
		dropGraph();
	}

	// ----------------------------------------------------------------------------------
	// Read-path DSL builders
	// ----------------------------------------------------------------------------------

	protected JSONArray readQuery(String dslJson) throws Exception {
		DataAdapter adapter = newAdapter(prefixedGraphRule());
		java.util.List<String> mqls = new java.util.ArrayList<>();
		String result = adapter.executeDsl(dslJson, "test-session", null, mqls);
		return JSON.parseArray(result).getJSONObject(0).getJSONArray("answer");
	}

	protected JSONArray queryPersons(JSONObject condition) throws Exception {
		JSONArray objects = new JSONArray();
		JSONObject p = readObject(0, "p", 0);
		if (condition != null) {
			JSONObject conditions = new JSONObject();
			conditions.put("properties", condition);
			p.put("conditions", conditions);
		}
		objects.add(p);
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "name", "person_name"));
		return readQuery(singleStepDsl(objects, null, fields, null, null, null));
	}

	protected JSONObject readObject(int graphIdx, String variable, int idx) {
		JSONObject o = new JSONObject();
		o.put("class", namespace() + graphClass(graphIdx));
		o.put("variable", variable);
		o.put("idx", idx);
		return o;
	}

	protected JSONObject readCond(String field, String operator, Object value) {
		JSONObject c = new JSONObject();
		c.put("field", field);
		c.put("operator", operator);
		c.put("value", value);
		return c;
	}

	protected JSONObject readAnd(JSONObject... conds) {
		JSONObject a = new JSONObject();
		JSONArray arr = new JSONArray();
		for (JSONObject c : conds) {
			arr.add(c);
		}
		a.put("and", arr);
		return a;
	}

	protected JSONObject readOr(JSONObject... conds) {
		JSONObject o = new JSONObject();
		JSONArray arr = new JSONArray();
		for (JSONObject c : conds) {
			arr.add(c);
		}
		o.put("or", arr);
		return o;
	}

	protected JSONObject readField(String variable, String field, String as) {
		JSONObject f = new JSONObject();
		f.put("variable", variable);
		f.put("field", field);
		f.put("as", as);
		return f;
	}

	protected JSONObject readAggField(String variable, String field, String function, String as) {
		JSONObject f = readField(variable, field, as);
		f.put("function", function);
		return f;
	}

	protected JSONObject readGroupByField(String variable, String field) {
		JSONObject f = new JSONObject();
		f.put("variable", variable);
		f.put("field", field);
		return f;
	}

	protected JSONObject readDistinctField(String variable, String field, String as) {
		JSONObject f = readField(variable, field, as);
		f.put("distinct", true);
		return f;
	}

	protected JSONObject readHavingCond(String variable, String field, String function, String operator, Object value) {
		JSONObject c = new JSONObject();
		c.put("variable", variable);
		c.put("field", field);
		c.put("function", function);
		c.put("operator", operator);
		c.put("value", value);
		return c;
	}

	protected JSONObject readSortField(String field, String order) {
		JSONObject f = new JSONObject();
		f.put("field", field);
		f.put("order", order);
		return f;
	}

	protected JSONObject readRelation(int from, int to, String type) {
		JSONObject r = new JSONObject();
		r.put("from", from);
		r.put("to", to);
		JSONArray types = new JSONArray();
		types.add(type);
		r.put("type", types);
		return r;
	}

	protected String singleStepDsl(JSONArray objects, JSONArray relationships, JSONArray outputFields,
			JSONObject groupBy, JSONObject sort, JSONObject limit) {
		JSONObject pattern = new JSONObject();
		pattern.put("objects", objects);
		if (relationships != null && !relationships.isEmpty()) {
			pattern.put("relationship", relationships);
		}
		JSONArray patterns = new JSONArray();
		patterns.add(pattern);
		JSONObject graph = new JSONObject();
		graph.put("patterns", patterns);
		JSONObject step = new JSONObject();
		step.put("graph", graph);
		JSONObject output = new JSONObject();
		output.put("fields", outputFields);
		if (groupBy != null) {
			output.put("group_by", groupBy);
		}
		if (sort != null) {
			output.put("sort", sort);
		}
		if (limit != null) {
			output.put("limit", limit);
		}
		step.put("output", output);
		JSONArray steps = new JSONArray();
		steps.add(step);
		JSONObject answer = new JSONObject();
		answer.put("steps", steps);
		JSONObject dsl = new JSONObject();
		dsl.put("answer", answer);
		JSONArray arr = new JSONArray();
		arr.add(dsl);
		return arr.toJSONString();
	}

	protected JSONObject graphRow(String className, String id) throws Exception {
		for (JSONObject row : selectAll(className)) {
			if (id.equals(str(row.get("id")))) {
				return row;
			}
		}
		throw new AssertionError("no row " + className + " with id " + id);
	}

	/** Total number of source-class objects in the graph seed. */
	protected int totalPersonCount() {
		return graphSeed().get(graphClass(0)).size();
	}

	/** The foreign-key field the edge at index {@code i} maintains on its source class. */
	protected abstract String joinField(int i);

	// ----------------------------------------------------------------------------------
	// Sample data
	// ----------------------------------------------------------------------------------

	@Test
	void sampleDataFileName() {
		assume(DataAdapterCapability.SAMPLE_DATA);
		newAdapter().getSampleDataFileName("demo", "person");
	}

	// ----------------------------------------------------------------------------------
	// Shared scenario helpers
	// ----------------------------------------------------------------------------------

	private static JSONObject cond(String field, String operator, Object value) {
		JSONObject c = new JSONObject();
		c.put("field", field);
		c.put("operator", operator);
		c.put("value", value);
		return c;
	}

	/** Run update with the given where, then assert exactly {@code expected} rows were changed. */
	private void assertUpdateAffects(JSONObject where, int expected) throws Exception {
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());

		JSONObject set = new JSONObject();
		set.put(updateMarkerField(), updateMarkerValue());
		adapter.updateObjects(ns, classDef(), set, where);

		assertEquals(expected, countMatching(classNameOf(classDef()), updateMarkerField(), updateMarkerValue()));
		adapter.dropNamespace(ns);
	}

	/** Run delete with the given where, then assert exactly {@code expected} rows were removed. */
	private void assertDeleteAffects(JSONObject where, int expected) throws Exception {
		DataAdapter adapter = newAdapter();
		String ns = namespace();
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		int before = testObjects().size();

		adapter.deleteObjects(ns, classDef(), where);

		assertEquals(before - expected, countRows(classNameOf(classDef())));
		adapter.dropNamespace(ns);
	}

	private JSONObject rowByPk(String pkValue) throws Exception {
		for (JSONObject row : selectAll(classNameOf(classDef()))) {
			if (pkValue.equals(str(row.get(primaryKey())))) {
				return row;
			}
		}
		throw new AssertionError("no row with " + primaryKey() + " = " + pkValue);
	}

	private String firstPk() {
		return testObjects().getJSONObject(0).getString(primaryKey());
	}

	private int countOf(String field, String operator, Object value) {
		return (int) testObjects().stream().filter(o -> compare((JSONObject) o, field, operator, value)).count();
	}

	private int countOf(String field, String operator, Object low, Object high) {
		return (int) testObjects().stream().filter(o -> {
			double v = ((JSONObject) o).getDoubleValue(field);
			return v >= ((Number) low).doubleValue() && v <= ((Number) high).doubleValue();
		}).count();
	}

	private int countOfNull(String field) {
		return (int) testObjects().stream().filter(o -> ((JSONObject) o).get(field) == null).count();
	}

	private boolean compare(JSONObject o, String field, String operator, Object value) {
		Object v = o.get(field);
		if (v == null) {
			return false;
		}
		double nv = ((Number) v).doubleValue();
		double nw = ((Number) value).doubleValue();
		return switch (operator) {
			case ">" -> nv > nw;
			case ">=" -> nv >= nw;
			case "<" -> nv < nw;
			case "<=" -> nv <= nw;
			default -> false;
		};
	}

	// ----------------------------------------------------------------------------------
	// Fixtures (subclasses override these to shape the concrete schema/seed)
	// ----------------------------------------------------------------------------------

	/** One object with every supported scalar type populated. */
	protected JSONArray allTypeObjects() {
		return testObjects();
	}

	/** A single object with a null in the nullable field. */
	protected JSONArray nullFieldsObject() {
		JSONObject o = new JSONObject();
		o.put(primaryKey(), "null-key");
		o.put("name", "HasNull");
		o.put(nullFieldName(), null);
		JSONArray arr = new JSONArray();
		arr.add(o);
		return arr;
	}

	/** A single object carrying a single quote in a string field. */
	protected JSONArray quoteObject() {
		JSONObject o = new JSONObject();
		o.put(primaryKey(), "quote-key");
		o.put("name", quotedValue());
		JSONArray arr = new JSONArray();
		arr.add(o);
		return arr;
	}

	protected String nullFieldName() {
		return "bio";
	}

	protected String quotedFieldName() {
		return "name";
	}

	protected String quotedValue() {
		return "O'Brien";
	}

	protected String updateMarkerField() {
		return "score";
	}

	protected Object updateMarkerValue() {
		return 999L;
	}

	/** The set values for {@link #updateSetsEveryScalarType()}. */
	protected JSONObject updatedValues() {
		JSONObject set = new JSONObject();
		set.put("name", "Updated");
		set.put("age", 77);
		set.put("score", 777L);
		set.put("height", 7.7);
		set.put("birthday", "1999-09-09");
		set.put("created_at", "2025-05-05 05:05:05");
		set.put("bio", "new bio");
		return set;
	}

	/** Assert the inserted row round-trips the scalar values of {@code obj}. */
	protected void assertRoundTrip(JSONObject expected, JSONObject actual) {
		for (String key : expected.keySet()) {
			assertEquals(str(expected.get(key)), str(actual.get(key)), "field " + key);
		}
	}
}
