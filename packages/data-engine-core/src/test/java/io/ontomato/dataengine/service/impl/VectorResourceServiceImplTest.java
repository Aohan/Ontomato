package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;

/** Uploading or deleting a vector resource keeps the object's vector attribute in step, through the domain's adapter. */
class VectorResourceServiceImplTest {

	private static final Map<String, Object> PRODUCT = Map.of("className", "/Product", "attrs", List.of(
			Map.of("name", "code", "type", "varchar", "primaryKey", true),
			Map.of("name", "photos", "type", "vector")));

	private final VectorResourceServiceImpl service = new VectorResourceServiceImpl();
	private final VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
	private final DataAdapterRegistry registry = mock(DataAdapterRegistry.class);
	private final DataAdapter adapter = mock(DataAdapter.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

	@BeforeEach
	void wire() throws Exception {
		JSONRuleDao jsonRuleDao = mock(JSONRuleDao.class);
		when(jsonRuleDao.query("d1")).thenReturn(jsonRule);
		BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		when(registry.create(businessConfig, jsonRule)).thenReturn(adapter);
		when(adapter.queryVectorAttr(PRODUCT, "photos", "P1"))
				.thenReturn(JSON.parseArray("[{\"path\":\"idx/old.png\",\"text\":\"old\"}]"));
		ReflectionTestUtils.setField(service, "vectorResourceDao", vectorResourceDao);
		ReflectionTestUtils.setField(service, "jsonRuleDao", jsonRuleDao);
		ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
	}

	@Test
	void uploadAppendsTheOriginalTextUnderTheRelationalPrimaryKey() throws Exception {
		InputStream file = new ByteArrayInputStream(new byte[] {1});
		when(vectorResourceDao.insert(any(), eq(file), eq("png"), eq("d1"))).thenAnswer(call -> {
			VectorResource saved = call.getArgument(0);
			saved.setPath("idx/new.png");
			saved.setContent("cleaned");
			return saved;
		});

		service.saveAndAttach(resource("a red car"), file, "png", "d1");

		JSONObject[] update = capturedUpdate();
		assertEquals(JSON.parseArray("[{\"path\":\"idx/old.png\",\"text\":\"old\"},{\"path\":\"idx/new.png\",\"text\":\"a red car\"}]"),
				update[0].getJSONArray("photos"));
		assertEquals(where("code", "P1"), update[1]);
	}

	@Test
	void deleteDropsTheEntryUnderTheM3ObjectId() throws Exception {
		when(adapter.useM3()).thenReturn(true);

		service.deleteAndDetach("/Product", "photos", "P1", "idx/old.png", "d1");

		verify(vectorResourceDao).delete("/Product", "photos", "P1", "idx/old.png", "d1");
		JSONObject[] update = capturedUpdate();
		assertEquals(JSON.parseArray("[]"), update[0].getJSONArray("photos"));
		assertEquals(where("id", "P1"), update[1]);
	}

	@Test
	void textOnlyUploadSavesTxtResourceAndAttaches() throws Exception {
		when(vectorResourceDao.insert(any(), eq(null), eq(null), eq("d1"))).thenAnswer(call -> {
			VectorResource saved = call.getArgument(0);
			saved.setPath("idx/text.txt");
			saved.setContent("cleaned");
			return saved;
		});

		service.saveAndAttach(resource("pure text"), null, null, "d1");

		JSONObject[] update = capturedUpdate();
		assertEquals(JSON.parseArray("[{\"path\":\"idx/old.png\",\"text\":\"old\"},{\"path\":\"idx/text.txt\",\"text\":\"pure text\"}]"),
				update[0].getJSONArray("photos"));
		assertEquals(where("code", "P1"), update[1]);
	}

	@Test
	void attachFailureRollsBackSavedResourceAndThrows() throws Exception {
		when(vectorResourceDao.insert(any(), any(), any(), eq("d1"))).thenAnswer(call -> {
			VectorResource saved = call.getArgument(0);
			saved.setPath("idx/new.png");
			return saved;
		});
		doThrow(new RuntimeException("adapter down")).when(adapter).updateObjects(any(), any(), any(), any());

		assertThrows(RuntimeException.class, () -> service.saveAndAttach(resource("text"), null, null, "d1"));

		verify(vectorResourceDao).delete("/Product", "photos", "P1", "idx/new.png", "d1");
	}

	@Test
	void rollbackFailureIsSuppressedWhenAttachFails() throws Exception {
		when(vectorResourceDao.insert(any(), any(), any(), eq("d1"))).thenAnswer(call -> {
			VectorResource saved = call.getArgument(0);
			saved.setPath("idx/new.png");
			return saved;
		});
		doThrow(new RuntimeException("adapter down")).when(adapter).updateObjects(any(), any(), any(), any());
		RuntimeException rollbackEx = new RuntimeException("rollback down");
		doThrow(rollbackEx).when(vectorResourceDao).delete("/Product", "photos", "P1", "idx/new.png", "d1");

		RuntimeException thrown = assertThrows(RuntimeException.class, () -> service.saveAndAttach(resource("text"), null, null, "d1"));
		assertTrue(List.of(thrown.getSuppressed()).contains(rollbackEx));
	}

	@Test
	void nonExistentClassDefIsRejectedBeforeSave() {
		VectorResource res = resource("text");
		res.setClassName("/NonExistent");

		assertThrows(IllegalArgumentException.class, () -> service.saveAndAttach(res, null, null, "d1"));
		verifyNoInteractions(vectorResourceDao);
	}

	@Test
	void nonExistentObjectUploadFailsWithoutLeavingFileOrRecord() throws Exception {
		when(adapter.queryVectorAttr(PRODUCT, "photos", "P1"))
				.thenThrow(new IllegalArgumentException("Object P1 of class /Product does not exist"));

		InputStream file = new ByteArrayInputStream(new byte[] {1});
		assertThrows(IllegalArgumentException.class, () -> service.saveAndAttach(resource("text"), file, "png", "d1"));
		verifyNoInteractions(vectorResourceDao);
	}

	@Test
	void nonExistentObjectDeleteFailsWithoutTouchingDao() throws Exception {
		when(adapter.queryVectorAttr(PRODUCT, "photos", "P1"))
				.thenThrow(new IllegalArgumentException("Object P1 of class /Product does not exist"));

		assertThrows(IllegalArgumentException.class,
				() -> service.deleteAndDetach("/Product", "photos", "P1", "idx/old.png", "d1"));
		verifyNoInteractions(vectorResourceDao);
	}

	@Test
	void aRejectedDeleteLeavesTheObjectUntouched() throws Exception {
		doThrow(new IllegalArgumentException("not found")).when(vectorResourceDao)
				.delete("/Product", "photos", "P1", "idx/other.png", "d1");

		assertThrows(IllegalArgumentException.class,
				() -> service.deleteAndDetach("/Product", "photos", "P1", "idx/other.png", "d1"));
		verify(adapter, never()).updateObjects(any(), any(), any(), any());
	}

	private VectorResource resource(String content) {
		VectorResource resource = new VectorResource();
		resource.setClassName("/Product");
		resource.setAttrName("photos");
		resource.setObjectId("P1");
		resource.setContent(content);
		return resource;
	}

	private JSONObject[] capturedUpdate() throws Exception {
		ArgumentCaptor<JSONObject> setValues = ArgumentCaptor.forClass(JSONObject.class);
		ArgumentCaptor<JSONObject> where = ArgumentCaptor.forClass(JSONObject.class);
		verify(adapter).updateObjects(eq(null), eq(PRODUCT), setValues.capture(), where.capture());
		return new JSONObject[] {setValues.getValue(), where.getValue()};
	}

	private static JSONObject where(String field, String value) {
		JSONObject where = new JSONObject();
		where.put("field", field);
		where.put("operator", "=");
		where.put("value", value);
		return where;
	}
}
