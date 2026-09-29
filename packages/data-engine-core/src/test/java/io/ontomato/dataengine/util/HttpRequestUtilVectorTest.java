package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.HttpRequestUtil.M3Mode;

/**
 * A vector condition becomes an id filter on the key the executing adapter actually matches objects by, and the
 * stored vector entries come back as resource URLs whether the adapter returns them as an array (M3) or as the
 * JSON text of a SQL column.
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

	private static final String STORED = "[{\"path\":\"idx/a.png\",\"text\":\"red car\"},{\"path\":\"idx/b.png\",\"text\":\"blue boat\"}]";

	@Test
	void aRelationalAdapterFiltersByTheClassPrimaryKey() throws Exception {
		Run run = run(false, WHERE_DSL, STORED);
		assertEquals("code", run.idFilter().getString("field"));
		assertEquals(List.of("P'1"), run.idFilter().getJSONArray("value"));
	}

	@Test
	void m3FiltersByItsObjectId() throws Exception {
		assertEquals("id", run(true, WHERE_DSL, JSON.parseArray(STORED)).idFilter().getString("field"));
	}

	@Test
	void anM3ArrayComesBackAsResourceUrls() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png", "http://card/vectorResource/resource/idx/b.png"),
				run(true, WHERE_DSL, JSON.parseArray(STORED)).paths());
	}

	@Test
	void aSqlColumnsJsonTextComesBackAsResourceUrls() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png", "http://card/vectorResource/resource/idx/b.png"),
				run(false, WHERE_DSL, STORED).paths());
	}

	@Test
	void aSelectQueryKeepsOnlyTheMatchedResources() throws Exception {
		assertEquals(List.of("http://card/vectorResource/resource/idx/a.png"), run(false, SELECT_DSL, STORED).paths());
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
	private Run run(boolean useM3, String dsl, Object stored) throws Exception {
		VectorResource hit = new VectorResource();
		hit.setObjectId("P'1");
		hit.setPath("idx/a.png");
		VectorResourceDao vectorResourceDao = mock(VectorResourceDao.class);
		when(vectorResourceDao.getResourceTotal("/Product", "photos", "d1")).thenReturn(2);
		when(vectorResourceDao.find(eq("red"), anyInt(), eq("/Product"), eq("photos"), eq("d1"))).thenReturn(List.of(hit));

		DataAdapter adapter = mock(DataAdapter.class);
		when(adapter.useM3()).thenReturn(useM3);
		JSONObject answerRow = new JSONObject();
		answerRow.put("photos", stored);
		JSONObject answer = new JSONObject();
		answer.put("answer", List.of(answerRow));
		ArgumentCaptor<String> executed = ArgumentCaptor.forClass(String.class);
		when(adapter.executeDsl(executed.capture(), anyString(), any(), any())).thenReturn(JSON.toJSONString(List.of(answer)));

		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(PRODUCT));

		DslExecutionResult[] results = HttpRequestUtil.getM3Data(dataRagConfig, adapter, dsl, "s1", true, jsonRule,
				vectorResourceDao, mock(UserDataPermission.class), M3Mode.V1, "d1");
		return new Run(executed.getValue(), results[1]);
	}
}
