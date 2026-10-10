package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSONObject;

class InstanceGraphIndexTest {
    @Test void fiftyThousandInstancesKeepInitialResponseAggregatedAndNeighborhoodBounded() {
        com.alibaba.fastjson2.JSONArray nodes = new com.alibaba.fastjson2.JSONArray();
        com.alibaba.fastjson2.JSONArray edges = new com.alibaba.fastjson2.JSONArray();
        for (int i = 0; i < 50000; i++) {
            JSONObject node = new JSONObject();
            node.put("id", "C:" + i);
            node.put("class", "C");
            node.put("name", "Instance " + i);
            nodes.add(node);
            JSONObject edge = new JSONObject();
            edge.put("source", "C:0");
            edge.put("target", "C:" + i);
            edges.add(edge);
        }
        JSONObject graph = new JSONObject();
        graph.put("nodes", nodes);
        graph.put("edges", edges);
        InstanceGraphIndex index = new InstanceGraphIndex(graph);
        assertEquals(50000, index.summary().getIntValue("nodeCount"));
        assertEquals(50000, index.summary().getIntValue("edgeCount"));
        assertEquals(1, index.summary().getJSONArray("classes").size());
        JSONObject page = index.neighborhood(JSONObject.parseObject("{\"id\":\"C:0\",\"limit\":100}"));
        assertEquals(100, page.getJSONArray("edges").size());
        assertTrue(page.getJSONArray("nodes").size() <= 101);
        assertEquals(100, page.getIntValue("nextOffset"));
    }

    private InstanceGraphIndex index() {
        return new InstanceGraphIndex(JSONObject.parseObject("""
            {"nodes":[
              {"id":"root","class":"virtual_root"},
              {"id":"A:1","class":"A","name":"Alpha"},
              {"id":"B:1","class":"B","name":"Beta"},
              {"id":"B:2","class":"B","name":"Other"},
              {"id":"C:1","class":"C","name":"Isolated"}],
             "edges":[{"source":"root","target":"A:1"},
              {"source":"A:1","target":"B:1"},
              {"source":"B:2","target":"A:1"},
              {"source":"B:1","target":"B:2"}]}
            """));
    }

    @Test void summaryCountsRealGraphAndWeakComponentsWithoutReturningInstances() {
        JSONObject summary = index().summary();
        assertEquals(4, summary.getIntValue("nodeCount"));
        assertEquals(3, summary.getIntValue("edgeCount"));
        assertEquals(2, summary.getIntValue("componentCount"));
        assertEquals(1, summary.getIntValue("isolatedNodeCount"));
        assertEquals(3, summary.getIntValue("largestComponentSize"));
        assertFalse(summary.containsKey("nodes"));
    }

    @Test void searchIsCaseInsensitiveBoundedAndClassFiltered() {
        InstanceGraphIndex index = index();
        JSONObject result = index.search(JSONObject.parseObject("{\"term\":\"b\",\"limit\":1,\"class\":\"B\"}"));
        assertEquals("B:1", result.getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertTrue(result.getBooleanValue("hasMore"));
        assertEquals(index.version, result.getString("version"));
    }

    @Test void neighborhoodPaginatesBothDirectionsAndIncludesAllEndpoints() {
        InstanceGraphIndex index = index();
        JSONObject request = JSONObject.parseObject("{\"id\":\"A:1\",\"limit\":1}");
        JSONObject first = index.neighborhood(request);
        assertEquals(2, first.getIntValue("total"));
        assertEquals(2, first.getJSONArray("nodes").size());
        assertEquals(1, first.getIntValue("nextOffset"));
        request.put("offset", 1);
        JSONObject second = index.neighborhood(request);
        assertNull(second.get("nextOffset"));
        assertNotEquals(first.getJSONArray("edges"), second.getJSONArray("edges"));
        request.put("limit", 10000);
        assertThrows(IllegalArgumentException.class, () -> index.neighborhood(request));
    }
}
