package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterProvider;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerTestDataAdapterTest {

	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final BusinessConfigController controller = new BusinessConfigController();
	private final StubProvider duckdb = new StubProvider("duckdb", List.of("url"));
	private final StubProvider postgresql = new StubProvider("postgresql", List.of("url", "user", "password"));
	private final StubProvider m3 = new StubProvider("m3", List.of("url", "company", "user", "password"));

	@BeforeEach
	void setUp() {
		User user = mock(User.class);
		when(user.getDomainId()).thenReturn("d1");
		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		businessConfig.setDataAdapter("postgresql");
		businessConfig.getDataAdapterConnections().clear();
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(duckdb, postgresql, m3), new DataRagConfig());
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
	}

	@Test
	void successTakesOnlyTheDeclaredFieldsAndLeavesTheSavedConfigAlone() throws Exception {
		JSONObject data = JSON.parseObject("{\"elapsedMs\":12,\"tables\":[]}");
		when(duckdb.adapter.testConnection()).thenReturn(data);

		JSONObject ret = controller.testDataAdapter(JSON.parseObject(
				"{\"type\":\"duckdb\",\"url\":\"jdbc:duckdb:/data/a.db\",\"user\":\"u\",\"password\":\"p\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals(data, ret.getJSONObject("data"));
		assertEquals("jdbc:duckdb:/data/a.db", duckdb.lastConnection.getUrl());
		assertNull(duckdb.lastConnection.getUser());
		assertNull(duckdb.lastConnection.getPassword());
		assertEquals("postgresql", businessConfig.getDataAdapter());
		assertTrue(businessConfig.getDataAdapterConnections().isEmpty());
		verify(businessConfigService, never()).set(any(), anyString());
	}

	@Test
	void uninstalledTypesFailWithoutCreatingAnAdapter() {
		JSONObject ret = controller.testDataAdapter(JSON.parseObject("{\"type\":\"oracle\",\"url\":\"jdbc:oracle\"}"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("oracle"), ret.getString("message"));
		assertTrue(ret.getString("message").contains("Data adapter not installed in this edition"), ret.getString("message"));
		assertFalse(duckdb.created);
		assertFalse(postgresql.created);
	}

	@Test
	void anM3TestReceivesItsFourCandidateFields() throws Exception {
		JSONObject data = JSON.parseObject("{\"elapsedMs\":3,\"tables\":[]}");
		when(m3.adapter.testConnection()).thenReturn(data);

		JSONObject ret = controller.testDataAdapter(JSON.parseObject(
				"{\"type\":\"m3\",\"url\":\"m3.test:8080\",\"company\":\"acme\",\"user\":\"admin\",\"password\":\"pw\"}"));

		// Design 5: M3 is tested through the same endpoint with the values on the page.
		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("m3.test:8080", m3.lastConnection.getUrl());
		assertEquals("acme", m3.lastConnection.getCompany());
		assertEquals("admin", m3.lastConnection.getUser());
		assertEquals("pw", m3.lastConnection.getPassword());
		verify(businessConfigService, never()).set(any(), anyString());
	}

	@Test
	void driverFailuresSurfaceTheDriverMessage() throws Exception {
		when(postgresql.adapter.testConnection())
				.thenThrow(new SQLException("Connection refused", "08001", 101));

		JSONObject ret = controller.testDataAdapter(JSON.parseObject(
				"{\"type\":\"postgresql\",\"url\":\"jdbc:postgresql://gone:5432/db\",\"user\":\"u\",\"password\":\"p\"}"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("Connection refused"), ret.getString("message"));
		assertTrue(ret.getString("message").contains("08001"), ret.getString("message"));
		assertTrue(ret.getString("message").contains("101"), ret.getString("message"));
		assertEquals("u", postgresql.lastConnection.getUser());
		verify(businessConfigService, never()).set(any(), anyString());
	}

	/** A provider that hands out one stubbed adapter and records what it was given. */
	static class StubProvider implements DataAdapterProvider {
		private final String type;
		private final List<String> fields;
		final DataAdapter adapter = mock(DataAdapter.class);
		DataAdapterConnection lastConnection;
		boolean created;

		StubProvider(String type, List<String> fields) {
			this.type = type;
			this.fields = fields;
		}

		@Override
		public String type() {
			return type;
		}

		@Override
		public String label() {
			return type;
		}

		@Override
		public boolean sql() {
			return !fields.isEmpty();
		}

		@Override
		public List<String> connectionFields() {
			return fields;
		}

		@Override
		public Map<String, String> connectionExamples() {
			return Map.of();
		}

		@Override
		public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
			created = true;
			lastConnection = connection;
			return adapter;
		}
	}
}
