package io.ontomato.dataengine.service.impl;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.util.DslUtil;

/** Bounded, read-only exploration of the current PostgreSQL datasource. */
@Service
public class LiveInstanceGraph {
    private final AdminService admin;
    private final BusinessConfigService configs;
    private final DataAdapterRegistry adapters;
    private final Semaphore permits = new Semaphore(4);
    private record CachedStatistics(long expiresAt, JSONObject data) {}
    private final Map<String, CachedStatistics> statisticsCache = new java.util.concurrent.ConcurrentHashMap<>();

    public LiveInstanceGraph(AdminService admin, BusinessConfigService configs, DataAdapterRegistry adapters) {
        this.admin = admin;
        this.configs = configs;
        this.adapters = adapters;
    }

    private record ObjectType(String name, String pk, String label) {}
    private record Relation(String type, ObjectType from, ObjectType to, String fromField, String toField) {}

    static String identifier(String value) {
        if (value == null || !value.matches("[A-Za-z_][A-Za-z0-9_]*"))
            throw new IllegalArgumentException("Unsupported SQL identifier in ontology: " + value);
        return value;
    }

    @SuppressWarnings("unchecked")
    public JSONObject query(String operation, JSONObject request, String domainId) {
        if (!permits.tryAcquire()) throw new IllegalStateException("Graph queries are busy. Please retry.");
        try {
            var config = configs.get(domainId);
            if (!"postgresql".equals(config.getDataAdapter()))
                throw new IllegalArgumentException("Live instance exploration requires the PostgreSQL adapter");
            Map<String, Object> schema = admin.getJSONRule(domainId);
            List<Map<String, Object>> defs = (List<Map<String, Object>>) schema.get("classDef");
            Map<String, ObjectType> types = new LinkedHashMap<>();
            for (var def : defs) {
                if (!Boolean.TRUE.equals(def.get("inStarChart"))) continue;
                String name = identifier((String) def.get("className"));
                String pk = identifier(DslUtil.getPrimaryKey(def));
                String label = pk;
                for (var attr : (List<Map<String, Object>>) def.get("attrs")) {
                    String field = (String) attr.get("name");
                    if (!Boolean.FALSE.equals(attr.get("enable")) && Boolean.TRUE.equals(attr.get("bizzkey"))) {
                        if (label.equals(pk)) label = identifier(field);
                        if (!field.equals(pk) && (field.equals("name") || field.endsWith("_name"))) { label = identifier(field); break; }
                    }
                }
                types.put(name, new ObjectType(name, pk, label));
            }
            List<Relation> relations = new ArrayList<>();
            var rules = (Map<String, Map<String, Object>>) schema.get("relationship_rule");
            for (var entry : rules.entrySet()) {
                var rule = entry.getValue();
                ObjectType from = types.get(rule.get("fromclass")), to = types.get(rule.get("toclass"));
                if (from != null && to != null) relations.add(new Relation(entry.getKey(), from, to,
                    identifier((String) rule.get("fromField")), identifier((String) rule.get("toField"))));
            }
            relations.sort(Comparator.comparing(Relation::type));
            String version = Integer.toHexString(schema.toString().hashCode());
            if (request.getString("version") != null && !version.equals(request.getString("version")))
                return JSONObject.of("success", false, "code", "GRAPH_VERSION_CHANGED", "message", "Ontology changed. Reload the overview.");
            String cacheKey = domainId + ":" + version + ":" + config.getDataAdapterConnections().hashCode();
            if ("statistics".equals(operation)) {
                var cached = statisticsCache.get(cacheKey);
                if (cached != null && cached.expiresAt > System.currentTimeMillis())
                    return JSONObject.of("success", true, "status", "READY", "data", cached.data);
            }
            try (Connection connection = adapters.create(config, schema).openConnection()) {
                connection.setReadOnly(true);
                connection.setAutoCommit(false);
                try (var statement = connection.createStatement()) { statement.execute("SET LOCAL statement_timeout = '10s'"); }
                JSONObject data = switch (operation) {
                    case "summary" -> overview(connection, types, relations, version);
                    case "statistics" -> statistics(connection, types);
                    case "search" -> search(connection, types, request, version);
                    case "neighborhood" -> neighborhood(connection, types, relations, request, version);
                    default -> throw new IllegalArgumentException("Unknown graph operation");
                };
                connection.rollback();
                if ("statistics".equals(operation)) {
                    statisticsCache.entrySet().removeIf(entry -> entry.getValue().expiresAt <= System.currentTimeMillis());
                    statisticsCache.put(cacheKey, new CachedStatistics(System.currentTimeMillis() + 60_000, data));
                }
                return JSONObject.of("success", true, "status", "READY", "data", data);
            }
        } catch (Exception e) {
            return JSONObject.of("success", false, "message", e.getMessage());
        } finally { permits.release(); }
    }

