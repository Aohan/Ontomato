package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONObject;

class DataAdapterConnectionTesterTest {

	private final DataAdapter adapter = mock(DataAdapter.class);
	private final Connection connection = mock(Connection.class);
	private final DatabaseMetaData meta = mock(DatabaseMetaData.class);
	private final DataAdapterConnectionTester tester = new DataAdapterConnectionTester();

	@BeforeEach
	void openConnection() throws Exception {
		when(adapter.openConnection()).thenReturn(connection);
		when(connection.isValid(anyInt())).thenReturn(true);
		when(connection.getMetaData()).thenReturn(meta);
		when(meta.getDatabaseProductName()).thenReturn("AcmeDB");
		when(meta.getDatabaseProductVersion()).thenReturn("1.0");
		when(meta.getDriverName()).thenReturn("Acme JDBC Driver");
		when(meta.getDriverVersion()).thenReturn("2.0");
		ResultSet noRows = mock(ResultSet.class);
		when(noRows.next()).thenReturn(false);
		when(meta.getTables(eq("shop"), any(), eq("%"), isNull())).thenReturn(noRows);
	}

	@Test
	void aSchemaDatabasePassesWithItsSchemaAndCatalog() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(true);
		when(connection.getCatalog()).thenReturn("shop");
		when(connection.getSchema()).thenReturn("public");

		JSONObject report = tester.test(adapter);

