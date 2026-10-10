package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;

class LiveInstanceGraphTest {
    @Test void overviewUsesBoundedQueriesWithoutCountsOrFullGraphScans() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        var connection = mock(Connection.class);
        var config = new BusinessConfig(); config.setDataAdapter("postgresql");
        when(configs.get("test")).thenReturn(config);
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
            {"classDef":[{"className":"entity","inStarChart":true,"attrs":[
              {"name":"id","primaryKey":true},{"name":"name","bizzkey":true}]}],
             "relationship_rule":{"parent":{"fromclass":"entity","toclass":"entity","fromField":"parent_id","toField":"id"}}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        when(adapter.openConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(mock(Statement.class));
        List<String> queries = new ArrayList<>();
        when(connection.prepareStatement(anyString())).thenAnswer(call -> {
            String sql = call.getArgument(0); queries.add(sql);
            var statement = mock(PreparedStatement.class);
            var result = mock(ResultSet.class); var metadata = mock(ResultSetMetaData.class);
            when(statement.executeQuery()).thenReturn(result); when(result.getMetaData()).thenReturn(metadata);
            when(metadata.getColumnCount()).thenReturn(2);
            boolean edge = sql.contains(" JOIN ");
            when(metadata.getColumnLabel(1)).thenReturn(edge ? "source" : "pk");
            when(metadata.getColumnLabel(2)).thenReturn(edge ? "target" : "name");
            when(result.next()).thenReturn(true, false);
            when(result.getObject(1)).thenReturn("1"); when(result.getObject(2)).thenReturn(edge ? "1" : "Entity");
            return statement;
        });
        var service = new LiveInstanceGraph(admin, configs, adapters);
        var response = service.query("summary", new JSONObject(), "test");
        assertTrue(response.getBooleanValue("success"));
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewNodes").size());
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewEdges").size());
        assertTrue(queries.get(0).endsWith("LIMIT 50"));
        assertTrue(queries.get(1).contains(" IN (?)"));
        assertTrue(queries.get(1).endsWith("LIMIT 2001"));
        assertTrue(queries.stream().noneMatch(sql -> sql.contains("count(*)")));
        verify(connection).setReadOnly(true);
        verify(connection).rollback();
        assertThrows(IllegalArgumentException.class, () -> LiveInstanceGraph.identifier("entity; drop table entity"));
    }
}
