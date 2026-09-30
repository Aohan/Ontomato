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
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.FakeDataAdapterProvider;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerDataAdapterTest {

	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final BusinessConfigController controller = new BusinessConfigController();

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
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", List.of("url", "user", "password"),
						Map.of("url", "jdbc:postgresql://host:port/db", "user", "postgres")),
				new FakeDataAdapterProvider("duckdb", "DuckDB", List.of("url"), Map.of("url", "jdbc:duckdb:/data/example.duckdb")),
				new FakeDataAdapterProvider("m3", "M3", List.of())), new DataRagConfig());
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
	}

	@Test
	void dataAdaptersListsTheInstalledOnesByLabel() {
		JSONObject ret = controller.dataAdapters();

		assertTrue(ret.getBooleanValue("success"));
		assertEquals(JSON.parseArray("["
				+ "{\"type\":\"duckdb\",\"label\":\"DuckDB\",\"sql\":true,\"fields\":[\"url\"],"
				+ "\"examples\":{\"url\":\"jdbc:duckdb:/data/example.duckdb\"}},"
				+ "{\"type\":\"m3\",\"label\":\"M3\",\"sql\":false,\"fields\":[],\"examples\":{}},"
				+ "{\"type\":\"postgresql\",\"label\":\"PostgreSQL\",\"sql\":true,\"fields\":[\"url\",\"user\",\"password\"],"
				+ "\"examples\":{\"url\":\"jdbc:postgresql://host:port/db\",\"user\":\"postgres\"}}]"),
				JSON.parseArray(JSON.toJSONString(ret.get("data"))));
	}

	@Test
	void useDataAdapterSavesOnlyTheDeclaredFieldsAndSelectsTheType() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"duckdb\",\"url\":\"jdbc:duckdb:/data/a.db\",\"user\":\"u\",\"password\":\"p\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("duckdb", businessConfig.getDataAdapter());
		DataAdapterConnection connection = businessConfig.getDataAdapterConnections().get("duckdb");
		assertEquals("jdbc:duckdb:/data/a.db", connection.getUrl());
		assertNull(connection.getUser());
		assertNull(connection.getPassword());
		verify(businessConfigService).set(businessConfig, "d1");
	}

	@Test
	void useDataAdapterWithoutConnectionFieldsKeepsNoConnection() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject("{\"type\":\"m3\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("m3", businessConfig.getDataAdapter());
		assertFalse(businessConfig.getDataAdapterConnections().containsKey("m3"));
	}

	@Test
	void useDataAdapterRejectsATypeThisEditionDoesNotInstall() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject("{\"type\":\"oracle\",\"url\":\"jdbc:oracle\"}"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("oracle"), ret.getString("message"));
		assertTrue(ret.getString("message").contains("Data adapter not installed in this edition"), ret.getString("message"));
		assertEquals("postgresql", businessConfig.getDataAdapter());
		verify(businessConfigService, never()).set(any(), anyString());
	}
}
