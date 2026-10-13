package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * Controlled HTTP REST protocol regression for the Elasticsearch/OpenSearch adapter.
 *
 * <p>Drives the public entries ({@code testConnection} and {@code executeDsl}) against a local HTTP
 * server, so the real request paths, bodies, PIT lifecycle and search_after cursor are checked without a
 * live engine. One fixture owns the PIT protocol; scenarios both engines share are parameterized by
 * {@link EsDialect} and only the genuine protocol differences are branched.</p>
 */
class EsAdapterHttpTest {

	private MockHttpServer server;
	private String serverUrl;

	@BeforeEach
	void setUp() throws IOException {
		server = new MockHttpServer();
		serverUrl = "http://127.0.0.1:" + server.port();
	}

	@AfterEach
	void tearDown() {
		server.close();
	}

	// ----------------------------------------------------------------------------------
	// Connection report
	// ----------------------------------------------------------------------------------

	static Stream<Arguments> connectionReportCases() {
		return Stream.of(
				Arguments.of(EsDialect.ELASTICSEARCH,
						"{\"version\":{\"number\":\"8.12.2\"},\"cluster_name\":\"es-cluster\"}",
						"8.12.2", "es-cluster", List.of("customers", "orders")),
				Arguments.of(EsDialect.OPENSEARCH,
						"{\"version\":{\"number\":\"2.12.0\"},\"cluster_name\":\"opensearch-cluster\"}",
						"2.12.0", "opensearch-cluster", List.of("orders")),
				// A cluster reporting neither still carries both keys as null, as the shared schema types them.
				Arguments.of(EsDialect.OPENSEARCH, "{}", null, null, List.of()));
	}

	@ParameterizedTest
	@MethodSource("connectionReportCases")
	void connectionReportCarriesTheEngineClusterAndIndices(EsDialect dialect, String root, String version, String cluster,
			List<String> indices) throws Exception {
		server.setHandler(req -> {
			if (isRoot(req)) {
				return ok(root);
			}
			if (request(req, "GET", "/_cat/indices/*")) {
				JSONArray rows = new JSONArray();
				indices.forEach(name -> rows.add(JSONObject.of("index", name)));
				return ok(rows.toJSONString());
			}
			return new MockResponse(404, "{}");
		});

		JSONObject report = probe(dialect);

		assertEquals("search", report.getString("kind"));
		assertEquals(dialect.label(), report.getString("databaseProduct"));
		assertNullable(report, "databaseVersion", version);
		assertNullable(report, "clusterName", cluster);
		assertEquals(indices, report.getJSONArray("indices").toJavaList(String.class));

		RecordedRequest cat = server.requests().stream()
				.filter(req -> request(req, "GET", "/_cat/indices/*")).findFirst().orElseThrow();
		assertTrue(cat.uri().contains("format=json") && cat.uri().contains("h=index")
				&& cat.uri().contains("expand_wildcards=open"), cat.uri());
	}

	@Test
	void connectionReportFailsOnAListingErrorOrARowWithoutAnIndexName() {
		server.setHandler(req -> isRoot(req) ? ok("{}")
				: request(req, "GET", "/_cat/indices/*") ? new MockResponse(500, "{}") : new MockResponse(404, "{}"));
		assertThrows(Exception.class, () -> probe(EsDialect.ELASTICSEARCH));

		server.setHandler(req -> isRoot(req) ? ok("{}")
				: request(req, "GET", "/_cat/indices/*") ? ok("[{\"unexpected\":\"row\"}]") : new MockResponse(404, "{}"));
		assertThrows(Exception.class, () -> probe(EsDialect.ELASTICSEARCH));
	}

	// ----------------------------------------------------------------------------------
	// PIT paging and close
	// ----------------------------------------------------------------------------------

