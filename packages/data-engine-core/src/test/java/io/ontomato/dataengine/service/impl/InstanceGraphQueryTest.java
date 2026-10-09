package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

class InstanceGraphQueryTest {
    private Map<String, Object> rule() {
        return Map.of("classDef", List.of(
                Map.of("className", "Order", "inStarChart", true, "attrs", List.of(Map.of("name", "code", "type", "varchar", "primaryKey", true), Map.of("name", "title", "type", "varchar", "bizzkey", true))),
                Map.of("className", "Item", "inStarChart", true, "attrs", List.of(Map.of("name", "id", "type", "varchar", "primaryKey", true)))),
                "relationship_rule", Map.of("has", Map.of("fromclass", "Order", "toclass", "Item", "fromField", "code", "toField", "orderCode")));
    }

    private InstanceGraphQuery query(boolean m3, InstanceGraphQuery.Executor executor) {
        DataAdapter adapter = mock(DataAdapter.class);
        when(adapter.useM3()).thenReturn(m3);
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        return new InstanceGraphQuery(rule(), adapter, permission, executor);
    }

    @Test
    void sqlOutgoingUsesRelationMappingPrimaryKeyFilterAndBoundedPagination() throws Exception {
        List<JSONObject> dsls = new ArrayList<>();
        InstanceGraphQuery query = query(false, dsl -> {
            dsls.add(dsl);
            return JSONArray.of(JSONObject.of("sid", "1:part", "sname", "Order", "tid", "2", "tname", "Item"),
                    JSONObject.of("sid", "1:part", "tid", "3"));
        });
        JSONObject page = query.neighbors(JSONObject.of("id", "Order:1:part", "class", "Order", "limit", 1));
        assertEquals("Item:2", page.getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertEquals("Order:1:part", page.getJSONArray("edges").getJSONObject(0).getString("source"));
        assertEquals("0:1", page.getString("nextCursor"));
        JSONObject step = dsls.get(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
        JSONObject properties = pattern.getJSONArray("objects").getJSONObject(0).getJSONObject("conditions").getJSONObject("properties");
        assertEquals("code", properties.getString("field"));
        assertEquals("1:part", properties.getString("value"));
        assertEquals("has", pattern.getJSONArray("relationship").getJSONObject(0).getJSONArray("type").getString(0));
        assertEquals(2, step.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        query.neighbors(JSONObject.of("id", "Order:1:part", "class", "Order", "limit", 1, "cursor", page.getString("nextCursor")));
        assertEquals(1, dsls.get(1).getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output").getJSONObject("limit").getIntValue("offset"));
    }

    @Test
    void incomingKeepsEdgeDirectionAndM3Identity() throws Exception {
        InstanceGraphQuery query = query(true, dsl -> {
            JSONObject objects = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            assertEquals("Item:2", objects.getJSONArray("objects").getJSONObject(1).getJSONObject("conditions").getJSONObject("properties").getString("value"));
            return JSONArray.of(JSONObject.of("sid", "Order:1", "tid", "Item:2"));
        });
        JSONObject page = query.neighbors(JSONObject.of("id", "Item:2", "class", "Item", "direction", "in"));
        assertFalse(page.getBooleanValue("hasMore"));
        assertEquals("Order:1", page.getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertEquals("Item:2", page.getJSONArray("edges").getJSONObject(0).getString("target"));
    }

    @Test
    void instanceSearchHasStableSortAndServerLimit() throws Exception {
        InstanceGraphQuery query = query(false, dsl -> {
            JSONObject step = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            assertEquals(101, step.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
            assertEquals("code", step.getJSONObject("output").getJSONObject("sort").getJSONArray("fields").getJSONObject(0).getString("field"));
            return JSONArray.of(JSONObject.of("id", "1", "name", "Order"));
        });
        JSONObject result = query.instances(JSONObject.of("class", "Order", "search", "order", "limit", 10000));
        assertEquals("Order:1", result.getJSONArray("nodes").getJSONObject(0).getString("id"));
        assertFalse(result.getBooleanValue("hasMore"));
    }

    @Test
    void rejectsUnavailableClassesAndMalformedCursorsBeforeQuerying() {
        InstanceGraphQuery.Executor executor = mock(InstanceGraphQuery.Executor.class);
        InstanceGraphQuery query = query(false, executor);
        assertThrows(IllegalArgumentException.class, () -> query.instances(JSONObject.of("class", "Unknown")));
        assertThrows(IllegalArgumentException.class, () -> query.neighbors(JSONObject.of("class", "Order", "id", "wrong")));
        assertThrows(IllegalArgumentException.class, () -> query.neighbors(JSONObject.of("class", "Order", "id", "Order:1", "cursor", "-1:0")));
        verifyNoInteractions(executor);
    }

    @Test
    void unavailableNeighborClassIsNotQueried() throws Exception {
        DataAdapter adapter = mock(DataAdapter.class);
        UserDataPermission permission = new UserDataPermission();
        var fields = new io.ontomato.dataengine.service.sys.bean.permission.FieldPermission("Order");
        fields.getVisibleFields().add("title");
        permission.addFieldPermission(fields);
        InstanceGraphQuery.Executor executor = mock(InstanceGraphQuery.Executor.class);
        InstanceGraphQuery query = new InstanceGraphQuery(rule(), adapter, permission, executor);
        assertFalse(query.neighbors(JSONObject.of("class", "Order", "id", "Order:1")).getBooleanValue("hasMore"));
        assertThrows(IllegalArgumentException.class, () -> query.instances(JSONObject.of("class", "Item")));
        verifyNoInteractions(executor);
    }

    @Test
    void numericSqlIdentityIsValidatedBeforeReachingAdapter() {
        Map<String, Object> rule = Map.of("classDef", List.of(
                Map.of("className", "Order", "inStarChart", true, "attrs", List.of(Map.of("name", "code", "type", "int", "primaryKey", true))),
                Map.of("className", "Item", "inStarChart", true, "attrs", List.of(Map.of("name", "id", "type", "int", "primaryKey", true)))),
                "relationship_rule", Map.of("has", Map.of("fromclass", "Order", "toclass", "Item")));
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        InstanceGraphQuery.Executor executor = mock(InstanceGraphQuery.Executor.class);
        InstanceGraphQuery query = new InstanceGraphQuery(rule, mock(DataAdapter.class), permission, executor);
        assertThrows(NumberFormatException.class, () -> query.neighbors(JSONObject.of("class", "Order", "id", "Order:1 OR 1=1")));
        verifyNoInteractions(executor);
    }
}
