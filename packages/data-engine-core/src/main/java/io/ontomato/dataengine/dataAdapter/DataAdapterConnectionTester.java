package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * Tests one data adapter's connection: opens it through the adapter, validates
 * it, and reports the database, the current catalog/schema and the user tables.
 * The whole test runs on a dedicated thread with a fixed timeout; the probe thread
 * closes every connection it opened through try-with-resources, so a late connection
 * is closed by the probe itself. No JVM-global timeout is touched.
 */
public class DataAdapterConnectionTester {

	/** Fixed upper bound of one connection test. */
	public static final long TIMEOUT_MILLIS = 15000L;

	private static final int VALID_TIMEOUT_SECONDS = 5;

	private final long timeoutMillis;

	public DataAdapterConnectionTester() {
		this(TIMEOUT_MILLIS);
	}

	/** A shorter timeout keeps the timeout tests fast; production uses the fixed bound above. */
	DataAdapterConnectionTester(long timeoutMillis) {
		this.timeoutMillis = timeoutMillis;
	}

	/** @return the connection report; every failure throws with the composed driver message */
	public JSONObject test(DataAdapter adapter) throws Exception {
		ExecutorService executor = Executors.newSingleThreadExecutor(task -> {
			Thread thread = new Thread(task);
			thread.setDaemon(true);
			return thread;
		});
		try {
			Future<JSONObject> future = executor.submit(probe(adapter));
			try {
				return future.get(timeoutMillis, TimeUnit.MILLISECONDS);
			} catch (TimeoutException timeout) {
				future.cancel(true);
				throw new SQLException("Connection test timed out after " + timeoutMillis + " ms");
			} catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
				throw new SQLException("Connection test was interrupted");
			} catch (java.util.concurrent.ExecutionException failed) {
				Throwable cause = failed.getCause();
				if (cause instanceof Exception exception) {
					throw exception;
				}
				throw new SQLException("Connection test failed: " + cause);
			}
		} finally {
			executor.shutdownNow();
		}
	}

	private Callable<JSONObject> probe(DataAdapter adapter) {
		return () -> {
			long startNanos = System.nanoTime();
			try (Connection connection = adapter.openConnection()) {
				if (!connection.isValid(VALID_TIMEOUT_SECONDS)) {
					throw new SQLException("The database connection is not valid");
				}
				DatabaseMetaData meta = connection.getMetaData();
				String catalog = connection.getCatalog();
				String schema = connection.getSchema();
				if (meta.supportsSchemasInTableDefinitions()) {
					if (schema == null || schema.isEmpty()) {
						throw new SQLException(
								"The connection is not mapped to any schema (the current schema may not exist)");
					}
				} else if (catalog == null || catalog.isEmpty()) {
					throw new SQLException("The connection is not mapped to any database");
				}
				JSONObject report = new JSONObject();
				report.put("databaseProduct", meta.getDatabaseProductName());
				report.put("databaseVersion", meta.getDatabaseProductVersion());
				report.put("driverName", meta.getDriverName());
				report.put("driverVersion", meta.getDriverVersion());
				report.put("catalog", catalog);
				report.put("schema", schema);
				report.put("tables", listTables(meta, catalog, schema));
				report.put("elapsedMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos));
				return report;
			}
		};
	}

	private JSONArray listTables(DatabaseMetaData meta, String catalog, String schema) throws SQLException {
		JSONArray tables = new JSONArray();
		try (ResultSet rows = meta.getTables(catalog, escapePattern(schema, meta.getSearchStringEscape()), "%", null)) {
			while (rows.next()) {
				String type = normalizeTableType(rows.getString("TABLE_TYPE"));
				if (type != null) {
					JSONObject table = new JSONObject();
					table.put("name", rows.getString("TABLE_NAME"));
					table.put("type", type);
					tables.add(table);
				}
			}
		}
		return tables;
	}

	/**
	 * The schema pattern of getTables is a LIKE pattern: escape its wildcards so a schema
	 * literally named a_b does not also match axb. The catalog argument is passed through.
	 */
	static String escapePattern(String value, String escape) {
		if (value == null || escape == null || escape.isEmpty()) {
			return value;
		}
		return value.replace(escape, escape + escape).replace("%", escape + "%").replace("_", escape + "_");
	}

	/**
	 * Driver table type names vary; partitioned and foreign tables read like plain tables
	 * and materialized views like views. System objects, indexes, sequences and
	 * temporary tables match nothing and are skipped.
	 */
	static String normalizeTableType(String tableType) {
		if (tableType == null) {
			return null;
		}
		return switch (tableType.toUpperCase(Locale.ROOT)) {
			case "TABLE", "BASE TABLE", "PARTITIONED TABLE", "FOREIGN TABLE" -> "TABLE";
			case "VIEW", "MATERIALIZED VIEW" -> "VIEW";
			default -> null;
		};
	}

	/** Every layer of the cause chain contributes its message; SQL layers add SQLState and vendor code. */
	public static String failureMessage(Throwable failure) {
		List<String> layers = new ArrayList<>();
		for (Throwable layer = failure; layer != null; layer = layer.getCause()) {
			String message = layer.getMessage();
			if (message == null || message.isBlank()) {
				message = layer.toString();
			}
			if (layer instanceof SQLException sql && (sql.getSQLState() != null || sql.getErrorCode() != 0)) {
				StringBuilder annotated = new StringBuilder(message);
				if (sql.getSQLState() != null) {
					annotated.append(" [SQLState: ").append(sql.getSQLState()).append("]");
				}
				annotated.append(" [error code: ").append(sql.getErrorCode()).append("]");
				message = annotated.toString();
			}
			layers.add(message);
		}
		return String.join("; caused by: ", layers);
	}
}