	@ParameterizedTest
	@EnumSource(EsDialect.class)
	void executeDslPagesThroughPitAndClosesTheLatestPitId(EsDialect dialect) throws Exception {
		boolean elastic = dialect == EsDialect.ELASTICSEARCH;
		// Page one returns a full 1000-row page, page two the single remaining row. Elasticsearch may
		// rotate the pit_id per page; OpenSearch answers without one.
		setPitHandler(dialect, "orders", "{\"count\": 1001}", keywordCaps(), req -> searchRequests().size() == 1
				? page(dialect, 0, 1000, elastic ? "pit_2" : null)
				: page(dialect, 1000, 1, null));

		JSONArray rows = execute(dialect, "orders", classDef("orders"));

		assertEquals(1001, rows.size());
		assertEquals("ord_1000", rows.getJSONObject(1000).getString("id"));
		assertEquals(1001L, rows.stream().map(row -> ((JSONObject) row).getString("id")).distinct().count());

		List<JSONObject> searches = searchRequests();
		String sortKey = elastic ? "_shard_doc" : "id";
		assertEquals(2, searches.size());
		assertEquals(sortKey, firstSortKey(searches.get(0)));
		assertNull(searches.get(0).get("search_after"));
		assertEquals(sortKey, firstSortKey(searches.get(1)));
		assertEquals("pit_1", searches.get(0).getJSONObject("pit").getString("id"));
		assertEquals(elastic ? "pit_2" : "pit_1", searches.get(1).getJSONObject("pit").getString("id"));
		// The cursor is page one's last sort value: numeric _shard_doc for Elasticsearch, the business pk for OpenSearch.
		assertEquals(elastic ? List.of(999) : List.of("ord_0999"),
				searches.get(1).getJSONArray("search_after").toJavaList(Object.class));
		assertEquals(List.of(elastic ? "pit_2" : "pit_1"), closedPitIds(closePitPath(dialect)));
		JSONObject close = JSONObject.parseObject(server.requests().stream()
				.filter(req -> request(req, "DELETE", closePitPath(dialect))).findFirst().orElseThrow().body());
		assertEquals(List.of(elastic ? "id" : "pit_id"), new ArrayList<>(close.keySet()));
	}

	@Test
	void searchFailuresCloseTheOpenPit() {
		for (MockResponse failure : List.of(new MockResponse(500, "{\"error\":\"search failed\"}"),
				new MockResponse(200, "{\"pit_id\":\"p1\"}"),
				new MockResponse(200, "{\"hits\":{\"total\":{\"value\":0}}}"))) {
			setPitHandler(EsDialect.ELASTICSEARCH, "orders", "{\"count\": 1}", keywordCaps(), req -> failure);

			EsAdapter adapter = adapter(EsDialect.ELASTICSEARCH, classDef("orders"));
			assertThrows(Exception.class, () -> adapter.executeDsl(singleClassDsl("orders"), "s", null, new ArrayList<>()));
			// A broken page does not adopt its pit_id; the PIT known to be open is the one closed.
			assertEquals(List.of("pit_1"), closedPitIds(closePitPath(EsDialect.ELASTICSEARCH)));
			server.requests().clear();
		}
	}

	// ----------------------------------------------------------------------------------
	// OpenSearch sort field and class name resolution
	// ----------------------------------------------------------------------------------

	static Stream<Arguments> openSearchSortShapes() {
		return Stream.of(
				Arguments.of("keyword", keywordCaps(), "id"),
				Arguments.of("text with .keyword", caps(Map.of("id", "text", "id.keyword", "keyword")), "id.keyword"),
				Arguments.of("text without .keyword", caps(Map.of("id", "text")), null));
	}

	@ParameterizedTest(name = "OpenSearch {0} primary key")
	@MethodSource("openSearchSortShapes")
	void openSearchSortsByTheSortableKeywordShapeOfThePrimaryKey(String shape, String caps, String expectedSortKey)
			throws Exception {
		setPitHandler(EsDialect.OPENSEARCH, "orders", "{\"count\": 1}", caps,
				req -> page(EsDialect.OPENSEARCH, 0, 1, null));
		EsAdapter adapter = adapter(EsDialect.OPENSEARCH, classDef("orders"));

		if (expectedSortKey == null) {
			Exception failure = assertThrows(Exception.class,
					() -> adapter.executeDsl(singleClassDsl("orders"), "s", null, new ArrayList<>()));
			assertTrue(failure.getMessage().contains("sortable"), failure.getMessage());
		} else {
			JSONArray rows = rows(adapter, "orders");
			assertEquals(1, rows.size());
			assertEquals(expectedSortKey, firstSortKey(searchRequests().get(0)));
		}
		// The PIT opened before the sort check is closed in both outcomes.
		assertEquals(List.of("pit_1"), closedPitIds(closePitPath(EsDialect.OPENSEARCH)));
	}

