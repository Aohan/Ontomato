package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.impl.InstanceGraphQuery;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

class MysqlInstanceGraphQueryTest {
    @Test
    void neighborDslProducesBoundedSqlJoinAndEscapedCenterFilter() throws Exception {
        Map<String, Object> rule = Map.of("classDef", List.of(
                Map.of("className", "Orders", "inStarChart", true, "attrs", List.of(Map.of("name", "code", "type", "varchar", "primaryKey", true))),
                Map.of("className", "Items", "inStarChart", true, "attrs", List.of(Map.of("name", "id", "type", "varchar", "primaryKey", true)))),
                "relationship_rule", Map.of("has", Map.of("fromclass", "Orders", "toclass", "Items", "fromField", "code", "toField", "id")));
        MysqlAdapter adapter = new MysqlAdapter(null, rule);
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        InstanceGraphQuery query = new InstanceGraphQuery(rule, adapter, permission, dsl -> {
            var method = MysqlAdapter.class.getDeclaredMethod("toSql", JSONObject.class, Map.class);
            method.setAccessible(true);
            String sql = (String) method.invoke(adapter, dsl, rule);
            assertNotNull(sql);
            assertTrue(sql.contains("inner join Items"), sql);
            assertTrue(sql.contains("`f`.code = `t`.id"), sql);
            assertTrue(sql.contains("`f`.code = 'a''b'"), sql);
            assertTrue(sql.contains("limit 0, 51"), sql);
            assertTrue(sql.toLowerCase().contains("order by"), sql);
            return new JSONArray();
        });
        assertFalse(query.neighbors(JSONObject.of("class", "Orders", "id", "Orders:a'b")).getBooleanValue("hasMore"));
    }
}