		assertEquals("AcmeDB", report.getString("databaseProduct"));
		assertEquals("1.0", report.getString("databaseVersion"));
		assertEquals("Acme JDBC Driver", report.getString("driverName"));
		assertEquals("2.0", report.getString("driverVersion"));
		assertEquals("shop", report.getString("catalog"));
		assertEquals("public", report.getString("schema"));
		assertTrue(report.getLongValue("elapsedMs") >= 0);
		verify(connection).close();
	}

	@Test
	void aSchemaDatabaseWithoutACurrentSchemaFails() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(true);
		when(connection.getCatalog()).thenReturn("shop");
		when(connection.getSchema()).thenReturn(null);

		Exception failure = assertThrows(Exception.class, () -> tester.test(adapter));

		assertTrue(DataAdapterConnectionTester.failureMessage(failure).contains("schema"),
				failure.getMessage());
		verify(connection).close();
	}

	@Test
	void aCatalogDatabasePassesOnItsCatalog() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(false);
		when(connection.getCatalog()).thenReturn("shop");
		when(connection.getSchema()).thenReturn(null);

		JSONObject report = tester.test(adapter);

		assertEquals("shop", report.getString("catalog"));
		assertNull(report.get("schema"));
		verify(connection).close();
	}

	@Test
	void aCatalogDatabaseWithoutACurrentDatabaseFails() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(false);
		when(connection.getCatalog()).thenReturn(null);

		Exception failure = assertThrows(Exception.class, () -> tester.test(adapter));

		assertTrue(DataAdapterConnectionTester.failureMessage(failure).contains("database"),
				failure.getMessage());
	}

	@Test
	void anInvalidConnectionFails() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(true);
		when(connection.getCatalog()).thenReturn("shop");
		when(connection.getSchema()).thenReturn("public");
		when(connection.isValid(anyInt())).thenReturn(false);

		Exception failure = assertThrows(Exception.class, () -> tester.test(adapter));

		assertTrue(DataAdapterConnectionTester.failureMessage(failure).contains("not valid"),
				failure.getMessage());
		verify(connection).close();
	}

	@Test
	void driverTableTypeNamesAreNormalizedAndSystemObjectsSkipped() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(true);
		when(connection.getCatalog()).thenReturn("shop");
		when(connection.getSchema()).thenReturn("public");
		ResultSet rows = mock(ResultSet.class);
		when(rows.next()).thenReturn(true, true, true, true, true, true, true, true, false);
		when(rows.getString("TABLE_NAME")).thenReturn("orders", "v_sales", "legacy", "parts", "remote", "mview",
				"sys_tab", "seq", "tmp");
		when(rows.getString("TABLE_TYPE")).thenReturn("TABLE", "VIEW", "BASE TABLE", "PARTITIONED TABLE",
				"FOREIGN TABLE", "MATERIALIZED VIEW", "SYSTEM TABLE", "SEQUENCE", "INDEX");
		when(meta.getTables(eq("shop"), eq("public"), eq("%"), isNull())).thenReturn(rows);

		JSONObject report = tester.test(adapter);

		assertEquals(Set.of("orders:TABLE", "v_sales:VIEW", "legacy:TABLE", "parts:TABLE", "remote:TABLE", "mview:VIEW"),
				report.getJSONArray("tables").stream()
						.map(JSONObject.class::cast)
						.map(table -> table.getString("name") + ":" + table.getString("type"))
						.collect(Collectors.toSet()));
	}

	@Test
	void normalizeTableTypeMapsOnlyTablesAndViews() {
		assertEquals("TABLE", DataAdapterConnectionTester.normalizeTableType("TABLE"));
		assertEquals("TABLE", DataAdapterConnectionTester.normalizeTableType("base table"));
		assertEquals("TABLE", DataAdapterConnectionTester.normalizeTableType("PARTITIONED TABLE"));
		assertEquals("TABLE", DataAdapterConnectionTester.normalizeTableType("foreign table"));
		assertEquals("VIEW", DataAdapterConnectionTester.normalizeTableType("VIEW"));
		assertEquals("VIEW", DataAdapterConnectionTester.normalizeTableType("materialized view"));
		assertNull(DataAdapterConnectionTester.normalizeTableType("SYSTEM TABLE"));
		assertNull(DataAdapterConnectionTester.normalizeTableType("SEQUENCE"));
		assertNull(DataAdapterConnectionTester.normalizeTableType(null));
	}

	@Test
	void schemaWildcardsAreEscapedWhileTheCatalogPassesThrough() throws Exception {
		when(meta.supportsSchemasInTableDefinitions()).thenReturn(true);
		when(connection.getCatalog()).thenReturn("my%db");
		when(connection.getSchema()).thenReturn("a_b");
		when(meta.getSearchStringEscape()).thenReturn("\\");
		ResultSet noRows = mock(ResultSet.class);
		when(noRows.next()).thenReturn(false);
		when(meta.getTables(eq("my%db"), eq("a\\_b"), eq("%"), isNull())).thenReturn(noRows);

		JSONObject report = tester.test(adapter);

		assertEquals("my%db", report.getString("catalog"));
		assertEquals("a_b", report.getString("schema"));
		verify(meta).getTables(eq("my%db"), eq("a\\_b"), eq("%"), isNull());
	}

	@Test
	void driverErrorsCarryEveryCauseWithSqlStateAndVendorCode() {
		SQLException driver = new SQLException("Connection refused", "08001", 101, new IOException("Broken pipe"));

		String message = DataAdapterConnectionTester.failureMessage(driver);

		assertTrue(message.contains("Connection refused"), message);
		assertTrue(message.contains("08001"), message);
		assertTrue(message.contains("101"), message);
		assertTrue(message.contains("Broken pipe"), message);
	}

	@Test
	void aTimeoutFailsAtOnceWhileTheProbeClosesItsLateConnection() throws Exception {
		DataAdapterConnectionTester impatient = new DataAdapterConnectionTester(200);
		Connection late = mock(Connection.class);
		when(adapter.openConnection()).thenAnswer(invocation -> {
			// A driver that ignores interruption and connects late.
			long connectedAt = System.currentTimeMillis() + 2000;
			while (System.currentTimeMillis() < connectedAt) {
				try {
					Thread.sleep(50);
				} catch (InterruptedException ignored) {
					Thread.currentThread().interrupt();
				}
			}
			return late;
		});

		long startedAt = System.currentTimeMillis();
		Exception failure = assertThrows(Exception.class, () -> impatient.test(adapter));
		long waited = System.currentTimeMillis() - startedAt;

		assertTrue(failure.getMessage().contains("timed out"), failure.getMessage());
		assertTrue(waited < 1500, "the timeout must return without waiting for the connection: " + waited);
		verify(late, org.mockito.Mockito.timeout(5000)).close();
	}
}
