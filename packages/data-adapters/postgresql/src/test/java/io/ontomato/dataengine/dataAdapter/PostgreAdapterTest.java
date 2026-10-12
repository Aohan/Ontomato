package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

/**
 * Full contract run for the PostgreSQL adapter against a real instance.
 *
 * <p>Provisioning: a Testcontainers PostgreSQL is started when Docker is available; set
 * {@code ONTOMATO_TEST_PG_URL} (plus optional {@code ONTOMATO_TEST_PG_USER} and
 * {@code ONTOMATO_TEST_PG_PASSWORD}) to point at an external instance instead. When
 * neither Docker nor an external URL is available, the test class is skipped, not failed.</p>
 *
 * <p>The fixture mirrors {@link DuckDBAdapterTest}: the write-path class carries one
 * attribute of every supported scalar type, and the graph fixture is three classes
 * (person → org → project) linked by two edges (works_at, belongs_to).</p>
 */
class PostgreAdapterTest extends AbstractDataAdapterTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_PG_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_PG_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_PG_PASSWORD");

	private static String url;
	private static String user;
	private static String password;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void startDatabase() {
		if (EXTERNAL_URL != null) {
			url = EXTERNAL_URL;
			user = EXTERNAL_USER == null ? "postgres" : EXTERNAL_USER;
			password = EXTERNAL_PASSWORD == null ? "" : EXTERNAL_PASSWORD;
			return;
		}
		org.junit.jupiter.api.Assumptions.assumeTrue(isDockerAvailable(),
				"Docker is not running and ONTOMATO_TEST_PG_URL is not set; skipping PostgreSQL contract tests");
		org.testcontainers.containers.PostgreSQLContainer<?> pg =
				new org.testcontainers.containers.PostgreSQLContainer<>("postgres:16-alpine");
		pg.start();
		url = pg.getJdbcUrl();
		user = pg.getUsername();
		password = pg.getPassword();
	}

	private static boolean isDockerAvailable() {
		try {
			return org.testcontainers.DockerClientFactory.instance().isDockerAvailable();
		} catch (Throwable t) {
			return false;
		}
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		connection.setUser(user);
		connection.setPassword(password);
		return new PostgreAdapter(connection, jsonRule);
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
