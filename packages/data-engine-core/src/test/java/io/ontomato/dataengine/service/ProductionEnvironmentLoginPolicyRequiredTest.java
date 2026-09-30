package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.UnsatisfiedDependencyException;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.service.impl.EnvServiceImpl;

class ProductionEnvironmentLoginPolicyRequiredTest {

    @Test
    void envServiceDoesNotStartWithoutThePolicy() {
        UnsatisfiedDependencyException failure = assertThrows(UnsatisfiedDependencyException.class, () -> {
            try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
                ctx.addBeanFactoryPostProcessor(factory -> {
                    factory.registerResolvableDependency(DataRagConfig.class, new DataRagConfig());
                    factory.registerResolvableDependency(BusinessConfigService.class, unused(BusinessConfigService.class));
                    factory.registerResolvableDependency(io.ontomato.dataengine.dataAdapter.DataAdapterRegistry.class, new io.ontomato.dataengine.dataAdapter.DataAdapterRegistry(java.util.List.of(), new DataRagConfig()));
                    factory.registerResolvableDependency(AdminService.class, unused(AdminService.class));
                    factory.registerResolvableDependency(SchemaPermissionService.class, unused(SchemaPermissionService.class));
                });
                ctx.register(EnvServiceImpl.class);
                ctx.refresh();
            }
        });
        assertTrue(failure.getMessage().contains("ProductionEnvironmentLoginPolicy"), failure.getMessage());
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
