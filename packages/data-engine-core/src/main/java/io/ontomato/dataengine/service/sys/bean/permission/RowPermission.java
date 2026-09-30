package io.ontomato.dataengine.service.sys.bean.permission;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.db.mql.MQLQuery.LogicQuery;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class RowPermission {
    String postId;
    String className;
    String customMqlFragment;

    public JSONObject toJSON() {
        return JSONObject.parse(customMqlFragment);
    }

    public LogicQuery toLogicQuery() {
        return LogicQuery.parse(customMqlFragment);
    }
}
