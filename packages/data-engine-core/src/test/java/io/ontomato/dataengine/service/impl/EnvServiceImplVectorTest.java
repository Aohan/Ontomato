package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
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
import io.ontomato.dataengine.service.VectorResourceService;
import io.ontomato.dataengine.util.HttpRequestUtil;

class EnvServiceImplVectorTest {

	private final EnvServiceImpl envService = new EnvServiceImpl();
	private final AdminService adminService = mock(AdminService.class);
	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final DataAdapterRegistry dataAdapterRegistry = mock(DataAdapterRegistry.class);
	private final DataAdapter dataAdapter = mock(DataAdapter.class);
	private final VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
	private final VectorResourceService vectorResourceService = mock(VectorResourceService.class);
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
		ReflectionTestUtils.setField(envService, "vectorResourceService", vectorResourceService);
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

	/** Builds the test-data zip: data.json with one /Product row, plus the given extra entries. */
	private static InputStream zip(Map<String, Object> row, Map<String, String> entries) throws Exception {
		JSONObject testData = new JSONObject();
		JSONObject objData = new JSONObject();
		objData.put("className", "/Product");
		objData.put("rows", List.of(row));
		testData.put("objDatas", List.of(objData));
		testData.put("relDatas", List.of());
		Map<String, String> all = new LinkedHashMap<>();
		all.put("data.json", testData.toJSONString());
		all.putAll(entries);
		return rawZip(all);
	}

	private static InputStream rawZip(Map<String, String> entries) throws Exception {
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		try (ZipOutputStream zos = new ZipOutputStream(bytes)) {
			for (Map.Entry<String, String> e : entries.entrySet()) {
				zos.putNextEntry(new ZipEntry(e.getKey()));
				zos.write(e.getValue().getBytes(StandardCharsets.UTF_8));
				zos.closeEntry();
			}
		}
		return new ByteArrayInputStream(bytes.toByteArray());
	}

	private static List<Map<String, String>> vector(String path, String text) {
		Map<String, String> item = new LinkedHashMap<>();
		item.put("path", path);
		item.put("text", text);
		return List.of(item);
	}

	private void assertRejectedBeforeAnyWrite(InputStream is, String expectedMessagePart) {
		Exception ex = assertThrows(Exception.class, () -> envService.importTestData(is, "d1"));
		assertTrue(ex.getMessage().contains(expectedMessagePart), ex.getMessage());
		verifyNoInteractions(dataAdapter);
		verifyNoInteractions(vectorResourceDao);
		verifyNoInteractions(vectorResourceService);
	}

	@Test
	void importTestDataWithoutDataJsonIsRejected() throws Exception {
		// A plain JSON upload (the pre-zip format) is not a zip and therefore has no data.json.
		JSONObject legacy = new JSONObject();
		legacy.put("objDatas", List.of());
		legacy.put("relDatas", List.of());
		assertRejectedBeforeAnyWrite(new ByteArrayInputStream(legacy.toJSONString().getBytes(StandardCharsets.UTF_8)), "data.json is not found");
	}

	@Test
	void importTestDataRejectsZipSlipEntry() throws Exception {
		assertRejectedBeforeAnyWrite(rawZip(Map.of("../escape.txt", "x")), "Invalid zip entry path");
	}

