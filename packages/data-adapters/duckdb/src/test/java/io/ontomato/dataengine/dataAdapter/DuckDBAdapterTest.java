package io.ontomato.dataengine.dataAdapter;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.io.TempDir;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

/**
 * Zero-dependency contract run for the DuckDB adapter against a real (file) database.
 *
 * <p>DuckDB is embedded, so this test needs no Docker and no external server: it is the
 * proof that the shared contract suite runs end-to-end. A file database is used because
 * an in-memory URL would create a fresh empty database on every connection, losing the
 * tables between lifecycle steps.</p>
 *
 * <p>The write-path class carries one attribute of every supported scalar type. The graph
 * fixture is three classes (person → org → project) linked by two edges (works_at,
 * belongs_to), which exercise createEdge/deleteEdge and the read-path join.</p>
 */
class DuckDBAdapterTest extends AbstractDataAdapterTest {

	@TempDir
	static Path dir;

	private static String url;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void createDatabaseFile() throws Exception {
		// DuckDB creates the file on first connect; the adapter's testConnection()
		// requires the file to already exist, so create it up front.
		url = "jdbc:duckdb:" + dir.resolve("contract.duckdb");
		try (var connection = DriverManager.getConnection(url)) {
			// touch: opening the file database creates it
		}
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		return new DuckDBAdapter(connection, jsonRule);
	}

	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return DataAdapterCapability.FULL;
	}

	@Override
	protected String namespace() {
		return ns;
	}

	@Override
	protected String primaryKey() {
		return "id";
	}

	@Override
	protected JSONObject classDef() {
		JSONObject classDef = new JSONObject();
		classDef.put("className", "person");
		JSONArray attrs = new JSONArray();
		attrs.add(attr("id", "varchar", true));
		attrs.add(attr("name", "varchar", false));
		attrs.add(attr("bio", "text", false));
		attrs.add(attr("age", "int", false));
		attrs.add(attr("score", "long", false));
		attrs.add(attr("height", "double", false));
		attrs.add(attr("birthday", "date", false));
		attrs.add(attr("created_at", "timestamp", false));
		classDef.put("attrs", attrs);
		return classDef;
	}

	@Override
	protected JSONArray testObjects() {
		return JSONArray.of(
				person("1", "Alice", "engineer", 25, 100L, 1.70, "1990-01-01", "2020-01-01 10:00:00"),
				person("2", "Bob", "data scientist", 30, 200L, 1.80, "1991-02-02", "2020-02-02 11:00:00"),
				person("3", "Carol", null, 35, 300L, 1.90, "1992-03-03", "2020-03-03 12:00:00"),
				person("4", "Dave", null, 40, 400L, 2.00, "1993-04-04", "2020-04-04 13:00:00"),
				person("5", "Eve", "manager", 45, 500L, 1.60, "1994-05-05", "2020-05-05 14:00:00"));
	}

	private JSONObject person(String id, String name, String bio, int age, long score, double height,
			String birthday, String createdAt) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		o.put("bio", bio);
		o.put("age", age);
		o.put("score", score);
		o.put("height", height);
		o.put("birthday", birthday);
		o.put("created_at", createdAt);
		return o;
	}

	// ----------------------------------------------------------------------------------
	// Graph fixture: person -works_at-> org -belongs_to-> project
	// ----------------------------------------------------------------------------------

	@Override
	protected List<JSONObject> graphClassDefs() {
		JSONObject person = new JSONObject();
		person.put("className", "person");
		person.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false),
				attr("age", "int", false),
				attr("org_id", "varchar", false)));

		JSONObject org = new JSONObject();
		org.put("className", "org");
		org.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("title", "varchar", false),
				attr("project_id", "varchar", false)));

		JSONObject project = new JSONObject();
		project.put("className", "project");
		project.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false)));

		return List.of(person, org, project);
	}

	@Override
	protected JSONObject relationshipRule() {
		JSONObject rule = new JSONObject();
		JSONObject worksAt = new JSONObject();
		worksAt.put("fromclass", "person");
		worksAt.put("toclass", "org");
		worksAt.put("fromField", "org_id");
		worksAt.put("toField", "id");
		rule.put("works_at", worksAt);

		JSONObject belongsTo = new JSONObject();
		belongsTo.put("fromclass", "org");
		belongsTo.put("toclass", "project");
		belongsTo.put("fromField", "project_id");
		belongsTo.put("toField", "id");
		rule.put("belongs_to", belongsTo);
		return rule;
	}

	@Override
	protected Map<String, JSONArray> graphSeed() {
		JSONArray persons = JSONArray.of(
				gPerson("p1", "Alice", 25, "o1"),
				gPerson("p2", "Bob", 30, "o1"),
				gPerson("p3", "Carol", 35, "o2"),
				gPerson("p4", "Dave", 40, "o2"));
		JSONArray orgs = JSONArray.of(
				gOrg("o1", "Engineering", "pr1"),
				gOrg("o2", "Sales", "pr2"));
		JSONArray projects = JSONArray.of(
				gProject("pr1", "Alpha"),
				gProject("pr2", "Beta"));
		return Map.of("person", persons, "org", orgs, "project", projects);
	}

	@Override
	protected String joinField(int i) {
		return i == 0 ? "org_id" : "project_id";
	}

	private JSONObject gPerson(String id, String name, int age, String orgId) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		o.put("age", age);
		o.put("org_id", orgId);
		return o;
	}

	private JSONObject gOrg(String id, String title, String projectId) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("title", title);
		o.put("project_id", projectId);
		return o;
	}

	private JSONObject gProject(String id, String name) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		return o;
	}

	private static JSONObject attr(String name, String type, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", type);
		attr.put("primaryKey", primaryKey);
		attr.put("enable", true);
		return attr;
	}
}
