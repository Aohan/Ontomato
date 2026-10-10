package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/** Design 4: one instance graph build for every adapter, through graph-pattern DSL run by the domain's adapter. */
class InstanceGraphBuildTest {
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
        when(adapter.executeDsl(anyString(), anyString(), eq(DslExecutionMode.RAW), any())).thenAnswer(call -> {
            return "[{\"answer\":[{\"pk\":\"1\",\"name\":\"Business name\"},{\"pk\":\"2\",\"name\":\"Isolated\"}]}]";
        });
        ReflectionTestUtils.setField(service, "adminService", admin);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        JSONObject graph = service.cutWholeData("domain", new BusinessConfig());
        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        verify(adapter).executeDsl(query.capture(), anyString(), eq(DslExecutionMode.RAW), any());
        assertTrue(query.getValue().contains("org_name"));
        InstanceGraphIndex index = new InstanceGraphIndex(graph);
        assertEquals(2, index.summary().getIntValue("nodeCount"));
        assertEquals(2, index.summary().getIntValue("isolatedNodeCount"));
        assertEquals(0, index.summary().getIntValue("edgeCount"));
        assertTrue(index.summary().getBooleanValue("complete"));
        assertEquals(1, index.search(JSONObject.of("term", "Business name")).getJSONArray("nodes").size());
        doThrow(new IllegalStateException("Unavailable")).when(adapter).executeDsl(anyString(), anyString(), eq(DslExecutionMode.RAW), any());
        graph = service.cutWholeData("domain", new BusinessConfig());
        assertFalse(graph.getBooleanValue("complete"));
        assertEquals("class:entity", graph.getJSONArray("failures").getString(0));
    }

    @Test void aRelationshipNodeIdIsWhatNodeDetailsReadBack() throws Exception {
        DataServiceImpl service = new DataServiceImpl();
        AdminService admin = mock(AdminService.class);
        DataAdapterRegistry registry = mock(DataAdapterRegistry.class);
        BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
        DataAdapter adapter = mock(DataAdapter.class);
        BusinessConfig businessConfig = new BusinessConfig();
        Map<String, Object> rule = JSONObject.parseObject("""
            {"classlist":["/ns/pump"],"relationship_rule":{"feeds":{"fromclass":"/ns/pump","toclass":"/ns/tank","desc":"feeds"}},
             "classDef":[
              {"className":"/ns/pump","inStarChart":true,"attrs":[{"name":"code","type":"varchar","primaryKey":true},
                {"name":"name","type":"varchar","bizzkey":true}]},
              {"className":"/ns/tank","inStarChart":true,"attrs":[{"name":"id","type":"varchar","primaryKey":true}]}]}
            """);
        when(admin.getJSONRule("domain")).thenReturn(rule);
        when(businessConfigService.get("domain")).thenReturn(businessConfig);
        when(registry.create(eq(businessConfig), any())).thenReturn(adapter);
        when(adapter.executeDsl(anyString(), anyString(), any(), any())).thenAnswer(call -> {
            String dsl = call.getArgument(0);
            return dsl.contains("\"relationship\"")
                    ? "[{\"answer\":[{\"sid\":\"P1\",\"sname\":\"Pump one\",\"tid\":\"T1\",\"tname\":\"T1\"}]}]"
                    : "[{\"answer\":[]}]";
        });
        LangService langService = mock(LangService.class);
        when(langService.get(any(), anyString())).thenAnswer(call -> call.getArgument(1));
        ReflectionTestUtils.setField(service, "adminService", admin);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(service, "langService", langService);
        ReflectionTestUtils.setField(service, "vectorResourceDao", mock(VectorResourceDao.class));
        ReflectionTestUtils.setField(service, "dataRagConfig", new DataRagConfig());

        JSONObject graph = service.cutWholeData("domain", businessConfig);
        assertEquals(JSONObject.of("source", "/ns/pump:P1", "target", "/ns/tank:T1", "type", "feeds", "label", "feeds"),
                graph.getJSONArray("edges").getJSONObject(0));

        service.queryInfoByNode(JSONObject.of("id", "/ns/pump:P1", "class", "/ns/pump"), "en",
                mock(UserDataPermission.class), "domain");
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(adapter, atLeastOnce()).executeDsl(detail.capture(), any(), eq(DslExecutionMode.OPTIMIZED), any());
        JSONObject condition = JSON.parseArray(detail.getValue()).getJSONObject(0).getJSONObject("answer")
                .getJSONArray("steps").getJSONObject(0).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                .getJSONArray("objects").getJSONObject(0).getJSONObject("conditions").getJSONObject("properties");
        assertEquals(JSONObject.of("field", "code", "operator", "=", "value", "P1"), condition);
    }
}
