package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.UnsatisfiedDependencyException;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.config.EmbeddingModelProperties;
import io.ontomato.dataengine.service.ai.EmbeddingService;

class AssetLookupPolicyRequiredTest {

    @Test
    void actionAndMetricViewDaosDoNotStartWithoutThePolicy() {
        assertMissing(ActionDao.class);
        assertMissing(MetricViewDao.class);
    }

    private static void assertMissing(Class<?> daoType) {
        UnsatisfiedDependencyException failure = assertThrows(UnsatisfiedDependencyException.class, () -> {
            try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
                ctx.addBeanFactoryPostProcessor(factory -> {
                    factory.registerResolvableDependency(JdbcTemplate.class, new JdbcTemplate());
                    factory.registerResolvableDependency(EmbeddingService.class, new EmbeddingService());
                    EmbeddingModelProperties properties = new EmbeddingModelProperties();
                    properties.setDimensions(3);
                    factory.registerResolvableDependency(EmbeddingModelProperties.class, properties);
                });
                ctx.register(daoType);
                ctx.refresh();
            }
        });
        assertTrue(failure.getMessage().contains("AssetLookupPolicy"), failure.getMessage());
    }
}