    private List<JSONObject> rows(Connection connection, String sql, List<?> values) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setQueryTimeout(10);
            for (int i = 0; i < values.size(); i++) {
                Object value = values.get(i);
                if (value instanceof String) statement.setObject(i + 1, value, java.sql.Types.OTHER);
                else statement.setObject(i + 1, value);
            }
            List<JSONObject> result = new ArrayList<>();
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    JSONObject row = new JSONObject();
                    for (int i = 1; i <= rs.getMetaData().getColumnCount(); i++) row.put(rs.getMetaData().getColumnLabel(i), rs.getObject(i));
                    result.add(row);
                }
            }
            return result;
        }
    }

    private JSONObject node(ObjectType type, JSONObject row) {
        return JSONObject.of("id", type.name + ":" + row.getString("pk"), "class", type.name,
            "name", row.getString("name") == null ? row.getString("pk") : row.getString("name"));
    }

    private JSONObject overview(Connection c, Map<String, ObjectType> types, List<Relation> relations, String version) throws Exception {
        Map<String, List<String>> ids = new LinkedHashMap<>();
        JSONArray nodes = new JSONArray(), edges = new JSONArray(), classes = new JSONArray();
        for (var type : types.values()) {
            List<String> keys = new ArrayList<>();
            for (var row : rows(c, "SELECT " + type.pk + "::text AS pk," + type.label + "::text AS name FROM " + type.name + " ORDER BY " + type.pk + " LIMIT 50", List.of())) {
                nodes.add(node(type, row)); keys.add(row.getString("pk"));
            }
            ids.put(type.name, keys);
            classes.add(JSONObject.of("class", type.name, "sampleCount", keys.size(), "instanceCount", null));
        }
        boolean truncated = false;
        for (var relation : relations) {
            var from = ids.get(relation.from.name); var to = ids.get(relation.to.name);
            if (from.isEmpty() || to.isEmpty()) continue;
            String sql = "SELECT f." + relation.from.pk + "::text AS source,t." + relation.to.pk + "::text AS target FROM "
                + relation.from.name + " f JOIN " + relation.to.name + " t ON f." + relation.fromField + "=t." + relation.toField
                + " WHERE f." + relation.from.pk + " IN (" + placeholders(from.size()) + ") AND t." + relation.to.pk
                + " IN (" + placeholders(to.size()) + ") ORDER BY f." + relation.from.pk + ",t." + relation.to.pk + " LIMIT 2001";
            List<String> values = new ArrayList<>(from); values.addAll(to);
            for (var row : rows(c, sql, values)) {
                if (edges.size() == 2000) { truncated = true; break; }
                edges.add(JSONObject.of("source", relation.from.name + ":" + row.getString("source"), "target", relation.to.name + ":" + row.getString("target"), "type", relation.type));
            }
        }
        return JSONObject.of("classes", classes, "overviewNodes", nodes, "overviewEdges", edges, "overviewEdgesTruncated", truncated,
            "nodeCount", null, "edgeCount", null, "version", version, "live", true,
            "relationTypes", new JSONArray(relations.stream().map(Relation::type).toList()));
    }

    private static String placeholders(int count) { return String.join(",", java.util.Collections.nCopies(count, "?")); }

    private JSONObject statistics(Connection c, Map<String, ObjectType> types) throws Exception {
        JSONArray classes = new JSONArray(); long total = 0;
        for (var type : types.values()) {
            long count = rows(c, "SELECT count(*) AS count FROM " + type.name, List.of()).get(0).getLongValue("count");
            total += count; classes.add(JSONObject.of("class", type.name, "instanceCount", count));
        }
        return JSONObject.of("nodeCount", total, "classes", classes);
    }

    private JSONObject search(Connection c, Map<String, ObjectType> types, JSONObject request, String version) throws Exception {
        JSONArray nodes = new JSONArray(); String term = request.getString("term"); term = term == null ? "" : term.trim();
        for (var type : types.values()) {
            if (request.getString("class") != null && !type.name.equals(request.getString("class"))) continue;
            String effectiveTerm = type.name.toLowerCase(java.util.Locale.ROOT).contains(term.toLowerCase(java.util.Locale.ROOT)) ? "" : term;
            String sql = "SELECT " + type.pk + "::text AS pk," + type.label + "::text AS name FROM " + type.name
                + (effectiveTerm.isEmpty() ? "" : " WHERE position(lower(?::text) in lower(" + type.pk + "::text))>0 OR position(lower(?::text) in lower(" + type.label + "::text))>0")
                + " ORDER BY " + type.pk + " LIMIT 51";
            for (var row : rows(c, sql, effectiveTerm.isEmpty() ? List.of() : List.of(effectiveTerm, effectiveTerm))) { nodes.add(node(type, row)); if (nodes.size() > 50) break; }
            if (nodes.size() > 50) break;
        }
        boolean more = nodes.size() > 50; if (more) nodes.remove(50);
        return JSONObject.of("nodes", nodes, "hasMore", more, "version", version);
    }

    private JSONObject neighborhood(Connection c, Map<String, ObjectType> types, List<Relation> relations, JSONObject request, String version) throws Exception {
        String id = request.getString("id"); int separator = id == null ? -1 : id.indexOf(':');
        if (separator < 1) throw new IllegalArgumentException("Invalid instance id");
        ObjectType center = types.get(id.substring(0, separator)); if (center == null) throw new IllegalArgumentException("Unknown object type");
        String key = id.substring(separator + 1); String direction = request.getString("direction");
        if (direction != null && !List.of("both", "incoming", "outgoing").contains(direction)) throw new IllegalArgumentException("Unknown direction");
        int offset = request.getIntValue("offset"); if (offset < 0 || offset > 2000) throw new IllegalArgumentException("Invalid offset");
        Map<String, JSONObject> nodes = new LinkedHashMap<>(); JSONArray edges = new JSONArray();
        var centerRows = rows(c, "SELECT " + center.pk + "::text AS pk," + center.label + "::text AS name FROM " + center.name + " WHERE " + center.pk + "=? LIMIT 1", List.of(key));
        if (centerRows.isEmpty()) throw new IllegalArgumentException("Instance no longer exists");
        nodes.put(id, node(center, centerRows.get(0)));
        List<String> queries = new ArrayList<>(); List<Object> values = new ArrayList<>();
        for (var relation : relations) for (boolean outgoing : List.of(true, false)) {
            if (outgoing && "incoming".equals(direction) || !outgoing && "outgoing".equals(direction)) continue;
            ObjectType here = outgoing ? relation.from : relation.to, other = outgoing ? relation.to : relation.from;
            if (!here.name.equals(center.name)) continue;
            if (request.getString("neighborClass") != null && !other.name.equals(request.getString("neighborClass"))) continue;
            if (request.getString("relationType") != null && !relation.type.equals(request.getString("relationType"))) continue;
            queries.add("SELECT ?::text AS type,?::text AS class,?::boolean AS outgoing,o." + other.pk + "::text AS pk,o." + other.label + "::text AS name FROM "
                + here.name + " h JOIN " + other.name + " o ON h." + (outgoing ? relation.fromField : relation.toField) + "=o." + (outgoing ? relation.toField : relation.fromField)
                + " WHERE h." + here.pk + "=?" + (!outgoing && here.name.equals(other.name) ? " AND h." + here.pk + "<>o." + other.pk : ""));
            values.add(relation.type); values.add(other.name); values.add(outgoing); values.add(key);
        }
        if (queries.isEmpty()) return JSONObject.of("nodes", new JSONArray(nodes.values()), "edges", edges, "total", 0, "nextOffset", null, "version", version);
        var results = rows(c, "SELECT DISTINCT * FROM (" + String.join(" UNION ALL ", queries) + ") neighbors ORDER BY type,class,pk,outgoing LIMIT 101 OFFSET " + offset, values);
        boolean more = results.size() > 100;
        for (var row : results.subList(0, Math.min(100, results.size()))) {
            ObjectType other = types.get(row.getString("class")); JSONObject neighbor = node(other, row); String otherId = neighbor.getString("id"); nodes.put(otherId, neighbor);
            edges.add(JSONObject.of("source", row.getBooleanValue("outgoing") ? id : otherId, "target", row.getBooleanValue("outgoing") ? otherId : id, "type", row.getString("type")));
        }
        return JSONObject.of("nodes", new JSONArray(nodes.values()), "edges", edges, "total", more ? null : offset + edges.size(), "nextOffset", more ? offset + edges.size() : null, "version", version);
    }
}
