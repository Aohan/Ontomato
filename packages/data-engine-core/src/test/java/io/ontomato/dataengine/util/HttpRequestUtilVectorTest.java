package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;

/**
 * A vector condition becomes an id filter on the class's model primary key for every adapter, and the stored vector
 * entries come back as resource URLs whether the adapter returns them as an array (M3) or as the JSON text of a SQL
 * column.
 */
class HttpRequestUtilVectorTest {

	private static final Map<String, Object> PRODUCT = Map.of("className", "/Product", "attrs", List.of(
			Map.of("name", "code", "type", "varchar", "primaryKey", true),
			Map.of("name", "photos", "type", "vector")));

	private static final String WHERE_DSL = """
			[{"problem":"","answer":{"steps":[{
			  "graph":{"patterns":[{"objects":[{"variable":"p","class":"/Product",
			    "conditions":{"vector":{"properties":{"and":[{"field":"photos","query":"red"}]}}}}]}]},
			  "output":{"fields":[{"variable":"p","field":"photos","as":"photos"}]}}]}}]""";

	private static final String SELECT_DSL = """
			[{"problem":"","answer":{"steps":[{
			  "graph":{"patterns":[{"objects":[{"variable":"p","class":"/Product","conditions":{}}]}]},
			  "output":{"fields":[{"variable":"p","field":"photos","as":"photos","query":"red"}]}}]}}]""";

	private static final String SELECT_DSL_NO_CONDITIONS = """
			[{"problem":"","answer":{"steps":[{
			  "graph":{"patterns":[{"objects":[{"variable":"p","class":"/Product"}]}]},
			  "output":{"fields":[{"variable":"p","field":"photos","as":"photos","query":"red"}]}}]}}]""";

	private static final String PLAIN_DSL = """
			[{"problem":"","answer":{"steps":[{
			  "graph":{"patterns":[{"objects":[{"variable":"p","class":"/Product"}]}]},
			  "output":{"fields":[{"variable":"p","field":"code","as":"code"}]}}]}}]""";

	private static final String STORED = "[{\"path\":\"idx/a.png\",\"text\":\"red car\"},{\"path\":\"idx/b.png\",\"text\":\"blue boat\"}]";

	@Test
	void theIdFilterUsesTheClassPrimaryKey() throws Exception {
		Run run = run(WHERE_DSL, STORED);
		assertEquals("code", run.idFilter().getString("field"));
		assertEquals(List.of("P'1"), run.idFilter().getJSONArray("value"));
	}

	@Test
	void anObjectWithoutConditionsReceivesInFilter() throws Exception {
		Run run = run(SELECT_DSL_NO_CONDITIONS, STORED);
		assertEquals("code", run.idFilter().getString("field"));
		assertEquals(List.of("P'1"), run.idFilter().getJSONArray("value"));
	}

	@Test
	void dslWithoutVectorAttributesRemainsCompletelyUnchanged() throws Exception {
		DataAdapter adapter = mock(DataAdapter.class);
		ArgumentCaptor<String> executed = ArgumentCaptor.forClass(String.class);
		when(adapter.executeDsl(executed.capture(), anyString(), any(), any())).thenReturn("[{\"answer\":[{\"code\":\"P1\"}]}]");

		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, adapter, PLAIN_DSL, "s1", true, jsonRule,
				mock(VectorResourceDao.class), mock(UserDataPermission.class), DslExecutionMode.OPTIMIZED, "d1");

