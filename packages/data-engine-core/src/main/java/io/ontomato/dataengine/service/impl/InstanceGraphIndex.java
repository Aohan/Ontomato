package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/** Immutable, versioned view of the generated graph, shared by all exploration requests. */
final class InstanceGraphIndex {
    final String version = UUID.randomUUID().toString();
    final String generatedAt = java.time.Instant.now().toString();
    private final Map<String, JSONObject> nodes = new LinkedHashMap<>();
    private final Map<String, List<JSONObject>> adjacency = new HashMap<>();
    private final JSONObject summary;

    InstanceGraphIndex(JSONObject graph) {
        JSONArray rawNodes = graph.getJSONArray("nodes");
        if (rawNodes != null) for (Object raw : rawNodes) {
            JSONObject node = (JSONObject) raw;
            if ("root".equals(node.getString("id")) || "virtual_root".equals(node.getString("class"))) continue;
            JSONObject copy = new JSONObject();
            copy.put("id", node.getString("id"));
            copy.put("name", node.getString("name"));
            copy.put("class", node.getString("class"));
            nodes.put(copy.getString("id"), copy);
        }
        List<JSONObject> sorted = new ArrayList<>(nodes.values());
        sorted.sort(Comparator.comparing(n -> n.getString("id")));
        nodes.clear();
        sorted.forEach(n -> nodes.put(n.getString("id"), n));
        Map<String, Integer> counts = new java.util.TreeMap<>();
        Map<String, Map<String, Integer>> pairs = new java.util.TreeMap<>();
        Map<String, Map<String, Map<String, Integer>>> pairTypes = new java.util.TreeMap<>();
        Map<String, String> parents = new HashMap<>();
        nodes.forEach((id, node) -> {
            counts.merge(node.getString("class"), 1, Integer::sum);
            adjacency.put(id, new ArrayList<>());
            parents.put(id, id);
        });
        int edgeCount = 0;
        JSONArray rawEdges = graph.getJSONArray("edges");
        if (rawEdges != null) for (Object raw : rawEdges) {
            JSONObject edge = (JSONObject) raw;
            String source = edge.getString("source"), target = edge.getString("target");
            if (!nodes.containsKey(source) || !nodes.containsKey(target)) continue;
            JSONObject copy = new JSONObject();
            copy.put("source", source);
            copy.put("target", target);
            copy.put("type", edge.getString("type"));
            copy.put("label", edge.getString("label"));
            adjacency.get(source).add(copy);
            if (!source.equals(target)) adjacency.get(target).add(copy);
            pairs.computeIfAbsent(nodes.get(source).getString("class"), ignored -> new java.util.TreeMap<>())
                .merge(nodes.get(target).getString("class"), 1, Integer::sum);
            String type = copy.getString("type");
            if (type != null) {
                pairTypes.computeIfAbsent(nodes.get(source).getString("class"), ignored -> new java.util.TreeMap<>())
                    .computeIfAbsent(nodes.get(target).getString("class"), ignored -> new java.util.TreeMap<>())
                    .merge(type, 1, Integer::sum);
            }
            parents.put(find(parents, source), find(parents, target));
            edgeCount++;
        }
        adjacency.values().forEach(list -> list.sort(Comparator
            .comparing((JSONObject e) -> e.getString("source")).thenComparing(e -> e.getString("target"))));
        Map<String, Integer> components = new HashMap<>();
        int isolated = 0;
        for (String id : nodes.keySet()) {
            components.merge(find(parents, id), 1, Integer::sum);
            if (adjacency.get(id).isEmpty()) isolated++;
        }
        JSONArray classes = new JSONArray();
        counts.forEach((name, count) -> {
            JSONObject item = new JSONObject();
            item.put("class", name);
            item.put("instanceCount", count);
            classes.add(item);
        });
        JSONArray relationships = new JSONArray();
        pairs.forEach((source, targets) -> targets.forEach((target, count) -> {
            JSONObject item = new JSONObject();
            item.put("source", source);
            item.put("target", target);
            item.put("count", count);
            Map<String, Integer> types = pairTypes.getOrDefault(source, Map.of()).getOrDefault(target, Map.of());
            if (types.size() == 1) item.put("type", types.keySet().iterator().next());
            else if (!types.isEmpty()) item.put("types", new JSONArray(types.keySet()));
            relationships.add(item);
        }));
        summary = new JSONObject();
        summary.put("classes", classes);
        summary.put("relationships", relationships);
        summary.put("nodeCount", nodes.size());
        summary.put("edgeCount", edgeCount);
        summary.put("componentCount", components.size());
        summary.put("isolatedNodeCount", isolated);
        summary.put("largestComponentSize", components.values().stream().mapToInt(Integer::intValue).max().orElse(0));
        summary.put("version", version);
        summary.put("generatedAt", generatedAt);
        Map<String, Integer> sampledCounts = new HashMap<>();
        Map<String, JSONObject> sampled = new LinkedHashMap<>();
        nodes.forEach((id, node) -> {
            String className = node.getString("class");
            if (sampledCounts.getOrDefault(className, 0) < 50) {
                sampled.put(id, node);
                sampledCounts.merge(className, 1, Integer::sum);
            }
        });
        JSONArray sampledEdges = new JSONArray();
        java.util.Set<String> seenEdges = new java.util.HashSet<>();
        boolean edgesTruncated = false;
        for (String nodeId : nodes.keySet()) for (JSONObject edge : adjacency.get(nodeId)) {
            if (!sampled.containsKey(edge.getString("source")) || !sampled.containsKey(edge.getString("target"))) continue;
            String identity = JSONArray.of(edge.get("source"), edge.get("target"), edge.get("type")).toJSONString();
            if (!seenEdges.add(identity)) continue;
            if (sampledEdges.size() >= 2000) { edgesTruncated = true; continue; }
            sampledEdges.add(edge);
        }
        summary.put("overviewNodes", new JSONArray(sampled.values()));
        summary.put("overviewEdges", sampledEdges);
        summary.put("overviewEdgesTruncated", edgesTruncated);
        summary.put("complete", graph.getBoolean("complete"));
        summary.put("failures", graph.getJSONArray("failures"));
        summary.put("relationTypes", rawEdges == null ? new JSONArray() : new JSONArray(rawEdges.stream()
            .map(raw -> ((JSONObject) raw).getString("type")).filter(java.util.Objects::nonNull).distinct().sorted().toList()));
    }

