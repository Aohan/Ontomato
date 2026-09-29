package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.util.HttpRequestUtil;

/**
 * Every saved class keeps exactly one enabled varchar primary key: a class is created together with it, and an
 * operation that would break it is refused before the rule is saved or any M3 DDL runs.
 */
class AdminServiceImplPrimaryKeyTest {

	private static final String RULE = """
			{"datasetdesc":"","classlist":["/ns/device"],"relationship_rule":{},"classDef":[{"className":"/ns/device","attrs":[
			  {"name":"id","type":"varchar","enable":true,"primaryKey":true},
			  {"name":"code","type":"varchar","enable":true,"primaryKey":false},
			  {"name":"size","type":"int","enable":true,"primaryKey":false},
			  {"name":"old","type":"varchar","enable":false,"primaryKey":false}]}]}""";

	private final AdminServiceImpl service = new AdminServiceImpl();
	private final JSONRuleDao jsonRuleDao = mock(JSONRuleDao.class);
	private final DataAdapter adapter = mock(DataAdapter.class);
	private final User user = mock(User.class);
	private MockedStatic<HttpRequestUtil> m3;
	private JSONObject rule;

	@BeforeEach
	void wire() {
		rule = JSON.parseObject(RULE);
		when(jsonRuleDao.query("d1")).thenReturn(rule);
		when(user.getDomainId()).thenReturn("d1");
		BusinessConfig businessConfig = new BusinessConfig();
		BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		DataAdapterRegistry registry = mock(DataAdapterRegistry.class);
		when(registry.create(eq(businessConfig), any())).thenReturn(adapter);
		LangService langService = mock(LangService.class);
		when(langService.get(any(), anyString())).thenAnswer(call -> call.getArgument(1));
		ReflectionTestUtils.setField(service, "dataRagConfig", new DataRagConfig());
		ReflectionTestUtils.setField(service, "jsonRuleDao", jsonRuleDao);
		ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(service, "langService", langService);
		ReflectionTestUtils.setField(service, "auditLogDao", mock(AuditLogDao.class));
		m3 = mockStatic(HttpRequestUtil.class);
		m3.when(() -> HttpRequestUtil.getExecMQL(any(), anyString())).thenReturn(new JSONArray());
	}

	@AfterEach
	void release() {
		m3.close();
	}

	@Test
	void aNewClassIsSavedWithItsPrimaryKey() throws Exception {
		service.addClass("/ns/pump", "pump_no", "Pump", "A pump", false, false, false, "en", user);

		Map<String, Object> pump = savedClass("/ns/pump");
		assertEquals(List.of(Map.of("name", "pump_no", "showName", "pump_no", "attrDesc", "", "type", "varchar",
				"bizzkey", false, "enable", true, "permissionField", false, "primaryKey", true)), pump.get("attrs"));
		m3.verifyNoInteractions();
	}

	@Test
	void anM3ClassIsCreatedWithItsIdColumnInOneStatement() throws Exception {
		when(adapter.useM3()).thenReturn(true);

		service.addClass("/ns/pump", "id", "Pump", "A pump", false, false, false, "en", user);

		// One DDL: no empty class that is then queried and altered.
		m3.verify(() -> HttpRequestUtil.getExecMQL(any(), anyString()), times(1));
		m3.verify(() -> HttpRequestUtil.getExecMQL(any(), startsWith("create class if not exists /ns/pump ( id varchar ) ")));
		assertEquals("id", ((List<Map<String, Object>>) savedClass("/ns/pump").get("attrs")).get(0).get("name"));
	}

	@Test
	void aClassWithoutAUsablePrimaryKeyIsRefusedBeforeAnySideEffect() {
		assertRefused("Admin.class.primaryKeyRequired",
				() -> service.addClass("/ns/pump", " ", "Pump", "A pump", false, false, false, "en", user));
		for (String invalid : new String[] {"pump no", "pump\tno", "pump\u0001", "1pump", "pump-no"}) {
			assertRefused("Admin.attr.formatError",
					() -> service.addClass("/ns/pump", invalid, "Pump", "A pump", false, false, false, "en", user));
		}
		when(adapter.useM3()).thenReturn(true);
		assertRefused("Admin.class.m3PrimaryKeyId",
				() -> service.addClass("/ns/pump", "pump_no", "Pump", "A pump", false, false, false, "en", user));
	}

