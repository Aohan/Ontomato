package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ProductionEnvironmentLoginPolicy;
import io.ontomato.dataengine.service.SchemaImportAuthorization;
import io.ontomato.dataengine.service.SchemaPermissionService;
import io.ontomato.dataengine.util.HttpRequestUtil;

class EnvServiceImplVectorTest {

	private final EnvServiceImpl envService = new EnvServiceImpl();
	private final AdminService adminService = mock(AdminService.class);
	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final DataAdapterRegistry dataAdapterRegistry = mock(DataAdapterRegistry.class);
	private final DataAdapter dataAdapter = mock(DataAdapter.class);
	private final VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
	private final SchemaPermissionService schemaPermissionService = mock(SchemaPermissionService.class);
	private final ProductionEnvironmentLoginPolicy productionLoginPolicy = mock(ProductionEnvironmentLoginPolicy.class);
	private final DataRagConfig dataRagConfig = new DataRagConfig();
	private final User user = mock(User.class);

	private MockedStatic<HttpRequestUtil> mockedHttp;

	private final Map<String, Object> productClassDef = Map.of(
			"className", "/Product",
			"attrs", List.of(
					Map.of("name", "code", "type", "varchar", "primaryKey", true),
					Map.of("name", "photos", "type", "vector")
			)
	);

	@BeforeEach
	void setUp() {
		when(user.getDomainId()).thenReturn("d1");
		dataRagConfig.setProductionEnvUrl("http://prod");
		dataRagConfig.setProductionEnvUser("admin");

		ReflectionTestUtils.setField(envService, "adminService", adminService);
		ReflectionTestUtils.setField(envService, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(envService, "dataAdapterRegistry", dataAdapterRegistry);
		ReflectionTestUtils.setField(envService, "vectorResourceDao", vectorResourceDao);
		ReflectionTestUtils.setField(envService, "schemaPermissionService", schemaPermissionService);
		ReflectionTestUtils.setField(envService, "productionEnvironmentLoginPolicy", productionLoginPolicy);
		ReflectionTestUtils.setField(envService, "dataRagConfig", dataRagConfig);

		when(businessConfigService.get("d1")).thenReturn(new BusinessConfig());
		when(dataAdapterRegistry.create(any(), any())).thenReturn(dataAdapter);
		when(adminService.getJSONRule("d1")).thenReturn(Map.of(
				"classDef", List.of(productClassDef),
				"relationship_rule", Map.of()
		));
	}

	@AfterEach
	void tearDown() {
		if (mockedHttp != null) {
			mockedHttp.close();
		}
	}

	@Test
	void importTestDataWithNonEmptyVectorPropertyIsRejected() throws Exception {
		JSONObject testData = new JSONObject();
		JSONObject objData = new JSONObject();
		objData.put("className", "/Product");
		objData.put("rows", List.of(Map.of("code", "p1", "photos", "vector-content")));
		testData.put("objDatas", List.of(objData));
		testData.put("relDatas", List.of());

		ByteArrayInputStream is = new ByteArrayInputStream(testData.toJSONString().getBytes(StandardCharsets.UTF_8));

		Exception ex = assertThrows(Exception.class, () -> envService.importTestData(is, "d1"));
		assertTrue(ex.getMessage().contains("vector properties can only be written via the upload interface"), ex.getMessage());
		verifyNoInteractions(dataAdapter);
		verifyNoInteractions(vectorResourceDao);
	}

	@Test
	void importTestDataClearsVectorResourceForClassVectorAttrs() throws Exception {
		JSONObject testData = new JSONObject();
		JSONObject objData = new JSONObject();
		objData.put("className", "/Product");
		objData.put("rows", List.of(Map.of("code", "p1")));
		testData.put("objDatas", List.of(objData));
		testData.put("relDatas", List.of());

		ByteArrayInputStream is = new ByteArrayInputStream(testData.toJSONString().getBytes(StandardCharsets.UTF_8));

		envService.importTestData(is, "d1");

		verify(vectorResourceDao).clear("/Product", "photos", "d1");
		verify(dataAdapter).deleteObjects(any(), eq(productClassDef), any());
		verify(dataAdapter).insertObjects(any(), eq(productClassDef), any());
	}

	@Test
	void importSchemaClearsAllVectorResourcesForDomain() throws Exception {
		when(productionLoginPolicy.shouldLogin(anyString())).thenReturn(false);

		JSONObject prodSchema = new JSONObject();
		prodSchema.put("success", true);
		JSONObject schemaData = new JSONObject();
		schemaData.put("classDefs", List.of(
				new JSONObject(Map.of(
						"className", "/ns/Product",
						"attrs", List.of(new JSONObject(Map.of("name", "id", "type", "varchar", "primaryKey", true)))
				))
		));
		prodSchema.put("data", schemaData);

		mockedHttp = mockStatic(HttpRequestUtil.class);
		mockedHttp.when(() -> HttpRequestUtil.getProductionEnv(eq("http://prod/admin/getSchema"), any()))
				.thenReturn(prodSchema.toJSONString());

		when(schemaPermissionService.prepareImport(user)).thenReturn(mock(SchemaImportAuthorization.class));
		when(adminService.getJSONRule("d1")).thenReturn(Map.of(
				"classDef", List.of(Map.of("className", "/ns/Product", "attrs", List.of(Map.of("name", "id", "primaryKey", true)))),
				"relationship_rule", Map.of()
		));

		envService.importSchema(user);

		verify(vectorResourceDao).clearByDomain("d1");
		verify(dataAdapter).createNamespace("ns");
	}
}
