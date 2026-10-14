package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * The L1 gate sits on the one shared entry, so a contradictory DSL is rejected before any adapter is
 * asked to render it — the same door ABC, the legacy pipeline and MCP all pass through.
 */
class HttpRequestUtilGrammarTest {

	private static final Map<String, Object> SENSOR = Map.of("className", "/Sensor", "attrs", List.of(
			Map.of("name", "id", "type", "varchar", "primaryKey", true),
			Map.of("name", "name", "type", "varchar"),
			Map.of("name", "reading", "type", "bucket")));

	private static String timeseriesDsl(String field) {
		return """
				[{"problem":"","answer":{"steps":[{"graph":{"patterns":[{"objects":[{"variable":"s","class":"/Sensor",
				  "conditions":{"timeseries":{"properties":{"and":[{"field":"%s",
				    "conditions":[{"metric":"name","value":"load"}]}]}}}}]}]},
				  "output":{"fields":[{"variable":"s","field":"id","as":"id"}]}}]}}]""".formatted(field);
	}

	private DslExecutionResult[] run(DataAdapter adapter, String dsl) {
		DataRagConfig dataRagConfig = new DataRagConfig();
		dataRagConfig.setCardBaseUrl("http://card");
		Map<String, Object> jsonRule = Map.of("classDef", List.of(SENSOR));
		return HttpRequestUtil.executeDsl(dataRagConfig, adapter, dsl, "s1", true, jsonRule,
				mock(VectorResourceDao.class), mock(UserDataPermission.class), DslExecutionMode.OPTIMIZED, "d1");
	}

	@Test
	void timeseriesOnANonBucketFieldIsRejectedBeforeTheAdapterRuns() throws Exception {
		DataAdapter adapter = mock(DataAdapter.class);

		DslExecutionResult[] results = run(adapter, timeseriesDsl("name"));

		assertTrue(results[1].failed());
		String message = results[1].failure().cause().getMessage();
		assertTrue(message.contains("DSL rejected by the execution contract"), message);
		assertTrue(message.contains("INVALID_GRAMMAR"), message);
		assertTrue(message.contains("conditions.timeseries"), message);
		verify(adapter, never()).executeDsl(anyString(), anyString(), any(), any());
	}

	@Test
	void timeseriesOnABucketFieldReachesTheAdapter() throws Exception {
		DataAdapter adapter = mock(DataAdapter.class);
		when(adapter.executeDsl(anyString(), anyString(), any(), any()))
				.thenReturn("[{\"answer\":[{\"id\":\"S1\"}],\"mqls\":[]}]");

		DslExecutionResult[] results = run(adapter, timeseriesDsl("reading"));

		assertFalse(results[1].failed());
		assertEquals("S1",
				results[1].data().getJSONArray("data").getJSONObject(0).getJSONArray("answer")
						.getJSONObject(0).getString("id"));
	}
}