    private static String find(Map<String, String> parents, String id) {
        String root = id;
        while (!parents.get(root).equals(root)) root = parents.get(root);
        while (!id.equals(root)) {
            String next = parents.get(id);
            parents.put(id, root);
            id = next;
        }
        return root;
    }

    JSONObject summary() { return summary; }

    JSONObject search(JSONObject request) {
        String term = request.getString("term");
        term = term == null ? "" : term.trim().toLowerCase(Locale.ROOT);
        String className = request.getString("class");
        int limit = limit(request);
        JSONArray matches = new JSONArray();
        boolean more = false;
        for (JSONObject node : nodes.values()) {
            if (className != null && !className.equals(node.getString("class"))) continue;
            String text = node.getString("id") + " " + node.getString("name") + " " + node.getString("class");
            if (!text.toLowerCase(Locale.ROOT).contains(term)) continue;
            if (matches.size() == limit) { more = true; break; }
            matches.add(node);
        }
        JSONObject result = new JSONObject();
        result.put("nodes", matches);
        result.put("hasMore", more);
        result.put("version", version);
        return result;
    }

    JSONObject neighborhood(JSONObject request) {
        String id = request.getString("id");
        if (!nodes.containsKey(id)) throw new IllegalArgumentException("Instance is not in the generated graph");
        int offset = request.getIntValue("offset");
        if (offset < 0) throw new IllegalArgumentException("Offset must not be negative");
        List<JSONObject> incident = adjacency.get(id);
        String relationType = request.getString("relationType");
        String neighborClass = request.getString("neighborClass");
        String direction = request.getString("direction");
        if (direction != null && !List.of("both", "incoming", "outgoing").contains(direction))
            throw new IllegalArgumentException("Unknown relationship direction");
        List<JSONObject> filtered = incident.stream().filter(edge -> {
            JSONObject other = nodes.get(id.equals(edge.getString("source")) ? edge.getString("target") : edge.getString("source"));
            return (!"incoming".equals(direction) || id.equals(edge.getString("target")))
                && (!"outgoing".equals(direction) || id.equals(edge.getString("source")))
                && (relationType == null || relationType.isBlank() || relationType.equals(edge.getString("type")))
                && (neighborClass == null || neighborClass.isBlank() || (other != null && neighborClass.equals(other.getString("class"))));
        }).toList();
        int end = (int) Math.min(filtered.size(), (long) offset + limit(request));
        JSONArray edges = new JSONArray();
        Map<String, JSONObject> pageNodes = new LinkedHashMap<>();
        pageNodes.put(id, nodes.get(id));
        for (int i = offset; i < end; i++) {
            JSONObject edge = filtered.get(i);
            edges.add(edge);
            pageNodes.put(edge.getString("source"), nodes.get(edge.getString("source")));
            pageNodes.put(edge.getString("target"), nodes.get(edge.getString("target")));
        }
        JSONObject result = new JSONObject();
        result.put("nodes", new JSONArray(pageNodes.values()));
        result.put("edges", edges);
        result.put("total", filtered.size());
        result.put("nextOffset", end < filtered.size() ? end : null);
        result.put("version", version);
        return result;
    }

    private static int limit(JSONObject request) {
        int limit = request.containsKey("limit") ? request.getIntValue("limit") : 100;
        if (limit < 1 || limit > 200) throw new IllegalArgumentException("Limit must be between 1 and 200");
        return limit;
    }
}
