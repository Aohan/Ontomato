package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;

class LegacyDataAdapterConnectionsTest {

	// legacy key, legacy field prefix, adapter type
	private static final String[][] LEGACY = {
			{ "mysqlDataAdapterProperties", "mysql", "mysql" },
			{ "pgsqlDataAdapterProperties", "pgsql", "postgresql" },
			{ "oracleDataAdapterProperties", "oracle", "oracle" },
			{ "sqlServerDataAdapterProperties", "sqlServer", "sqlserver" },
			{ "db2DataAdapterProperties", "db2", "db2" },
			{ "gaussDBDataAdapterProperties", "gaussDB", "gaussdb" },
			{ "duckDBDataAdapterProperties", "duckdb", "duckdb" },
			{ "dmDataAdapterProperties", "dm", "dm" },
	};

	@Test
	void everyLegacyPropertyObjectBecomesTheConnectionOfItsType() {
		for (String[] legacy : LEGACY) {
			JSONObject properties = new JSONObject();
			properties.put(legacy[1] + "Url", "jdbc:" + legacy[2]);
			properties.put(legacy[1] + "User", legacy[2] + "-user");
			properties.put(legacy[1] + "Password", legacy[2] + "-password");
			JSONObject stored = new JSONObject();
			stored.put("dataAdapter", legacy[2]);
			stored.put(legacy[0], properties);

			assertTrue(LegacyDataAdapterConnections.migrate(stored), legacy[0]);

			assertFalse(stored.containsKey(legacy[0]), legacy[0]);
			JSONObject connection = stored.getJSONObject("dataAdapterConnections").getJSONObject(legacy[2]);
			assertEquals("jdbc:" + legacy[2], connection.getString("url"));
			assertEquals(legacy[2] + "-user", connection.getString("user"));
			assertEquals(legacy[2] + "-password", connection.getString("password"));
			assertEquals(legacy[2], stored.getString("dataAdapter"));
		}
	}

	@Test
	void allLegacyObjectsOfOneRecordMigrateTogetherAndNullOnesAreDropped() {
		JSONObject stored = new JSONObject();
		for (String[] legacy : LEGACY) {
			JSONObject properties = new JSONObject();
			properties.put(legacy[1] + "Url", "jdbc:" + legacy[2]);
			stored.put(legacy[0], properties);
		}
		stored.put("dmDataAdapterProperties", null);

		assertTrue(LegacyDataAdapterConnections.migrate(stored));

		JSONObject connections = stored.getJSONObject("dataAdapterConnections");
		assertEquals(LEGACY.length - 1, connections.size());
		assertNull(connections.get("dm"));
		for (String[] legacy : LEGACY) {
			assertFalse(stored.containsKey(legacy[0]), legacy[0]);
		}
	}

	@Test
	void aRecordAlreadyInTheNewFormatIsLeftAlone() {
		String content = "{\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{\"postgresql\":{\"url\":\"jdbc:pg\",\"user\":\"u\",\"password\":\"p\"}}}";
		JSONObject stored = JSON.parseObject(content);

		assertFalse(LegacyDataAdapterConnections.migrate(stored));
		assertEquals(JSON.parseObject(content), stored);
	}

	@Test
	void theDaoWritesTheMigratedRecordBackAndBindsIt() {
		JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
		when(jdbcTemplate.queryForObject(anyString(), eq(String.class), eq("d1"))).thenReturn(
				"{\"models\":[],\"dataAdapter\":\"mysql\",\"mysqlDataAdapterProperties\":{\"mysqlUrl\":\"jdbc:mysql\",\"mysqlUser\":\"u\",\"mysqlPassword\":\"p\"}}");
		BusinessConfigDao dao = new BusinessConfigDao();
		ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbcTemplate);

		BusinessConfig config = dao.query("d1");

		assertEquals("jdbc:mysql", config.getDataAdapterConnections().get("mysql").getUrl());
		assertEquals("u", config.getDataAdapterConnections().get("mysql").getUser());
		ArgumentCaptor<String> written = ArgumentCaptor.forClass(String.class);
		verify(jdbcTemplate).update(anyString(), written.capture(), eq("d1"));
		JSONObject rewritten = JSON.parseObject(written.getValue());
		assertFalse(rewritten.containsKey("mysqlDataAdapterProperties"));
		assertEquals("p", rewritten.getJSONObject("dataAdapterConnections").getJSONObject("mysql").getString("password"));
	}

	@Test
	void theDaoDoesNotWriteANewFormatRecord() {
		JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
		when(jdbcTemplate.queryForObject(anyString(), eq(String.class), eq("d1"))).thenReturn(
				"{\"models\":[],\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{}}");
		BusinessConfigDao dao = new BusinessConfigDao();
		ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbcTemplate);

		assertEquals("postgresql", dao.query("d1").getDataAdapter());
		verify(jdbcTemplate, never()).update(anyString(), anyString(), anyString());
	}
}
