package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
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

/**
 * Every saved class keeps exactly one enabled varchar primary key: a class is created together with it, and an
 * operation that would break it is refused before the rule is saved. Editing the ontology only edits the model:
 * the domain's adapter may refuse a key, but no class or field is created in the data source.
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
	}

	@Test
	void aNewClassIsSavedWithItsPrimaryKey() throws Exception {
		service.addClass("/ns/pump", "pump_no", "Pump", "A pump", false, false, false, "en", user);

		Map<String, Object> pump = savedClass("/ns/pump");
		assertEquals(List.of(Map.of("name", "pump_no", "showName", "pump_no", "attrDesc", "", "type", "varchar",
				"bizzkey", false, "enable", true, "permissionField", false, "primaryKey", true)), pump.get("attrs"));
		// Design 2: the adapter only checks the name and the key; no class is created in the data source.
		verify(adapter).validateClassNameFormat("/ns/pump");
		verify(adapter).validatePrimaryKeyName("pump_no");
		verifyNoMoreInteractions(adapter);
	}

	@Test
	void addingOrDeletingFieldsClassesAndRelationshipsLeavesTheDataSourceAlone() throws Exception {
		service.addClassAttr("/ns/device", "note", "Note", "", "text", false, true, "en", user);
		service.delClassAttr("/ns/device", "code", "en", user);
		service.addRelationship("owns", "/ns/device", "/ns/device", "", "id", "id", "en", user);
		service.delClass("/ns/device", user);

		// Design 2: these edits only save the model.
		verify(jsonRuleDao, times(4)).save(any(), eq("d1"));
		verifyNoInteractions(adapter);
	}

	@Test
	void aClassWithoutAUsablePrimaryKeyIsRefusedBeforeAnySideEffect() {
		assertRefused("Admin.class.primaryKeyRequired",
				() -> service.addClass("/ns/pump", " ", "Pump", "A pump", false, false, false, "en", user));
		for (String invalid : new String[] {"pump no", "pump\tno", "pump\u0001", "1pump", "pump-no"}) {
			assertRefused("Admin.attr.formatError",
					() -> service.addClass("/ns/pump", invalid, "Pump", "A pump", false, false, false, "en", user));
		}
	}

	@Test
	void aKeyTheAdapterRefusesIsNotSaved() throws Exception {
		// Design 3: which attribute may key a class is the adapter's rule (M3 keys objects by id).
		doThrow(new Exception("refused by adapter")).when(adapter).validatePrimaryKeyName("pump_no");
		assertRefused("refused by adapter",
				() -> service.addClass("/ns/pump", "pump_no", "Pump", "A pump", false, false, false, "en", user));
		doThrow(new Exception("refused by adapter")).when(adapter).validatePrimaryKeyName("code");
		assertRefused("refused by adapter", () -> service.setClassAttrPrimaryKey("/ns/device", "code", "en", user));
	}

	@Test
	void theCurrentPrimaryKeyCannotBeDeletedOrDisabled() {
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
	void aSavedRuleThatBreaksTheInvariantStopsTheNextChangeBeforeItIsSaved() {
		((List<Map<String, Object>>) rule.get("classDef")).add(new java.util.HashMap<>(Map.of(
				"className", "/ns/legacy", "attrs", new ArrayList<>(List.of(Map.of("name", "n", "type", "int", "primaryKey", true))))));

		assertThrows(IllegalArgumentException.class,
				() -> service.addClassAttr("/ns/device", "note", "Note", "", "text", false, true, "en", user));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	private void assertRefused(String messageKey, org.junit.jupiter.api.function.Executable operation) {
		Exception failure = assertThrows(Exception.class, operation);
		assertEquals(messageKey, failure.getMessage());
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
