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
    @Test void overviewUsesBoundedDslWithoutCountsOrFullGraphScans() throws Exception {
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
            JSONArray answer = new JSONArray();
            JSONObject row = new JSONObject();
            if (edge) { row.put("source", "1"); row.put("target", "1"); }
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
        // node scan bounded at 50, edge scan bounded at 2001
        JSONObject nodeStep = JSON.parseArray(dsls.get(0)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(50, nodeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        JSONObject edgeStep = JSON.parseArray(dsls.get(1)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(2001, edgeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        assertTrue(edgeStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).containsKey("relationship"));
        // overview never computes aggregate counts
        for (String dslJson : dsls) {
            JSONObject dsl = JSON.parseArray(dslJson).getJSONObject(0);
            for (Object stepObj : dsl.getJSONObject("answer").getJSONArray("steps")) {
                JSONObject output = ((JSONObject) stepObj).getJSONObject("output");
                for (Object fieldObj : output.getJSONArray("fields")) {
                    assertFalse(((JSONObject) fieldObj).containsKey("function"));
                }
            }
        }
        // queries go through the generic DSL adapter, never raw JDBC
        verify(adapter, never()).openConnection();
        assertThrows(IllegalArgumentException.class, () -> LiveInstanceGraph.identifier("entity; drop table entity"));
    }
}