	@Test
	void importTestDataRejectsVectorEntryWithEmptyTextBeforeClearing() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/p1.jpg", "  "));
		assertRejectedBeforeAnyWrite(zip(row, Map.of("files/p1.jpg", "img")), "has an empty text");
	}

	@Test
	void importTestDataRejectsVectorPathMissingFromZip() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/missing.jpg", "a red car"));
		assertRejectedBeforeAnyWrite(zip(row, Map.of("files/p1.jpg", "img")), "is not found under files/");
	}

	@Test
	void importTestDataRejectsVectorPathOutsideFilesDirectory() throws Exception {
		// data.json exists in the archive but is not a resource under files/.
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("data.json", "a red car"));
		assertRejectedBeforeAnyWrite(zip(row, Map.of()), "is not found under files/");
	}

	@Test
	void importTestDataRejectsNonArrayVectorValue() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", "vector-content");
		Exception ex = assertThrows(Exception.class, () -> envService.importTestData(zip(row, Map.of()), "d1"));
		verifyNoInteractions(dataAdapter);
		verifyNoInteractions(vectorResourceDao);
		verifyNoInteractions(vectorResourceService);
		assertTrue(ex.getMessage() != null && !ex.getMessage().isEmpty());
	}

	@Test
	void importTestDataClearsVectorResourceForClassVectorAttrs() throws Exception {
		envService.importTestData(zip(Map.of("code", "p1"), Map.of()), "d1");

		verify(vectorResourceDao).clear("/Product", "photos", "d1");
		verify(dataAdapter).deleteObjects(any(), eq(productClassDef), any());
		verify(dataAdapter).insertObjects(any(), eq(productClassDef), any());
		verifyNoInteractions(vectorResourceService);
	}

	@Test
	void importTestDataAttachesInlineVectorAfterInsertingObjectWithoutVectorValue() throws Exception {
		List<VectorResource> attached = new ArrayList<>();
		List<String> attachedBytes = new ArrayList<>();
		when(vectorResourceService.saveAndAttach(any(), any(), any(), eq("d1"))).thenAnswer(inv -> {
			attached.add(inv.getArgument(0));
			attachedBytes.add(new String(((InputStream) inv.getArgument(1)).readAllBytes(), StandardCharsets.UTF_8));
			return inv.getArgument(0);
		});
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/v1.0/p1.JPG", "a red car"));

		envService.importTestData(zip(row, Map.of("files/v1.0/p1.JPG", "image-bytes")), "d1");

		ArgumentCaptor<JSONArray> inserted = ArgumentCaptor.forClass(JSONArray.class);
		InOrder order = inOrder(dataAdapter, vectorResourceDao, vectorResourceService);
		order.verify(dataAdapter).deleteObjects(any(), eq(productClassDef), any());
		order.verify(vectorResourceDao).clear("/Product", "photos", "d1");
		order.verify(dataAdapter).insertObjects(any(), eq(productClassDef), inserted.capture());
		order.verify(vectorResourceService).saveAndAttach(any(), any(), eq("JPG"), eq("d1"));
		assertFalse(inserted.getValue().getJSONObject(0).containsKey("photos"));
		assertEquals("p1", inserted.getValue().getJSONObject(0).getString("code"));
		assertEquals(1, attached.size());
		assertEquals("/Product", attached.get(0).getClassName());
		assertEquals("photos", attached.get(0).getAttrName());
		assertEquals("p1", attached.get(0).getObjectId());
		assertEquals("a red car", attached.get(0).getContent());
		assertEquals("image-bytes", attachedBytes.get(0));
	}

	@Test
	void importTestDataRejectsExtensionlessVectorFileBeforeAnyWrite() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/p1", "a red car"));
		assertRejectedBeforeAnyWrite(zip(row, Map.of("files/p1", "img")), "must have a 1-16 character alphanumeric extension");
	}

	@Test
	void importTestDataRejectsInvalidVectorFileSuffixBeforeAnyWrite() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/p1.tar-gz", "a red car"));
		assertRejectedBeforeAnyWrite(zip(row, Map.of("files/p1.tar-gz", "img")), "must have a 1-16 character alphanumeric extension");
	}

	@Test
	void importTestDataRejectsEmptyVectorFileBeforeAnyWrite() throws Exception {
		Map<String, Object> row = Map.of("code", "p1", "photos", vector("files/p1.jpg", "a red car"));
		assertRejectedBeforeAnyWrite(zip(row, Map.of("files/p1.jpg", "")), "is empty");
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
