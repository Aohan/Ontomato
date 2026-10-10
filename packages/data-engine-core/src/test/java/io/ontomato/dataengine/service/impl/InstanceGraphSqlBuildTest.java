package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;

class InstanceGraphSqlBuildTest {
    @Test void independentClassScanKeepsUnconnectedRecordsAndBusinessNames() throws Exception {
        DataServiceImpl service = new DataServiceImpl();
        AdminService admin = mock(AdminService.class);
        DataAdapterRegistry registry = mock(DataAdapterRegistry.class);
        DataAdapter adapter = mock(DataAdapter.class);
        Map<String, Object> rule = JSONObject.parseObject("""
            {"classlist":["entity"],"classDef":[{"className":"entity","inStarChart":true,
             "attrs":[{"name":"id","primaryKey":true,"bizzkey":true},
                      {"name":"org_name","bizzkey":true}]}],"relationship_rule":{}}
            """);
        when(admin.getJSONRule("domain")).thenReturn(rule);
        when(registry.create(any(), any())).thenReturn(adapter);
        when(adapter.executeDsl(anyString(), anyString(), isNull(), any())).thenAnswer(call -> {
            return "[{\"answer\":[{\"pk\":\"1\",\"name\":\"Business name\"},{\"pk\":\"2\",\"name\":\"Isolated\"}]}]";
        });
        ReflectionTestUtils.setField(service, "adminService", admin);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        JSONObject graph = ReflectionTestUtils.invokeMethod(service, "cutWholeDataBySql", "domain", new BusinessConfig());
        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        verify(adapter).executeDsl(query.capture(), anyString(), isNull(), any());
        assertTrue(query.getValue().contains("org_name"));
        InstanceGraphIndex index = new InstanceGraphIndex(graph);
        assertEquals(2, index.summary().getIntValue("nodeCount"));
        assertEquals(2, index.summary().getIntValue("isolatedNodeCount"));
        assertEquals(0, index.summary().getIntValue("edgeCount"));
        assertTrue(index.summary().getBooleanValue("complete"));
        assertEquals(1, index.search(JSONObject.of("term", "Business name")).getJSONArray("nodes").size());
        doThrow(new IllegalStateException("Unavailable")).when(adapter).executeDsl(anyString(), anyString(), isNull(), any());
        graph = ReflectionTestUtils.invokeMethod(service, "cutWholeDataBySql", "domain", new BusinessConfig());
        assertFalse(graph.getBooleanValue("complete"));
        assertEquals("class:entity", graph.getJSONArray("failures").getString(0));
    }
}