		assertEquals(JSON.parseArray(PLAIN_DSL), JSON.parseArray(executed.getValue()));
		assertEquals(false, results[1].failed());
	}

	private VectorResourceDao createRealDaoWithFailingEmbedding(String errorMessage) {
		VectorResourceDao vectorResourceDao = org.mockito.Mockito.spy(new VectorResourceDao());
		org.mockito.Mockito.doReturn(1).when(vectorResourceDao).getResourceTotal(anyString(), anyString(), anyString());
		JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
		EmbeddingService embeddingService = mock(EmbeddingService.class);
		when(embeddingService.embedding(anyString(), anyString())).thenThrow(new RuntimeException(errorMessage));
		ReflectionTestUtils.setField(vectorResourceDao, "jdbcTemplate", jdbcTemplate);
		ReflectionTestUtils.setField(vectorResourceDao, "embeddingService", embeddingService);
		ReflectionTestUtils.setField(vectorResourceDao, "retrievalGate", mock(VectorRetrievalGate.class));
		return vectorResourceDao;
	}

	@Test
	void vectorSearchFailureReturnsErrorWithoutFallback() throws Exception {
		VectorResourceDao vectorResourceDao = createRealDaoWithFailingEmbedding("Vector search down");

		DataAdapter adapter = mock(DataAdapter.class);
		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, adapter, WHERE_DSL, "s1", true, jsonRule,
				vectorResourceDao, mock(UserDataPermission.class), DslExecutionMode.OPTIMIZED, "d1");

		assertTrue(results[1].failed());
		assertTrue(results[1].failure().cause().getMessage().contains("Vector search down"));
		assertTrue(results[1].rawResponse().getString("error").contains("Vector search down"));
		verify(adapter, never()).executeDsl(anyString(), anyString(), any(), any());
	}

	@Test
	void getNodeIdsThrowsOnVectorSearchFailure() {
		VectorResourceDao vectorResourceDao = createRealDaoWithFailingEmbedding("Vector search down");

		DataAdapter adapter = mock(DataAdapter.class);
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		RuntimeException thrown = assertThrows(RuntimeException.class, () ->
				HttpRequestUtil.getNodeIds(adapter, WHERE_DSL, jsonRule, vectorResourceDao,
						mock(UserDataPermission.class), "d1"));
		assertTrue(thrown.getMessage().contains("Vector search down"));
	}

	@Test
	void rowPermissionFailureThrowsDirectlyInsteadOfReturningFailureResult() {
		VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
		DataAdapter adapter = mock(DataAdapter.class);
		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		UserDataPermission permission = mock(UserDataPermission.class);
		when(permission.getRowPermissionMQLByClassName(anyString())).thenAnswer(inv -> {
			throw new RuntimeException("permission lookup error");
		});

		assertThrows(ServiceException.class, () ->
				HttpRequestUtil.executeDsl(dataRagConfig, adapter, PLAIN_DSL, "s1", true, jsonRule,
						vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, "d1"));
	}

	@Test
	void anArrayComesBackAsResourceUrls() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png", "http://card/vectorResource/resource/idx/b.png"),
				run(WHERE_DSL, JSON.parseArray(STORED)).paths());
	}

	@Test
	void aSqlColumnsJsonTextComesBackAsResourceUrls() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png", "http://card/vectorResource/resource/idx/b.png"),
				run(WHERE_DSL, STORED).paths());
	}

	@Test
	void aSelectQueryKeepsOnlyTheMatchedResources() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png"), run(SELECT_DSL, STORED).paths());
	}

	private record Run(String executedDsl, DslExecutionResult result) {
		JSONObject idFilter() {
			JSONObject object = JSON.parseArray(executedDsl).getJSONObject(0).getJSONObject("answer").getJSONArray("steps")
					.getJSONObject(0).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("objects").getJSONObject(0);
			return object.getJSONObject("conditions").getJSONObject("properties").getJSONArray("and").getJSONObject(0);
		}

		List<String> paths() {
			JSONArray photos = result.data().getJSONArray("data").getJSONObject(0)
					.getJSONArray("answer").getJSONObject(0).getJSONArray("photos");
			return photos.stream().map(row -> ((JSONObject) row).getString("path")).toList();
		}
	}

	/** Run one query whose adapter answers the photos column with {@code stored}. */
	private Run run(String dsl, Object stored) throws Exception {
		VectorResource hit = new VectorResource();
		hit.setObjectId("P'1");
		hit.setPath("idx/a.png");
		VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
		when(vectorResourceDao.getResourceTotal("/Product", "photos", "d1")).thenReturn(2);
		when(vectorResourceDao.find(eq("red"), anyInt(), eq("/Product"), eq("photos"), eq("d1"))).thenReturn(List.of(hit));

		DataAdapter adapter = mock(DataAdapter.class);
		JSONObject answerRow = new JSONObject();
		answerRow.put("photos", stored);
		JSONObject answer = new JSONObject();
		answer.put("answer", List.of(answerRow));
		ArgumentCaptor<String> executed = ArgumentCaptor.forClass(String.class);
		when(adapter.executeDsl(executed.capture(), anyString(), any(), any())).thenReturn(JSON.toJSONString(List.of(answer)));

		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, adapter, dsl, "s1", true, jsonRule,
				vectorResourceDao, mock(UserDataPermission.class), DslExecutionMode.OPTIMIZED, "d1");
		return new Run(executed.getValue(), results[1]);
	}
}
