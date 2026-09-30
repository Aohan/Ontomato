package io.ontomato.dataengine.service.sys.bean.permission;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.ontomato.dataengine.core.db.mql.MQLQuery.LogicQuery;
import io.ontomato.dataengine.core.exception.ServiceException;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserDataPermission {

    private boolean fullData;

    List<FieldPermission> fieldPermissions = new ArrayList<>();

    List<RowPermission> rowPermissions = new ArrayList<>();

    // Stores the fullName of m3 tables; membership in this set means holding full row permission on that table
    Set<String> fullRowPermissions = new HashSet<>();

    @JsonIgnore
    public FieldPermission getFieldPermissionByClassName(String className) {
        return fieldPermissions.stream().filter(f -> Objects.equals(className, f.className)).findFirst().orElse(null);
    }

    @JsonIgnore
    public List<RowPermission> getRowPermissionByClassName(String className) {
        return rowPermissions.stream().filter(f -> Objects.equals(className, f.className)).collect(Collectors.toList());
    }

    public JSONObject getRowPermissionMQLByClassName(String className) {
        if (fullData || fullRowPermissions.contains("*") || fullRowPermissions.contains(className)) { return null; }

        LogicQuery or = LogicQuery.or();
        getRowPermissionByClassName(className).stream()//
                .map(RowPermission::toLogicQuery).forEach(or::add);
        return or.isEmpty() ? null : or.toJSONObject();
    }


    public boolean addRowPermission(String postId, String className, String mql) {
        RowPermission r = new RowPermission(postId, className, mql);
        LogicQuery logicQuery;
        try {
            logicQuery = r.toLogicQuery();
        } catch (Exception error) {
            throw new ServiceException("Row permission parsing failed: postId=" + postId + ", className=" + className, error);
        }
        if (logicQuery == null || logicQuery.isEmpty()) {
            throw new ServiceException("Row permission condition is empty: postId=" + postId + ", className=" + className);
        }

        return this.rowPermissions.add(r);
    }

    public boolean addRowPermission(String postId, String className, LogicQuery query) {
        if (query == null || query.isEmpty()) {
            throw new ServiceException("Row permission condition is empty: postId=" + postId + ", className=" + className);
        }
        return rowPermissions.add(new RowPermission(postId, className, query.toJSONObject().toJSONString()));
    }

    public void mergeRows(UserDataPermission other) {
        if (other == null) return;
        rowPermissions.addAll(other.rowPermissions);
        fullRowPermissions.addAll(other.fullRowPermissions);
    }

    public boolean addFieldPermission(FieldPermission p) {
        if (p.isEmpty()) { return false; }
        return this.fieldPermissions.add(p);
    }

}
