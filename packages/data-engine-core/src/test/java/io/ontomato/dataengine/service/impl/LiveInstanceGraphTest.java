package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;

class LiveInstanceGraphTest {
    @Test void overviewCountsThenUsesBoundedDslAndSharesStatistics() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        var config = new BusinessConfig(); config.setDataAdapter("postgresql");
        when(configs.get("test")).thenReturn(config);
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
            {"classDef":[{"className":"entity","inStarChart":true,"attrs":[
              {"name":"id","primaryKey":true},{"name":"name","bizzkey":true}]}],
             "relationship_rule":{"parent":{"fromclass":"entity","toclass":"entity","fromField":"parent_id","toField":"id"}}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        List<String> dsls = new ArrayList<>();
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            String dslJson = call.getArgument(0);
            dsls.add(dslJson);
            JSONObject dsl = JSON.parseArray(dslJson).getJSONObject(0);
            JSONObject step = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            boolean edge = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).containsKey("relationship");
            boolean count = "count".equals(step.getJSONObject("output").getJSONArray("fields").getJSONObject(0).getString("function"));
            JSONArray answer = new JSONArray();
            JSONObject row = new JSONObject();
            if (count) { row.put("cnt", 1); }
            else if (edge) { row.put("source", "1"); row.put("target", "1"); }
            else { row.put("pk", "1"); row.put("name", "Entity"); }
            answer.add(row);
            JSONObject envelope = new JSONObject();
            envelope.put("answer", answer);
            return JSONArray.of(envelope).toJSONString();
        });
        var service = new LiveInstanceGraph(admin, configs, adapters);
        var response = service.query("summary", new JSONObject(), "test");
        assertTrue(response.getBooleanValue("success"));
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewNodes").size());
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewEdges").size());
        assertEquals(1, response.getJSONObject("data").getLongValue("nodeCount"));
        assertEquals(1, response.getJSONObject("data").getJSONArray("classes").getJSONObject(0).getIntValue("sampleCount"));
        // Counts precede bounded node and edge reads.
        JSONObject nodeStep = JSON.parseArray(dsls.get(1)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(1, nodeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        JSONObject edgeStep = JSON.parseArray(dsls.get(2)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(2001, edgeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        assertTrue(edgeStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).containsKey("relationship"));
        assertEquals(1, service.query("statistics", new JSONObject(), "test").getJSONObject("data").getLongValue("nodeCount"));
        assertEquals(3, dsls.size());
        // Queries go through the generic DSL adapter, never raw JDBC.
        verify(adapter, never()).openConnection();
        assertThrows(IllegalArgumentException.class, () -> LiveInstanceGraph.identifier("entity; drop table entity"));
    }

    @Test void overviewReadsProportionalQuotasAndSkipsEmptyClasses() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        when(configs.get("test")).thenReturn(new BusinessConfig());
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
            {"classDef":[
              {"className":"A","inStarChart":true,"attrs":[{"name":"id","primaryKey":true}]},
              {"className":"B","inStarChart":true,"attrs":[{"name":"id","primaryKey":true}]},
              {"className":"Empty","inStarChart":true,"attrs":[{"name":"id","primaryKey":true}]}],
             "relationship_rule":{}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        var limits = new java.util.LinkedHashMap<String, Integer>();
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            JSONObject step = JSON.parseArray(call.getArgument(0, String.class)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            String type = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                    .getJSONArray("objects").getJSONObject(0).getString("class");
            JSONObject output = step.getJSONObject("output");
            JSONArray rows = new JSONArray();
            if ("count".equals(output.getJSONArray("fields").getJSONObject(0).getString("function"))) {
                rows.add(JSONObject.of("cnt", type.equals("A") ? 8000 : type.equals("B") ? 2000 : 0));
            } else {
                int limit = output.getJSONObject("limit").getIntValue("count");
                limits.put(type, limit);
                for (int i = 0; i < limit; i++) rows.add(JSONObject.of("pk", String.valueOf(i)));
            }
            return JSONArray.of(JSONObject.of("answer", rows)).toJSONString();
        });
        JSONObject result = new LiveInstanceGraph(admin, configs, adapters).query("summary", new JSONObject(), "test");
        assertTrue(result.getBooleanValue("success"), result.toJSONString());
        assertEquals(java.util.Map.of("A", 400, "B", 100), limits);
        assertEquals(500, result.getJSONObject("data").getJSONArray("overviewNodes").size());
        assertEquals(10000, result.getJSONObject("data").getLongValue("nodeCount"));
    }
}
