package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.util.DslUtil;

/**
 * Bounded, read-only exploration of the current datasource, expressed as graph-pattern DSL queries
 * run through the domain's {@link DataAdapter}. Every operation is on demand and bounded, so the
 * feature works across every installed adapter instead of a single database.
 */
@Service
public class LiveInstanceGraph {
    private final AdminService admin;
    private final BusinessConfigService configs;
    private final DataAdapterRegistry adapters;
    private final Semaphore permits = new Semaphore(4);
    private record CachedStatistics(long expiresAt, JSONObject data) {}
    private final Map<String, CachedStatistics> statisticsCache = new ConcurrentHashMap<>();

    public LiveInstanceGraph(AdminService admin, BusinessConfigService configs, DataAdapterRegistry adapters) {
        this.admin = admin;
        this.configs = configs;
        this.adapters = adapters;
    }

    private record ObjectType(String name, String pk, String label) {}
    private record Relation(String type, ObjectType from, ObjectType to) {}

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
            Map<String, Object> schema = admin.getJSONRule(domainId);
            Map<String, ObjectType> types = objectTypes(schema);
            List<Relation> relations = relations(schema, types);
            String version = Integer.toHexString(schema.toString().hashCode());
            if (request.getString("version") != null && !version.equals(request.getString("version")))
                return JSONObject.of("success", false, "code", "GRAPH_VERSION_CHANGED", "message", "Ontology changed. Reload the overview.");
            String cacheKey = domainId + ":" + version + ":" + config.getDataAdapterConnections().hashCode();
            if ("statistics".equals(operation)) {
                var cached = statisticsCache.get(cacheKey);
                if (cached != null && cached.expiresAt > System.currentTimeMillis())
                    return JSONObject.of("success", true, "status", "READY", "data", cached.data);
            }
            DataAdapter adapter = adapters.create(config, schema);
            JSONObject data = switch (operation) {
                case "summary" -> overview(adapter, types, relations, version);
                case "statistics" -> statistics(adapter, types);
                case "search" -> search(adapter, types, request, version);
                case "neighborhood" -> neighborhood(adapter, types, relations, request, version);
                default -> throw new IllegalArgumentException("Unknown graph operation");
            };
            if ("statistics".equals(operation)) {
                statisticsCache.entrySet().removeIf(entry -> entry.getValue().expiresAt <= System.currentTimeMillis());
                statisticsCache.put(cacheKey, new CachedStatistics(System.currentTimeMillis() + 60_000, data));
            }
            return JSONObject.of("success", true, "status", "READY", "data", data);
        } catch (Exception e) {
            return JSONObject.of("success", false, "message", e.getMessage());
        } finally {
            permits.release();
        }
    }

    // ----------------------------------------------------------------------------------
    // Schema parsing
    // ----------------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, ObjectType> objectTypes(Map<String, Object> schema) {
        Map<String, ObjectType> types = new LinkedHashMap<>();
        for (var def : (List<Map<String, Object>>) schema.get("classDef")) {
            if (!Boolean.TRUE.equals(def.get("inStarChart"))) continue;
            String name = identifier((String) def.get("className"));
            String pk = identifier(DslUtil.getPrimaryKey(def));
            String label = pk;
            for (var attr : (List<Map<String, Object>>) def.get("attrs")) {
                String field = (String) attr.get("name");
                if (!Boolean.FALSE.equals(attr.get("enable")) && Boolean.TRUE.equals(attr.get("bizzkey"))) {
                    if (label.equals(pk)) label = identifier(field);
                    if (!field.equals(pk) && (field.equals("name") || field.endsWith("_name"))) {
                        label = identifier(field);
                        break;
                    }
                }
            }
            types.put(name, new ObjectType(name, pk, label));
        }
        return types;
    }

    @SuppressWarnings("unchecked")
    private List<Relation> relations(Map<String, Object> schema, Map<String, ObjectType> types) {
        List<Relation> relations = new ArrayList<>();
        var rules = (Map<String, Map<String, Object>>) schema.get("relationship_rule");
        for (var entry : rules.entrySet()) {
            var rule = entry.getValue();
            ObjectType from = types.get(rule.get("fromclass"));
            ObjectType to = types.get(rule.get("toclass"));
            if (from != null && to != null) relations.add(new Relation(entry.getKey(), from, to));
        }
        relations.sort(Comparator.comparing(Relation::type));
        return relations;
    }

    // ----------------------------------------------------------------------------------
    // Operations
    // ----------------------------------------------------------------------------------

    private JSONObject overview(DataAdapter adapter, Map<String, ObjectType> types, List<Relation> relations, String version) throws Exception {
        Map<String, List<String>> ids = new LinkedHashMap<>();
        JSONArray nodes = new JSONArray(), edges = new JSONArray(), classes = new JSONArray();
        for (ObjectType type : types.values()) {
            List<String> keys = new ArrayList<>();
            JSONObject dsl = dsl(objects(object(0, "n", type.name, null)), null,
                    fields(field("n", type.pk, "pk"), field("n", type.label, "name")),
                    sort(sortField("pk")), limit(50, 0));
            for (JSONObject row : runDsl(adapter, dsl)) {
                nodes.add(node(type, row));
                keys.add(row.getString("pk"));
            }
            ids.put(type.name, keys);
            classes.add(JSONObject.of("class", type.name, "sampleCount", keys.size(), "instanceCount", null));
        }
        boolean truncated = false;
        for (Relation relation : relations) {
            List<String> from = ids.get(relation.from.name), to = ids.get(relation.to.name);
            if (from.isEmpty() || to.isEmpty()) continue;
            JSONObject dsl = dsl(
                    objects(
                            object(0, "f", relation.from.name, conditions(condition(relation.from.pk, "in", array(from)))),
                            object(1, "t", relation.to.name, conditions(condition(relation.to.pk, "in", array(to))))),
                    relationships(relation(0, 1, relation.type)),
                    fields(field("f", relation.from.pk, "source"), field("t", relation.to.pk, "target")),
                    null, limit(2001, 0));
            for (JSONObject row : runDsl(adapter, dsl)) {
                if (edges.size() == 2000) { truncated = true; break; }
                edges.add(JSONObject.of("source", relation.from.name + ":" + row.getString("source"),
                        "target", relation.to.name + ":" + row.getString("target"), "type", relation.type));
            }
        }
        return JSONObject.of("classes", classes, "overviewNodes", nodes, "overviewEdges", edges,
                "overviewEdgesTruncated", truncated, "nodeCount", null, "edgeCount", null,
                "version", version, "live", true,
                "relationTypes", new JSONArray(relations.stream().map(Relation::type).toList()));
    }

    private JSONObject statistics(DataAdapter adapter, Map<String, ObjectType> types) throws Exception {
        JSONArray classes = new JSONArray();
        long total = 0;
        for (ObjectType type : types.values()) {
            JSONObject dsl = dsl(objects(object(0, "n", type.name, null)), null,
                    fields(aggField("n", type.pk, "count", "cnt")), null, null);
            List<JSONObject> rows = runDsl(adapter, dsl);
            long count = rows.isEmpty() ? 0 : ((Number) rows.get(0).get("cnt")).longValue();
            total += count;
            classes.add(JSONObject.of("class", type.name, "instanceCount", count));
        }
        return JSONObject.of("nodeCount", total, "classes", classes);
    }

    private JSONObject search(DataAdapter adapter, Map<String, ObjectType> types, JSONObject request, String version) throws Exception {
        JSONArray nodes = new JSONArray();
        String term = request.getString("term");
        term = term == null ? "" : term.trim();
        for (ObjectType type : types.values()) {
            if (request.getString("class") != null && !type.name.equals(request.getString("class"))) continue;
            String effectiveTerm = type.name.toLowerCase(Locale.ROOT).contains(term.toLowerCase(Locale.ROOT)) ? "" : term;
            JSONObject conditions = null;
            if (!effectiveTerm.isEmpty()) {
                JSONObject or = new JSONObject();
                JSONArray ors = new JSONArray();
                ors.add(condition(type.pk, "like", effectiveTerm));
                ors.add(condition(type.label, "like", effectiveTerm));
                or.put("or", ors);
                conditions = conditions(or);
            }
            JSONObject dsl = dsl(objects(object(0, "n", type.name, conditions)), null,
                    fields(field("n", type.pk, "pk"), field("n", type.label, "name")),
                    sort(sortField("pk")), limit(51, 0));
            for (JSONObject row : runDsl(adapter, dsl)) {
                nodes.add(node(type, row));
                if (nodes.size() > 50) break;
            }
            if (nodes.size() > 50) break;
        }
        boolean more = nodes.size() > 50;
        if (more) nodes.remove(50);
        return JSONObject.of("nodes", nodes, "hasMore", more, "version", version);
    }

    private JSONObject neighborhood(DataAdapter adapter, Map<String, ObjectType> types, List<Relation> relations, JSONObject request, String version) throws Exception {
        String id = request.getString("id");
        int separator = id == null ? -1 : id.indexOf(':');
        if (separator < 1) throw new IllegalArgumentException("Invalid instance id");
        ObjectType center = types.get(id.substring(0, separator));
        if (center == null) throw new IllegalArgumentException("Unknown object type");
        String key = id.substring(separator + 1);
        String direction = request.getString("direction");
        if (direction != null && !List.of("both", "incoming", "outgoing").contains(direction))
            throw new IllegalArgumentException("Unknown direction");
        int offset = request.getIntValue("offset");
        if (offset < 0 || offset > 2000) throw new IllegalArgumentException("Invalid offset");

        JSONObject centerDsl = dsl(objects(object(0, "n", center.name, conditions(condition(center.pk, "=", key)))),
                null, fields(field("n", center.pk, "pk"), field("n", center.label, "name")), null, limit(1, 0));
        List<JSONObject> centerRows = runDsl(adapter, centerDsl);
        if (centerRows.isEmpty()) throw new IllegalArgumentException("Instance no longer exists");
        Map<String, JSONObject> nodes = new LinkedHashMap<>();
        nodes.put(id, node(center, centerRows.get(0)));

        List<JSONObject> neighborRows = new ArrayList<>();
        for (Relation relation : relations) {
            boolean outgoingAllowed = relation.from.name.equals(center.name) && !"incoming".equals(direction);
            boolean incomingAllowed = relation.to.name.equals(center.name) && !"outgoing".equals(direction);
            if (request.getString("neighborClass") != null) {
                if (outgoingAllowed && !relation.to.name.equals(request.getString("neighborClass"))) outgoingAllowed = false;
                if (incomingAllowed && !relation.from.name.equals(request.getString("neighborClass"))) incomingAllowed = false;
            }
            if (request.getString("relationType") != null && !relation.type.equals(request.getString("relationType"))) {
                outgoingAllowed = false;
                incomingAllowed = false;
            }
            boolean selfLoop = relation.from.name.equals(relation.to.name);
            if (outgoingAllowed) {
                JSONObject fromObj = object(0, "f", relation.from.name, conditions(condition(relation.from.pk, "=", key)));
                JSONObject toObj = object(1, "t", relation.to.name, null);
                JSONObject dsl = dsl(objects(fromObj, toObj), relationships(relation(0, 1, relation.type)),
                        fields(field("t", relation.to.pk, "pk"), field("t", relation.to.label, "name")), null, null);
                for (JSONObject row : runDsl(adapter, dsl)) {
                    neighborRows.add(JSONObject.of("type", relation.type, "class", relation.to.name,
                            "pk", row.getString("pk"), "name", row.getString("name"), "outgoing", true));
                }
            }
            if (incomingAllowed) {
                JSONObject fromObj = object(0, "f", relation.from.name, null);
                JSONObject toObj = object(1, "t", relation.to.name, conditions(condition(relation.to.pk, "=", key)));
                // A self-loop relation in the incoming direction must not list the node as its own neighbour.
                if (selfLoop) {
                    fromObj.put("conditions", conditions(condition(relation.from.pk, "!=", key)));
                }
                JSONObject dsl = dsl(objects(fromObj, toObj), relationships(relation(0, 1, relation.type)),
                        fields(field("f", relation.from.pk, "pk"), field("f", relation.from.label, "name")), null, null);
                for (JSONObject row : runDsl(adapter, dsl)) {
                    neighborRows.add(JSONObject.of("type", relation.type, "class", relation.from.name,
                            "pk", row.getString("pk"), "name", row.getString("name"), "outgoing", false));
                }
            }
        }

        Map<String, JSONObject> unique = new LinkedHashMap<>();
        for (JSONObject n : neighborRows) {
            unique.putIfAbsent(n.getString("type") + "|" + n.getString("class") + "|" + n.getString("pk") + "|" + n.getBooleanValue("outgoing"), n);
        }
        List<JSONObject> sorted = new ArrayList<>(unique.values());
        sorted.sort(Comparator.comparing((JSONObject n) -> n.getString("type"))
                .thenComparing(n -> n.getString("class"))
                .thenComparing(n -> n.getString("pk"))
                .thenComparing(n -> n.getBooleanValue("outgoing")));
        int end = Math.min(offset + 100, sorted.size());
        boolean more = end < sorted.size();
        JSONArray edges = new JSONArray();
        for (int i = offset; i < end; i++) {
            JSONObject n = sorted.get(i);
            String otherId = n.getString("class") + ":" + n.getString("pk");
            nodes.putIfAbsent(otherId, JSONObject.of("id", otherId, "class", n.getString("class"), "name", n.getString("name")));
            edges.add(JSONObject.of("source", n.getBooleanValue("outgoing") ? id : otherId,
                    "target", n.getBooleanValue("outgoing") ? otherId : id, "type", n.getString("type")));
        }
        return JSONObject.of("nodes", new JSONArray(nodes.values()), "edges", edges,
                "total", more ? null : offset + edges.size(),
                "nextOffset", more ? offset + edges.size() : null, "version", version);
    }

    // ----------------------------------------------------------------------------------
    // DSL building and execution
    // ----------------------------------------------------------------------------------

    private List<JSONObject> runDsl(DataAdapter adapter, JSONObject dsl) throws Exception {
        JSONArray dsls = new JSONArray();
        dsls.add(dsl);
        String result = adapter.executeDsl(dsls.toJSONString(), UUID.randomUUID().toString(), DslExecutionMode.RAW, new ArrayList<>());
        JSONArray answer = JSON.parseArray(result).getJSONObject(0).getJSONArray("answer");
        List<JSONObject> rows = new ArrayList<>();
        if (answer != null) for (Object raw : answer) rows.add((JSONObject) raw);
        return rows;
    }

    private JSONObject node(ObjectType type, JSONObject row) {
        return JSONObject.of("id", type.name + ":" + row.getString("pk"), "class", type.name,
                "name", row.getString("name") == null ? row.getString("pk") : row.getString("name"));
    }

    private JSONObject dsl(JSONArray objects, JSONArray relationships, JSONArray outputFields, JSONObject sort, JSONObject limit) {
        JSONObject pattern = new JSONObject();
        pattern.put("objects", objects);
        if (relationships != null && !relationships.isEmpty()) pattern.put("relationship", relationships);
        JSONArray patterns = new JSONArray();
        patterns.add(pattern);
        JSONObject graph = new JSONObject();
        graph.put("patterns", patterns);
        graph.put("pattern_logic", "and");
        JSONObject step = new JSONObject();
        step.put("graph", graph);
        JSONObject output = new JSONObject();
        output.put("to_user", true);
        output.put("fields", outputFields);
        if (sort != null) output.put("sort", sort);
        if (limit != null) output.put("limit", limit);
        step.put("output", output);
        JSONArray steps = new JSONArray();
        steps.add(step);
        JSONObject answer = new JSONObject();
        answer.put("steps", steps);
        JSONObject dsl = new JSONObject();
        dsl.put("problem", "");
        dsl.put("answer", answer);
        return dsl;
    }

    private JSONArray objects(JSONObject... os) {
        JSONArray arr = new JSONArray();
        for (JSONObject o : os) arr.add(o);
        return arr;
    }

    private JSONArray relationships(JSONObject... rs) {
        JSONArray arr = new JSONArray();
        for (JSONObject r : rs) arr.add(r);
        return arr;
    }

    private JSONArray fields(JSONObject... fs) {
        JSONArray arr = new JSONArray();
        for (JSONObject f : fs) arr.add(f);
        return arr;
    }

    private JSONObject object(int idx, String variable, String className, JSONObject conditions) {
        JSONObject o = new JSONObject();
        o.put("idx", idx);
        o.put("variable", variable);
        o.put("class", className);
        if (conditions != null) o.put("conditions", conditions);
        return o;
    }

    private JSONObject field(String variable, String field, String as) {
        JSONObject f = new JSONObject();
        f.put("variable", variable);
        f.put("field", field);
        f.put("as", as);
        return f;
    }

    private JSONObject aggField(String variable, String field, String function, String as) {
        JSONObject f = field(variable, field, as);
        f.put("function", function);
        return f;
    }

    private JSONObject condition(String field, String operator, Object value) {
        JSONObject c = new JSONObject();
        c.put("field", field);
        c.put("operator", operator);
        c.put("value", value);
        return c;
    }

    private JSONObject conditions(JSONObject properties) {
        JSONObject c = new JSONObject();
        c.put("properties", properties);
        return c;
    }

    private JSONObject relation(int from, int to, String type) {
        JSONObject r = new JSONObject();
        r.put("from", from);
        r.put("to", to);
        JSONArray types = new JSONArray();
        types.add(type);
        r.put("type", types);
        return r;
    }

    private JSONObject sortField(String field) {
        JSONObject f = new JSONObject();
        f.put("field", field);
        return f;
    }

    private JSONObject sort(JSONObject... fields) {
        JSONObject s = new JSONObject();
        JSONArray arr = new JSONArray();
        for (JSONObject f : fields) arr.add(f);
        s.put("fields", arr);
        return s;
    }

    private JSONObject limit(int count, int offset) {
        JSONObject l = new JSONObject();
        l.put("count", count);
        l.put("offset", offset);
        return l;
    }

    private JSONArray array(List<String> values) {
        JSONArray arr = new JSONArray();
        for (String v : values) arr.add(v);
        return arr;
    }
}
