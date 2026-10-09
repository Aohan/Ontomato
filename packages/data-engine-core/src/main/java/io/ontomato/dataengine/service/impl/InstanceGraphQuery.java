package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;

/** Bounded graph queries reuse the adapters' relationship mapping and permission-aware DSL executor. */
public final class InstanceGraphQuery {
    @FunctionalInterface
    public interface Executor {
        JSONArray execute(JSONObject dsl) throws Exception;
    }

    private final Map<String, Map<String, Object>> classes = new LinkedHashMap<>();
    private final Map<String, Map<String, Object>> relations;
    private final boolean m3;
    private final UserDataPermission permission;
    private final Executor executor;

    @SuppressWarnings("unchecked")
    public InstanceGraphQuery(Map<String, Object> rule, DataAdapter adapter, UserDataPermission permission, Executor executor) {
        for (Map<String, Object> definition : (List<Map<String, Object>>) rule.get("classDef")) {
            if (Boolean.TRUE.equals(definition.get("inStarChart"))) {
                classes.put((String) definition.get("className"), definition);
            }
        }
        this.relations = (Map<String, Map<String, Object>>) rule.get("relationship_rule");
        this.m3 = adapter.useM3();
        this.permission = permission;
        this.executor = executor;
    }

    private boolean visible(String className) {
        var fields = permission.getFieldPermissionByClassName(className);
        return classes.containsKey(className) && (permission.isFullData() || fields != null && !fields.isEmpty());
    }

    private String pk(String className) {
        return m3 ? "id" : DslUtil.getPrimaryKey(classes.get(className));
    }

    @SuppressWarnings("unchecked")
    private String nameField(String className) {
        for (Map<String, Object> attr : (List<Map<String, Object>>) classes.get(className).get("attrs")) {
            if (!Boolean.FALSE.equals(attr.get("enable")) && Boolean.TRUE.equals(attr.get("bizzkey"))) {
                return (String) attr.get("name");
            }
        }
        return pk(className);
    }

    private JSONObject object(String className, String variable, int index) {
        return JSONObject.of("idx", index, "variable", variable, "class", className);
    }

    private JSONObject field(String variable, String name, String alias) {
        return JSONObject.of("variable", variable, "field", name, "as", alias);
    }

    private JSONObject dsl(JSONArray objects, JSONArray relationships, JSONArray fields, JSONArray sort, int offset, int count) {
        JSONObject pattern = JSONObject.of("objects", objects);
        if (relationships != null) pattern.put("relationship", relationships);
        JSONObject graph = JSONObject.of("patterns", JSONArray.of(pattern), "pattern_logic", "and");
        JSONObject output = JSONObject.of("to_user", true, "fields", fields,
                "sort", JSONObject.of("fields", sort), "limit", JSONObject.of("offset", offset, "count", count));
        return JSONObject.of("problem", "", "answer", JSONObject.of("steps", JSONArray.of(JSONObject.of("graph", graph, "output", output))));
    }

    private JSONObject sort(String variable, String field) {
        return JSONObject.of("variable", variable, "field", field, "order", "asc");
    }

    private int limit(JSONObject request) {
        Integer limit = request.getInteger("limit");
        return Math.max(1, Math.min(100, limit == null ? 50 : limit));
    }

    private JSONObject node(String className, String id, String name) {
        return JSONObject.of("id", m3 ? id : className + ":" + id,
                "name", name == null ? id : name, "class", className);
    }

