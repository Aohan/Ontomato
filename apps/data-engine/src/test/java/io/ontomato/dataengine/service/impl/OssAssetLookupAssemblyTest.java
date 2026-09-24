package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.config.EmbeddingModelProperties;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.AssetLookupPolicy;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.ai.EmbeddingService;

class OssAssetLookupAssemblyTest {

    private static final String METADATA =
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?";

    @Test
    void ossPolicyBlocksLookupsBeforeTheDataSelect() {
        ScriptedJdbc jdbc = new ScriptedJdbc();
        try (AnnotationConfigApplicationContext ctx = open(jdbc, OssAssetLookupAssembly.class)) {
            assertEquals(1, ctx.getBeansOfType(AssetLookupPolicy.class).size());
            ActionDao actions = ctx.getBean(ActionDao.class);
            MetricViewDao views = ctx.getBean(MetricViewDao.class);
            Action action = new Action();
            action.setId("id-7");
            MetricView view = new MetricView();
            view.setId("id-7");
            check(jdbc, "action", action, actions::queryById, domainId -> actions.queryList(null, null, null, domainId));
            check(jdbc, "metric_view", view, views::queryById, domainId -> views.queryList(null, null, null, null, domainId));
        }
    }

    private static void check(ScriptedJdbc jdbc, String table, Object sample, ById byId, ByDomain list) {
        Object[] pair = new Object[] { sample, "function-1" };
        List<Object[]> row = new ArrayList<>();
        row.add(pair);

        jdbc.prepare(1, null, row, null);
        Object[] found = byId.query("id-7");
        assertEquals(2, found.length);
        assertSame(sample, found[0]);
        assertEquals("function-1", found[1]);
        assertEquals(METADATA, jdbc.sql.get(0));
        assertEquals(2, jdbc.sql.size());
        assertEquals(table, jdbc.args.get(0)[0]);
        assertTrue(jdbc.sql.get(1).contains("FROM " + table + " "));
        assertEquals("id-7", jdbc.args.get(1)[0]);

        jdbc.prepare(1, null, row, null);
        assertSame(row, list.query("domain-9"));
        assertEquals(METADATA, jdbc.sql.get(0));
        assertEquals(table, jdbc.args.get(0)[0]);
        assertTrue(jdbc.sql.get(1).contains("domain_id = ?"));
        assertTrue(Arrays.asList(jdbc.args.get(1)).contains("domain-9"));

        jdbc.prepare(0, null, row, null);
        assertNull(byId.query("id-7"));
        assertEquals(List.of(METADATA), jdbc.sql);
        jdbc.prepare(0, null, row, null);
        assertEquals(List.of(), list.query("domain-9"));
        assertEquals(List.of(METADATA), jdbc.sql);

        jdbc.prepare(null, null, row, null);
        assertNull(byId.query("id-7"));
        assertEquals(List.of(METADATA), jdbc.sql);
        jdbc.prepare(null, null, row, null);
        assertEquals(List.of(), list.query("domain-9"));
        assertEquals(List.of(METADATA), jdbc.sql);

        jdbc.prepare(1, new RuntimeException("metadata down"), row, null);
        assertNull(byId.query("id-7"));
        assertEquals(List.of(METADATA), jdbc.sql);
        jdbc.prepare(1, new RuntimeException("metadata down"), row, null);
        assertEquals(List.of(), list.query("domain-9"));
        assertEquals(List.of(METADATA), jdbc.sql);

        jdbc.prepare(1, null, row, new RuntimeException("select failed"));
        assertNull(byId.query("id-7"));
        assertTrue(jdbc.sawData(table));
        jdbc.prepare(1, null, row, new RuntimeException("select failed"));
        assertEquals(List.of(), list.query("domain-9"));
        assertTrue(jdbc.sawData(table));
    }

    private static AnnotationConfigApplicationContext open(ScriptedJdbc jdbc, Class<?> assembly) {
        AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext();
        ctx.addBeanFactoryPostProcessor(factory -> {
            factory.registerResolvableDependency(JdbcTemplate.class, jdbc);
            EmbeddingModelProperties properties = new EmbeddingModelProperties();
            properties.setDimensions(3);
            factory.registerResolvableDependency(EmbeddingModelProperties.class, properties);
            factory.registerResolvableDependency(EmbeddingService.class, new EmbeddingService());
        });
        ctx.register(assembly, ActionDao.class, MetricViewDao.class);
        ctx.refresh();
        return ctx;
    }

    private interface ById {
        Object[] query(String id);
    }

    private interface ByDomain {
        List<Object[]> query(String domainId);
    }

    static final class ScriptedJdbc extends JdbcTemplate {
        final List<String> sql = new ArrayList<>();
        final List<Object[]> args = new ArrayList<>();
        Integer tableCount;
        RuntimeException metadataFailure;
        List<Object[]> rows = List.of();
        RuntimeException queryFailure;

        void prepare(Integer tableCount, RuntimeException metadataFailure, List<Object[]> rows, RuntimeException queryFailure) {
            this.tableCount = tableCount;
            this.metadataFailure = metadataFailure;
            this.rows = rows;
            this.queryFailure = queryFailure;
            sql.clear();
            args.clear();
        }

        @Override
        public void execute(String statement) {
        }

        @Override
        public <T> T queryForObject(String statement, Class<T> type, Object... params) {
            sql.add(statement);
            args.add(params);
            if (metadataFailure != null) {
                throw metadataFailure;
            }
            return type.cast(tableCount);
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> query(String statement, RowMapper<T> mapper, Object... params) {
            sql.add(statement);
            args.add(params);
            if (queryFailure != null) {
                throw queryFailure;
            }
            return (List<T>) rows;
        }

        boolean sawData(String table) {
            return sql.stream().anyMatch(statement -> statement.contains("FROM " + table + " "));
        }
    }
}
