package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Field;
import java.util.Map;

/** Local-only synthetic fixture; graph requests execute the production service and index. */
public final class InstanceGraphDemoServer {
    public static void main(String[] args) throws Exception {
        JSONArray nodes = new JSONArray(), edges = new JSONArray();
        String[] types = {"Customer", "Order", "Product", "Category", "Warehouse"};
        for (int i = 0; i < 50000; i++) {
            JSONObject node = new JSONObject();
            node.put("id", types[i % 5] + ":" + i);
            node.put("class", types[i % 5]);
            node.put("name", i == 0 ? "Hub customer" : types[i % 5] + " " + i);
            nodes.add(node);
        }
        // A 5,000-neighbor hub, a large cycle, disconnected pairs and 5,000 isolated nodes.
        for (int i = 1; i <= 5000; i++) edges.add(edge(nodes, 0, i));
        for (int i = 5001; i < 35000; i++) edges.add(edge(nodes, i, i + 1));
        edges.add(edge(nodes, 35000, 5001));
        for (int i = 35001; i < 44999; i += 2) edges.add(edge(nodes, i, i + 1));
        for (int i = 5001; edges.size() < 50000; i++) edges.add(edge(nodes, i, i + 2));
        JSONObject graph = new JSONObject();
        graph.put("nodes", nodes);
        graph.put("edges", edges);
        InstanceGraphIndex index = new InstanceGraphIndex(graph);
        DataServiceImpl service = new DataServiceImpl();
        Field field = DataServiceImpl.class.getDeclaredField("instanceGraphIndexes");
        field.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, InstanceGraphIndex> indexes = (Map<String, InstanceGraphIndex>) field.get(service);
        indexes.put("demo", index);
        JSONObject metas = new JSONObject();
        JSONArray classes = new JSONArray();
        for (String type : types) {
            JSONObject cls = new JSONObject();
            cls.put("className", type);
            cls.put("showName", type);
            cls.put("attrs", JSONArray.parseArray("[{\"name\":\"id\",\"showName\":\"ID\",\"type\":\"varchar\"}]"));
            classes.add(cls);
        }
        metas.put("classDef", classes);
        metas.put("relationship_rule", new JSONObject());
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 18081), 0);
        server.createContext("/", exchange -> {
            JSONObject ret;
            try {
                byte[] body = exchange.getRequestBody().readAllBytes();
                JSONObject request = body.length == 0 ? new JSONObject() : JSONObject.parseObject(new String(body, StandardCharsets.UTF_8));
                String path = exchange.getRequestURI().getPath();
                if (path.startsWith("/data/instanceGraph/")) {
                    ret = service.queryInstanceGraph(path.substring(path.lastIndexOf('/') + 1), request, "demo");
                } else {
                    ret = new JSONObject();
                    ret.put("success", true);
                    if (path.equals("/admin/getMetas")) ret.put("data", metas);
                    else if (path.equals("/data/queryInfoByNode")) {
                        JSONObject details = new JSONObject();
                        details.put("classDef", classes.getJSONObject(0));
                        details.put("data", request);
                        ret.put("data", details);
                    } else if (path.equals("/data/getWholeClassDataByPage")) {
                        ret.put("data", new JSONArray()); ret.put("total_count", 0);
                    } else ret.put("data", new JSONObject());
                }
                byte[] output = ret.toJSONString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, output.length);
                exchange.getResponseBody().write(output);
            } catch (Exception error) {
                byte[] output = error.toString().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, output.length);
                exchange.getResponseBody().write(output);
            } finally { exchange.close(); }
        });
        server.start();
        System.out.println("Synthetic graph API: http://127.0.0.1:18081 (50,000 nodes / 50,000 connections)");
    }

    private static JSONObject edge(JSONArray nodes, int source, int target) {
        JSONObject edge = new JSONObject();
        edge.put("source", nodes.getJSONObject(source).getString("id"));
        edge.put("target", nodes.getJSONObject(target).getString("id"));
        return edge;
    }
}