    @SuppressWarnings("unchecked")
    private Object keyValue(String className, String value) {
        if (!m3) {
            for (Map<String, Object> attr : (List<Map<String, Object>>) classes.get(className).get("attrs")) {
                if (pk(className).equals(attr.get("name")) && List.of("int", "long", "double").contains(String.valueOf(attr.get("type")))) {
                    return new java.math.BigDecimal(value);
                }
            }
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    public JSONObject instances(JSONObject request) throws Exception {
        String className = request.getString("class");
        if (!visible(className)) throw new IllegalArgumentException("Object type is unavailable");
        int limit = limit(request);
        int offset = Math.max(0, request.getIntValue("offset"));
        JSONObject object = object(className, "n", 0);
        String search = request.getString("search");
        if (search != null && !search.isBlank()) {
            if (m3) {
                object.put("conditions", JSONObject.of("text", JSONObject.of("fields", new JSONArray(),
                        "operator", "match", "boost", 1.0, "query", search.trim())));
            } else {
                JSONArray terms = new JSONArray();
                for (Map<String, Object> attr : (List<Map<String, Object>>) classes.get(className).get("attrs")) {
                    if (Boolean.FALSE.equals(attr.get("enable"))) continue;
                    String type = (String) attr.get("type");
                    String field = (String) attr.get("name");
                    var allowed = permission.getFieldPermissionByClassName(className);
                    if (!permission.isFullData() && (allowed == null || !allowed.getVisibleFields().contains(field))) continue;
                    if ("varchar".equals(type)) terms.add(JSONObject.of("field", field, "operator", "like", "value", "%" + search.trim() + "%"));
                    else if (List.of("int", "long", "double").contains(type == null ? "" : type)) {
                        try { terms.add(JSONObject.of("field", field, "operator", "=", "value", new java.math.BigDecimal(search.trim()))); }
                        catch (NumberFormatException ignored) { }
                    }
                }
                if (terms.isEmpty()) return JSONObject.of("nodes", new JSONArray(), "hasMore", false, "nextOffset", null);
                object.put("conditions", JSONObject.of("properties", JSONObject.of("operator", "logic", "or", terms)));
            }
        }
        JSONArray rows = executor.execute(dsl(JSONArray.of(object), null,
                JSONArray.of(field("n", pk(className), "id"), field("n", nameField(className), "name")),
                JSONArray.of(sort("n", pk(className))), offset, limit + 1));
        JSONArray nodes = new JSONArray();
        for (int i = 0; i < Math.min(limit, rows.size()); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (row.getString("id") != null) nodes.add(node(className, row.getString("id"), row.getString("name")));
        }
        return JSONObject.of("nodes", nodes, "hasMore", rows.size() > limit,
                "nextOffset", rows.size() > limit ? offset + limit : null);
    }

    public JSONObject neighbors(JSONObject request) throws Exception {
        String className = request.getString("class");
        String id = request.getString("id");
        if (!visible(className) || id == null || id.isBlank()) throw new IllegalArgumentException("Node is unavailable");
        if (!m3 && !id.startsWith(className + ":")) throw new IllegalArgumentException("Invalid node ID");
        String key = m3 ? id : id.substring(className.length() + 1);
        String direction = request.getString("direction");
        if (direction == null) direction = "both";
        if (!List.of("both", "in", "out").contains(direction)) throw new IllegalArgumentException("Invalid direction");
        List<JSONObject> queries = new ArrayList<>();
        for (String relation : relations.keySet().stream().sorted(Comparator.naturalOrder()).toList()) {
            Map<String, Object> definition = relations.get(relation);
            String from = (String) definition.get("fromclass");
            String to = (String) definition.get("toclass");
            if (!visible(from) || !visible(to)) continue;
            if (className.equals(from) && !direction.equals("in")) queries.add(JSONObject.of("relation", relation, "from", from, "to", to, "anchor", "f"));
            if (className.equals(to) && !direction.equals("out")) queries.add(JSONObject.of("relation", relation, "from", from, "to", to, "anchor", "t"));
        }
        int index = 0;
        int offset = 0;
        String cursor = request.getString("cursor");
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = cursor.split(":", -1);
            if (parts.length != 2) throw new IllegalArgumentException("Invalid cursor");
            index = Integer.parseInt(parts[0]);
            offset = Integer.parseInt(parts[1]);
            if (index < 0 || index > queries.size() || offset < 0) throw new IllegalArgumentException("Invalid cursor");
        }
        int limit = limit(request);
        Map<String, JSONObject> nodes = new LinkedHashMap<>();
        Map<String, JSONObject> edges = new LinkedHashMap<>();
        // Each request visits one relation/direction only: query work does not grow with the full graph.
        if (index < queries.size()) {
            JSONObject query = queries.get(index);
            String from = query.getString("from");
            String to = query.getString("to");
            JSONObject f = object(from, "f", 0);
            JSONObject t = object(to, "t", 1);
            String anchor = query.getString("anchor");
            (anchor.equals("f") ? f : t).put("conditions", JSONObject.of("properties", JSONObject.of("field", pk(className), "operator", "=", "value", keyValue(className, key))));
            JSONArray relationships = JSONArray.of(JSONObject.of("from", 0, "to", 1,
                    "type", JSONArray.of(query.getString("relation")), "min_hops", 1, "max_hops", 1));
            JSONArray rows = executor.execute(dsl(JSONArray.of(f, t), relationships,
                    JSONArray.of(field("f", pk(from), "sid"), field("f", nameField(from), "sname"),
                            field("t", pk(to), "tid"), field("t", nameField(to), "tname")),
                    JSONArray.of(sort("f", pk(from)), sort("t", pk(to))), offset, limit + 1));
            for (int i = 0; i < Math.min(limit, rows.size()); i++) {
                JSONObject row = rows.getJSONObject(i);
                if (row.getString("sid") == null || row.getString("tid") == null) continue;
                JSONObject source = node(from, row.getString("sid"), row.getString("sname"));
                JSONObject target = node(to, row.getString("tid"), row.getString("tname"));
                if (!source.getString("id").equals(id)) nodes.put(source.getString("id"), source);
                if (!target.getString("id").equals(id)) nodes.put(target.getString("id"), target);
                String edgeKey = source.getString("id") + "\u0000" + target.getString("id");
                edges.put(edgeKey, JSONObject.of("source", source.getString("id"), "target", target.getString("id")));
            }
            if (rows.size() > limit) offset += limit;
            else { index++; offset = 0; }
        }
        return JSONObject.of("nodes", new JSONArray(nodes.values()), "edges", new JSONArray(edges.values()),
                "hasMore", index < queries.size(), "nextCursor", index < queries.size() ? index + ":" + offset : null);
    }
}