	@Test
	void theCurrentPrimaryKeyCannotBeDeletedOrDisabled() {
		when(adapter.useM3()).thenReturn(true);
		assertRefused("Admin.attr.primaryKeyLocked", () -> service.delClassAttr("/ns/device", "id", "en", user));
		assertRefused("Admin.attr.primaryKeyLocked",
				() -> service.setClassAttrDesc("/ns/device", "id", "key", "false", "en", user));
	}

	@Test
	void anyVarcharFieldMayBeDeletedOrDisabled() throws Exception {
		service.setClassAttrDesc("/ns/device", "code", "code", "false", "en", user);
		service.delClassAttr("/ns/device", "code", "en", user);

		verify(jsonRuleDao, times(2)).save(any(), eq("d1"));
		assertEquals(List.of("id", "size", "old"), attrNames(savedClass("/ns/device")));
	}

	@Test
	void switchingThePrimaryKeyMovesTheSingleMark() throws Exception {
		service.setClassAttrPrimaryKey("/ns/device", "code", "en", user);

		Map<String, Object> device = savedClass("/ns/device");
		assertEquals(List.of("code"), ((List<Map<String, Object>>) device.get("attrs")).stream()
				.filter(attr -> Boolean.TRUE.equals(attr.get("primaryKey"))).map(attr -> attr.get("name")).toList());
	}

	@Test
	void anM3PrimaryKeyStaysId() {
		when(adapter.useM3()).thenReturn(true);
		assertRefused("Admin.class.m3PrimaryKeyId", () -> service.setClassAttrPrimaryKey("/ns/device", "code", "en", user));
	}

	@Test
	void onlyAnEnabledVarcharFieldCanBecomeThePrimaryKey() {
		for (String attr : new String[] {"size", "old", "missing"}) {
			assertRefused("Admin.attr.primaryKeyInvalid", () -> service.setClassAttrPrimaryKey("/ns/device", attr, "en", user));
		}
	}

	@Test
	void aFieldIsAddedToAClassThatHasItsPrimaryKey() throws Exception {
		service.addClassAttr("/ns/device", "note", "Note", "", "text", false, true, "en", user);

		assertEquals(List.of("id", "code", "size", "old", "note"), attrNames(savedClass("/ns/device")));
	}

	@Test
	void aSavedRuleThatBreaksTheInvariantStopsTheNextM3ChangeBeforeItsDdl() {
		when(adapter.useM3()).thenReturn(true);
		((List<Map<String, Object>>) rule.get("classDef")).add(new java.util.HashMap<>(Map.of(
				"className", "/ns/legacy", "attrs", new ArrayList<>(List.of(Map.of("name", "n", "type", "int", "primaryKey", true))))));

		assertThrows(IllegalArgumentException.class,
				() -> service.addClassAttr("/ns/device", "note", "Note", "", "text", false, true, "en", user));
		m3.verifyNoInteractions();
		verify(jsonRuleDao, never()).save(any(), any());
	}

	private void assertRefused(String messageKey, org.junit.jupiter.api.function.Executable operation) {
		Exception failure = assertThrows(Exception.class, operation);
		assertEquals(messageKey, failure.getMessage());
		m3.verifyNoInteractions();
		verify(jsonRuleDao, never()).save(any(), any());
	}

	private Map<String, Object> savedClass(String className) {
		ArgumentCaptor<Map<String, Object>> saved = ArgumentCaptor.forClass(Map.class);
		verify(jsonRuleDao, org.mockito.Mockito.atLeastOnce()).save(saved.capture(), eq("d1"));
		return ((List<Map<String, Object>>) saved.getValue().get("classDef")).stream()
				.filter(classDef -> className.equals(classDef.get("className"))).findFirst().orElseThrow();
	}

	private static List<Object> attrNames(Map<String, Object> classDef) {
		return ((List<Map<String, Object>>) classDef.get("attrs")).stream().map(attr -> attr.get("name")).toList();
	}
}
