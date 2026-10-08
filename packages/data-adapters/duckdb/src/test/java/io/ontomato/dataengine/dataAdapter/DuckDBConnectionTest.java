package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.alibaba.fastjson2.JSONObject;

/**
 * The DuckDB connection test runs against the real DuckDB driver: a file database
 * lists its table and view, a missing file fails without creating anything, and
 * in-memory URLs skip the file check. Query and write paths are untouched.
 */
class DuckDBConnectionTest {

	@TempDir
	Path dir;

	private DuckDBAdapter adapterFor(String url) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		return new DuckDBAdapter(connection, null);
	}

	@Test
	void aFileDatabaseListsItsTableAndView() throws Exception {
		String url = "jdbc:duckdb:" + dir.resolve("shop.duckdb");
		try (Connection setup = DriverManager.getConnection(url);
				Statement statement = setup.createStatement()) {
			statement.execute("CREATE TABLE orders(id INTEGER PRIMARY KEY, name VARCHAR)");
			statement.execute("CREATE VIEW v_sales AS SELECT id, name FROM orders");
		}

		JSONObject report = adapterFor(url).testConnection();

		assertEquals("DuckDB", report.getString("databaseProduct"));
		assertEquals("shop", report.getString("catalog"));
		assertEquals("main", report.getString("schema"));
		assertEquals(Set.of("orders:TABLE", "v_sales:VIEW"),
				report.getJSONArray("tables").stream()
						.map(JSONObject.class::cast)
						.map(table -> table.getString("name") + ":" + table.getString("type"))
						.collect(Collectors.toSet()));
		assertTrue(report.getLongValue("elapsedMs") >= 0);
	}

	@Test
	void aMissingFileFailsWithoutCreatingAnything() {
		Path missing = dir.resolve("absent.duckdb");

		Exception failure = null;
		try {
			adapterFor("jdbc:duckdb:" + missing).testConnection();
		} catch (Exception e) {
			failure = e;
		}

		assertTrue(failure != null, "expected the connection test to fail");
		assertTrue(DataAdapterConnectionTester.failureMessage(failure).contains("does not exist"),
				failure.getMessage());
		assertFalse(Files.exists(missing));
	}

	@Test
	void inMemoryDatabasesSkipTheFileCheck() throws Exception {
		for (String url : new String[] { "jdbc:duckdb:", "jdbc:duckdb::memory:" }) {
			JSONObject report = adapterFor(url).testConnection();

			assertEquals("DuckDB", report.getString("databaseProduct"));
			assertEquals("memory", report.getString("catalog"));
			assertEquals("main", report.getString("schema"));
			assertTrue(report.getJSONArray("tables").isEmpty());
		}
	}
}
