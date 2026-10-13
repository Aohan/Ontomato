package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Record;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Full contract run for the Neo4j adapter against a real instance.
 *
 * <p>Provisioning: a Testcontainers Neo4j is started when Docker is available; set
 * {@code ONTOMATO_TEST_NEO4J_URL} (plus optional {@code ONTOMATO_TEST_NEO4J_USER} and
 * {@code ONTOMATO_TEST_NEO4J_PASSWORD}) to point at an external instance instead. When
 * neither Docker nor an external URL is available, the test class is skipped, not failed.</p>
 *
 * <p>Neo4j is non-JDBC, so the JDBC read-back helpers ({@link #selectAll}, {@link #countRows})
 * are overridden to run Cypher over Bolt. The graph fixture is three classes
 * (person → org → project) linked by two key-field edges (works_at, belongs_to), mirroring the
 * relational adapters.</p>
 */
class Neo4jAdapterTest extends AbstractDataAdapterTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_NEO4J_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_NEO4J_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_NEO4J_PASSWORD");

	private static String url;
	private static String user;
	private static String password;
	private static GenericContainer<?> container;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void startDatabase() {
		if (EXTERNAL_URL != null) {
			url = EXTERNAL_URL;
			user = EXTERNAL_USER == null ? "neo4j" : EXTERNAL_USER;
			password = EXTERNAL_PASSWORD == null ? "neo4j" : EXTERNAL_PASSWORD;
			return;
		}
		org.junit.jupiter.api.Assumptions.assumeTrue(isDockerAvailable(),
				"Docker is not running and ONTOMATO_TEST_NEO4J_URL is not set; skipping Neo4j contract tests");
		container = new GenericContainer<>("neo4j:5.26.0")
				.withEnv("NEO4J_AUTH", "neo4j/neo4j-test")
				.withExposedPorts(7687, 7474)
				.waitingFor(Wait.forLogMessage(".*Started.*", 1));
		container.start();
		url = "bolt://" + container.getHost() + ":" + container.getMappedPort(7687);
		user = "neo4j";
		password = "neo4j-test";
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
		return new Neo4jAdapter(connection, jsonRule);
	}

	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return java.util.EnumSet.of(
				DataAdapterCapability.READ_QUERY,
				DataAdapterCapability.SAMPLE_DATA,
				DataAdapterCapability.NAMESPACE_LIFECYCLE,
				DataAdapterCapability.CLASS_SCHEMA,
				DataAdapterCapability.OBJECT_CRUD,
				DataAdapterCapability.EDGE_CRUD,
				DataAdapterCapability.RELATIONSHIP_EDGES,
				DataAdapterCapability.GRAPH_QUERY,
				DataAdapterCapability.VECTOR_ATTR);
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

	/** A relationship definition carries only its two classes; a graph edge is a relationship, not a key field. */
	@Override
	protected JSONObject relationshipRule() {
		JSONObject rule = new JSONObject();
		JSONObject worksAt = new JSONObject();
		worksAt.put("fromclass", "person");
		worksAt.put("toclass", "org");
		rule.put("works_at", worksAt);

		JSONObject belongsTo = new JSONObject();
		belongsTo.put("fromclass", "org");
		belongsTo.put("toclass", "project");
		rule.put("belongs_to", belongsTo);
		return rule;
	}

	/** There is no key field in the seed to imply edges, so seedGraph materializes them through createEdge. */
	@Override
	protected java.util.List<SeedEdge> seedEdges() {
		return java.util.List.of(
				new SeedEdge("works_at", 0, "p1", 1, "o1"),
				new SeedEdge("works_at", 0, "p2", 1, "o1"),
				new SeedEdge("works_at", 0, "p3", 1, "o2"),
				new SeedEdge("works_at", 0, "p4", 1, "o2"),
				new SeedEdge("belongs_to", 1, "o1", 2, "pr1"),
				new SeedEdge("belongs_to", 1, "o2", 2, "pr2"));
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

	// ----------------------------------------------------------------------------------
	// JDBC read-back helpers, reimplemented over Bolt (Neo4j is non-JDBC)
	// ----------------------------------------------------------------------------------

	/** The label for a class under this namespace equals the JDBC table name the base class builds. */
	@Override
	protected List<JSONObject> selectAll(String className) throws Exception {
		String label = fullTable(className);
		try (Driver driver = GraphDatabase.driver(url, AuthTokens.basic(user, password));
				Session session = driver.session()) {
			Result result = session.run("match (n:`" + label + "`) return n");
			List<JSONObject> rows = new ArrayList<>();
			while (result.hasNext()) {
				Record record = result.next();
				JSONObject row = new JSONObject();
				Map<String, Object> props = record.get("n").asMap();
				for (Map.Entry<String, Object> entry : props.entrySet()) {
					row.put(entry.getKey(), entry.getValue());
				}
				rows.add(row);
			}
			return rows;
		}
	}

	@Override
	protected long countRows(String className) throws Exception {
		String label = fullTable(className);
		try (Driver driver = GraphDatabase.driver(url, AuthTokens.basic(user, password));
				Session session = driver.session()) {
			Result result = session.run("match (n:`" + label + "`) return count(n) as c");
			return result.next().get("c").asLong();
		}
	}

	/** The connection probe is not covered by the JDBC-gated contract test, so assert it directly. */
	@Test
	void connectionProbeReportsLabels() throws Exception {
		JSONObject report = newAdapter().testConnection();
		assertEquals("Neo4j", report.getString("databaseProduct"));
	}

	/**
	 * A two-step DSL: the first step selects and projects the subgraph (flattening it into rows), the
	 * second step groups/aggregates/sorts over those rows. The adapter chains them with {@code WITH}.
	 */
	@Test
	void readTwoStepFlattensThenGroups() throws Exception {
		seedGraph();
		JSONObject source = JSONObject.of("idx", 0, "variable", "p", "class", namespace() + "person");
		JSONObject step0 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(source)))),
				"output", JSONObject.of(
						"to_user", false,
						"save_table", "/t1",
						"fields", JSONArray.of(
								JSONObject.of("variable", "p", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "p", "field", "id", "as", "person_id"))));

		JSONObject intermediate = JSONObject.of("idx", 0, "variable", "t1", "class", "/t1");
		JSONObject step1 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(intermediate)))),
				"output", JSONObject.of(
						"to_user", true,
						"fields", JSONArray.of(
								JSONObject.of("variable", "t1", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "t1", "field", "person_id", "function", "count", "as", "cnt")),
						"group_by", JSONObject.of("fields", JSONArray.of(JSONObject.of("variable", "t1", "field", "org_id"))),
						"sort", JSONObject.of("fields", JSONArray.of(JSONObject.of("field", "org_id", "order", "asc")))));

		JSONArray rows = readQuery(JSONArray.of(
				JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(step0, step1)))).toJSONString());

		assertEquals(2, rows.size());
		assertEquals(2L, ((Number) rows.getJSONObject(0).get("cnt")).longValue());
		dropGraph();
	}
}
