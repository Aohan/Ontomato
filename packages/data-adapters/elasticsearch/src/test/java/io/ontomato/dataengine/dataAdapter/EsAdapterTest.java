package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

/**
 * Full contract run for the Elasticsearch adapter against a real instance.
 *
 * <p>Provisioning: a Testcontainers Elasticsearch is started when Docker is available; set
 * {@code ONTOMATO_TEST_ES_URL} (plus optional {@code ONTOMOTA_TEST_ES_USER} and
 * {@code ONTOMATO_TEST_ES_PASSWORD}) to point at an external instance instead. When neither
 * Docker nor an external URL is available, the class is skipped, not failed.</p>
 *
 * <p>Elasticsearch is non-JDBC, so the JDBC read-back helpers ({@link #selectAll},
 * {@link #countRows}) are overridden to read through the search API. The graph fixture mirrors
 * the relational adapters: person -works_at-> org -belongs_to-> project.</p>
 */
class EsAdapterTest extends AbstractDataAdapterTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_ES_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_ES_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_ES_PASSWORD");
	/** The engine under test: {@code elasticsearch} (default) or {@code opensearch}, from
	 *  {@code ONTOMATO_TEST_ES_DIALECT}. The suite is shared; only the dialect differs. */
	private static final EsDialect DIALECT = "opensearch".equalsIgnoreCase(System.getenv("ONTOMATO_TEST_ES_DIALECT"))
			? EsDialect.OPENSEARCH
			: EsDialect.ELASTICSEARCH;
	private static final String IMAGE = System.getenv().getOrDefault("ONTOMATO_TEST_ES_IMAGE",
			DIALECT == EsDialect.OPENSEARCH
					? "opensearchproject/opensearch:2.19.0"
					: "docker.elastic.co/elasticsearch/elasticsearch:9.5.5");

	private static String url;
	private static String user;
	private static String password;
	private static GenericContainer<?> container;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void startEngine() {
		if (EXTERNAL_URL != null) {
			url = EXTERNAL_URL;
			user = EXTERNAL_USER;
			password = EXTERNAL_PASSWORD;
			return;
		}
		org.junit.jupiter.api.Assumptions.assumeTrue(isDockerAvailable(),
				"Docker is not running and ONTOMATO_TEST_ES_URL is not set; skipping Elasticsearch contract tests");
		container = new GenericContainer<>(IMAGE)
				.withEnv("discovery.type", "single-node")
				.withEnv("ES_JAVA_OPTS", "-Xms512m -Xmx512m")
				.withExposedPorts(9200)
				.waitingFor(Wait.forHttp("/").forPort(9200).withStartupTimeout(java.time.Duration.ofMinutes(3)));
		if (DIALECT == EsDialect.OPENSEARCH) {
			container.withEnv("DISABLE_SECURITY_PLUGIN", "true");
			container.withEnv("DISABLE_INSTALL_DEMO_CONFIG", "true");
		} else {
			container.withEnv("xpack.security.enabled", "false");
		}
		container.start();
		url = "http://" + container.getHost() + ":" + container.getMappedPort(9200);
	}

	private static boolean isDockerAvailable() {
		try {
			return org.testcontainers.DockerClientFactory.instance().isDockerAvailable();
		} catch (Throwable t) {
			return false;
		}
	}

	private DataAdapterConnection connection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		connection.setUser(user);
		connection.setPassword(password);
		return connection;
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		return new EsAdapter(connection(), jsonRule, DIALECT);
	}

	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return EnumSet.of(
				DataAdapterCapability.READ_QUERY,
				DataAdapterCapability.SAMPLE_DATA,
				DataAdapterCapability.NAMESPACE_LIFECYCLE,
				DataAdapterCapability.CLASS_SCHEMA,
				DataAdapterCapability.OBJECT_CRUD,
				DataAdapterCapability.EDGE_CRUD,
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
		classDef.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false),
				attr("bio", "text", false),
				attr("age", "int", false),
				attr("score", "long", false),
				attr("height", "double", false),
				attr("birthday", "date", false),
				attr("created_at", "timestamp", false)));
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

	// ----------------------------------------------------------------------------------
	// Non-JDBC read-back overrides
	// ----------------------------------------------------------------------------------

	private String indexOf(String className) {
		return newAdapter(null).sandboxClassName(namespace(), className);
	}

	@Override
	protected List<JSONObject> selectAll(String className) throws Exception {
		try (EsHttp http = new EsHttp(connection())) {
			JSONObject body = new JSONObject();
			body.put("query", new JSONObject(Map.of("match_all", new JSONObject())));
			body.put("size", 1000);
			JSONObject response = http.post("/" + indexOf(className) + "/_search", body);
			List<JSONObject> rows = new ArrayList<>();
			JSONArray hits = response.getJSONObject("hits").getJSONArray("hits");
			for (int i = 0; hits != null && i < hits.size(); i++) {
				rows.add(hits.getJSONObject(i).getJSONObject("_source"));
			}
			return rows;
		}
	}

	@Override
	protected long countRows(String className) throws Exception {
		try (EsHttp http = new EsHttp(connection())) {
			JSONObject body = new JSONObject();
			body.put("query", new JSONObject(Map.of("match_all", new JSONObject())));
			return http.post("/" + indexOf(className) + "/_count", body).getLongValue("count");
		}
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