	@Test
	void openSearchResolvesTheClassThroughTheNormalizedIndex() throws Exception {
		// EsNaming lower-cases and turns "/" into "_", so the class name never equals the physical index.
		setPitHandler(EsDialect.OPENSEARCH, "sales_orders", "{\"count\": 1}", keywordCaps(),
				req -> page(EsDialect.OPENSEARCH, 0, 1, null));

		JSONArray rows = execute(EsDialect.OPENSEARCH, "Sales/Orders", classDef("Sales/Orders"));

		assertEquals(1, rows.size());
		assertEquals("id", firstSortKey(searchRequests().get(0)));
	}

	// ----------------------------------------------------------------------------------
	// Fixtures and helpers
	// ----------------------------------------------------------------------------------

	/**
	 * The shared PIT protocol fixture: count, create PIT, _field_caps and close answer on the documented
	 * dialect endpoints; the _search response is delegated so each scenario controls its own page.
	 */
	private void setPitHandler(EsDialect dialect, String index, String count, String caps,
			Function<RecordedRequest, MockResponse> search) {
		server.setHandler(req -> {
			if (request(req, "POST", "/" + index + "/_count")) {
				return ok(count);
			}
			if (request(req, "POST", openPitPath(dialect, index) + "?")) {
				return ok(dialect == EsDialect.ELASTICSEARCH ? JSONObject.of("id", "pit_1").toJSONString()
						: JSONObject.of("pit_id", "pit_1").toJSONString());
			}
			if (request(req, "GET", "/" + index + "/_field_caps?")) {
				return ok(caps);
			}
			if (request(req, "POST", "/_search")) {
				return search.apply(req);
			}
			if (request(req, "DELETE", closePitPath(dialect))) {
				return ok("{\"succeeded\":true}");
			}
			return new MockResponse(404, "{}");
		});
	}

