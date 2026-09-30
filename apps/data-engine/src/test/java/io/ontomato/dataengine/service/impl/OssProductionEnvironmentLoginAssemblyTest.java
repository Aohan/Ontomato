package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ProductionEnvironmentLoginPolicy;
import io.ontomato.dataengine.service.SchemaPermissionService;

class OssProductionEnvironmentLoginAssemblyTest {

    @Test
    void blankAccountSkipsLoginAndConfiguredAccountSendsTheReturnedToken() throws Exception {
        DataRagConfig config = new DataRagConfig();
        try (Remote remote = new Remote(config);
                AnnotationConfigApplicationContext ctx = remote.open(OssProductionEnvironmentLoginAssembly.class)) {
            assertEquals(1, ctx.getBeansOfType(ProductionEnvironmentLoginPolicy.class).size());
            EnvServiceImpl service = ctx.getBean(EnvServiceImpl.class);
            for (String blank : new String[] { null, "", "   " }) {
                config.setProductionEnvUser(blank);
                config.setProductionEnvPwd(null);
                four(service, remote, false);
            }
            config.setProductionEnvUser("acct");
            config.setProductionEnvPwd("pw");
            four(service, remote, true);
        }
    }

    private static void four(EnvServiceImpl service, Remote remote, boolean login) throws Exception {
        remote.hits.clear();
        Exception schema = org.junit.jupiter.api.Assertions.assertThrows(
                Exception.class, () -> service.importSchema(new FixedUser()));
        assertEquals("Failed to get class and relationship definitions of the production environment", schema.getMessage());
        assertRound(remote, "GET", "/admin/getSchema", login);

        remote.hits.clear();
        JSONObject dsl = new JSONObject();
        dsl.put("query", "orders");
        assertEquals(0, service.executeDslInProductionEnv(dsl).getJSONArray("rows").size());
        assertRound(remote, "POST", "/dsl/executeV1", login);

        remote.hits.clear();
        assertEquals("red", service.queryDistinctAttrValueInProductionEnv("Order", "color", null, 0));
        assertRound(remote, "POST", "/admin/queryDistinctAttrValue", login);

        remote.hits.clear();
        assertEquals("{\"items\":1}", service.queryBusinessKnowledgeInProductionEnv("q", null));
        assertRound(remote, "POST", "/knowledge/findknowledge", login);
    }

    private static void assertRound(Remote remote, String method, String dataPath, boolean login) {
        int data = login ? 1 : 0;
        if (login) {
            assertEquals("/sso/doLogin", remote.hits.get(0).path());
            assertEquals("POST", remote.hits.get(0).method());
            assertTrue(remote.hits.get(0).body().contains("\"loginCode\""));
            assertTrue(remote.hits.get(0).body().contains("\"password\""));
        }
        assertEquals(data + 1, remote.hits.size());
        assertEquals(dataPath, remote.hits.get(data).path());
        assertEquals(method, remote.hits.get(data).method());
        assertEquals(login ? "issued-tk" : "", remote.hits.get(data).tk());
    }

    private static final class FixedUser implements User {
        public String getId() { return "u"; }
        public String getLoginCode() { return "u"; }
        public String getUserName() { return "u"; }
        public boolean isEnable() { return true; }
        public String getDomainId() { return "d1"; }
    }

    static final class Remote implements AutoCloseable {
        final List<Hit> hits = new ArrayList<>();
        private final HttpServer server;
        private final DataRagConfig config;

        Remote(DataRagConfig config) throws IOException {
            this.config = config;
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                hits.add(new Hit(
                        exchange.getRequestMethod(),
                        exchange.getRequestURI().getPath(),
                        exchange.getRequestHeaders().getFirst("tk"),
                        body));
                byte[] response = payload(exchange.getRequestURI().getPath()).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            config.setProductionEnvUrl("http://127.0.0.1:" + server.getAddress().getPort());
        }

        AnnotationConfigApplicationContext open(Class<?> assembly) {
            AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
            context.addBeanFactoryPostProcessor(factory -> {
                factory.registerResolvableDependency(DataRagConfig.class, config);
                factory.registerResolvableDependency(BusinessConfigService.class, unused(BusinessConfigService.class));
                factory.registerResolvableDependency(io.ontomato.dataengine.dataAdapter.DataAdapterRegistry.class, new io.ontomato.dataengine.dataAdapter.DataAdapterRegistry(List.of(), config));
                factory.registerResolvableDependency(AdminService.class, unused(AdminService.class));
                factory.registerResolvableDependency(SchemaPermissionService.class, unused(SchemaPermissionService.class));
            });
            context.register(assembly, EnvServiceImpl.class);
            context.refresh();
            return context;
        }

        private static String payload(String path) {
            if ("/sso/doLogin".equals(path)) {
                return "{\"data\":{\"tk\":\"issued-tk\"}}";
            }
            if ("/admin/getSchema".equals(path)) {
                return "{\"success\":false}";
            }
            if ("/admin/queryDistinctAttrValue".equals(path)) {
                return "{\"success\":true,\"data\":\"red\"}";
            }
            if ("/knowledge/findknowledge".equals(path)) {
                return "{\"items\":1}";
            }
            return "{\"rows\":[]}";
        }

        public void close() {
            server.stop(0);
        }
    }

    record Hit(String method, String path, String tk, String body) {
    }

    private static Object unused(Class<?> type) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { type }, (proxy, method, args) -> {
            if (method.getDeclaringClass() == Object.class) {
                if ("toString".equals(method.getName())) {
                    return type.getSimpleName();
                }
                if ("hashCode".equals(method.getName())) {
                    return 0;
                }
                return false;
            }
            throw new IllegalStateException(method.getName());
        });
    }
}