	private DataAdapterConnection connection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(serverUrl);
		return connection;
	}

	private EsAdapter adapter(EsDialect dialect, Map<String, Object> classDef) {
		return new EsAdapter(connection(), Map.of("classDef", List.of(classDef)), dialect);
	}

	private JSONObject probe(EsDialect dialect) throws Exception {
		return new EsAdapter(connection(), Map.of(), dialect).testConnection();
	}

	private JSONArray execute(EsDialect dialect, String dslClass, Map<String, Object> classDef) throws Exception {
		return rows(adapter(dialect, classDef), dslClass);
	}

	private static JSONArray rows(EsAdapter adapter, String dslClass) throws Exception {
		String result = adapter.executeDsl(singleClassDsl(dslClass), "s", null, new ArrayList<>());
		return JSONArray.parseArray(result).getJSONObject(0).getJSONArray("answer");
	}

	private static Map<String, Object> classDef(String className) {
		return Map.of("className", className, "attrs",
				List.of(Map.of("name", "id", "type", "varchar", "primaryKey", true, "enable", true)));
	}

	private static void assertNullable(JSONObject report, String key, String expected) {
		if (expected == null) {
			assertTrue(report.containsKey(key), key);
			assertNull(report.get(key));
		} else {
			assertEquals(expected, report.getString(key));
		}
	}

	private static String keywordCaps() {
		return caps(Map.of("id", "keyword"));
	}

	private static String caps(Map<String, String> types) {
		JSONObject fields = new JSONObject();
		types.forEach((name, type) -> fields.put(name, JSONObject.of(type, JSONObject.of("type", type))));
		return JSONObject.of("fields", fields).toJSONString();
	}

	private static MockResponse ok(String body) {
		return new MockResponse(200, body);
	}

	private static boolean isRoot(RecordedRequest req) {
		return "GET".equals(req.method()) && "/".equals(req.uri());
	}

	/** Matches the method and exact endpoint path, ignoring the query string. */
	private static boolean request(RecordedRequest req, String method, String uriPrefix) {
		String path = req.uri().split("\\?", 2)[0];
		String endpoint = uriPrefix.endsWith("?") ? uriPrefix.substring(0, uriPrefix.length() - 1) : uriPrefix;
		return method.equals(req.method()) && path.equals(endpoint);
	}

	/** The create-PIT path each engine documents; kept in the fixture so a wrong production path fails here. */
	private static String openPitPath(EsDialect dialect, String index) {
		return dialect == EsDialect.ELASTICSEARCH ? "/" + index + "/_pit" : "/" + index + "/_search/point_in_time";
	}

	private static String closePitPath(EsDialect dialect) {
		return dialect == EsDialect.ELASTICSEARCH ? "/_pit" : "/_search/point_in_time";
	}

	/** A page of `count` hits starting at document `offset`; its sort value is the dialect's cursor value. */
	private static MockResponse page(EsDialect dialect, int offset, int count, String nextPitId) {
		JSONArray hits = new JSONArray();
		for (int i = offset; i < offset + count; i++) {
			String id = "ord_" + String.format("%04d", i);
			JSONObject hit = new JSONObject();
			hit.put("_source", JSONObject.of("id", id));
			hit.put("sort", dialect == EsDialect.ELASTICSEARCH ? JSONArray.of(i) : JSONArray.of(id));
			hits.add(hit);
		}
		JSONObject response = new JSONObject();
		if (nextPitId != null) {
			response.put("pit_id", nextPitId);
		}
		response.put("hits", JSONObject.of("hits", hits));
		return ok(response.toJSONString());
	}

	private List<JSONObject> searchRequests() {
		List<JSONObject> bodies = new ArrayList<>();
		for (RecordedRequest req : server.requests()) {
			if (request(req, "POST", "/_search")) {
				bodies.add(JSONObject.parseObject(req.body()));
			}
		}
		return bodies;
	}

	/** The PIT ids carried by this run's close requests, whichever body key the dialect uses. */
	private List<String> closedPitIds(String path) {
		List<String> ids = new ArrayList<>();
		for (RecordedRequest req : server.requests()) {
			if (request(req, "DELETE", path)) {
				JSONObject body = JSONObject.parseObject(req.body());
				ids.addAll(body.containsKey("id") ? List.of(body.getString("id"))
						: body.getJSONArray("pit_id").toJavaList(String.class));
			}
		}
		return ids;
	}

	private static String firstSortKey(JSONObject body) {
		JSONArray sort = body.getJSONArray("sort");
		return sort == null || sort.isEmpty() ? null : sort.getJSONObject(0).keySet().iterator().next();
	}

	private static String singleClassDsl(String className) {
		JSONObject object = JSONObject.of("class", className, "variable", "o", "idx", 0);
		JSONObject output = JSONObject.of("fields",
				JSONArray.of(JSONObject.of("variable", "o", "field", "id", "as", "id")));
		JSONObject graph = JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(object))));
		JSONObject step = JSONObject.of("graph", graph, "output", output);
		return JSONArray.of(JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(step)))).toJSONString();
	}

	static record RecordedRequest(String method, String uri, String body) {}

	static record MockResponse(int statusCode, String body) {}

	static class MockHttpServer implements AutoCloseable {
		private final HttpServer server;
		private final int port;
		private final List<RecordedRequest> requests = new CopyOnWriteArrayList<>();
		private volatile Function<RecordedRequest, MockResponse> handler;

		MockHttpServer() throws IOException {
			this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			this.port = this.server.getAddress().getPort();
			this.server.createContext("/", this::handle);
			this.server.start();
		}

		int port() {
			return port;
		}

		List<RecordedRequest> requests() {
			return requests;
		}

		void setHandler(Function<RecordedRequest, MockResponse> handler) {
			this.handler = handler;
		}

		private void handle(HttpExchange exchange) throws IOException {
			String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
			RecordedRequest req =
					new RecordedRequest(exchange.getRequestMethod(), exchange.getRequestURI().toString(), body);
			requests.add(req);
			MockResponse resp = handler.apply(req);
			byte[] respBytes = resp.body().getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(resp.statusCode(), respBytes.length);
			try (OutputStream os = exchange.getResponseBody()) {
				os.write(respBytes);
			}
		}

		@Override
		public void close() {
			server.stop(0);
		}
	}
}
