package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.db.jdbc.SuperAdminSeed;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.IdentityRuntimeSettings;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.SchemaImportAuthorization;
import io.ontomato.dataengine.service.SchemaPermissionService;

import dev.langchain4j.service.tool.ToolProvider;
import dev.langchain4j.service.tool.ToolProviderResult;

class OssStartupAssemblyTest {

    @Test
    void ossBeansAreTheOnlyIdentityAndToolChoices() {
        try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
            ctx.register(
                    AnonymousIdentityService.class,
                    SingleDomainSvc.class,
                    NoopSchemaPermissionService.class,
                    OssSuperAdminSeed.class,
                    AnonymousDataPermissionLookup.class,
                    OssIdentityRuntimeSettings.class,
                    EmptyExternalToolProvider.class);
            ctx.refresh();

            assertEquals(1, ctx.getBeansOfType(IdentityService.class).size());
            assertEquals(1, ctx.getBeansOfType(DomainSvc.class).size());
            assertEquals(1, ctx.getBeansOfType(SchemaPermissionService.class).size());
            assertEquals(1, ctx.getBeansOfType(SuperAdminSeed.class).size());
            assertEquals(1, ctx.getBeansOfType(DataPermissionLookup.class).size());
            assertEquals(1, ctx.getBeansOfType(IdentityRuntimeSettings.class).size());
            assertEquals(1, ctx.getBeansOfType(ToolProvider.class).size());
            assertTrue(ctx.getBeansOfType(JdbcTemplate.class).isEmpty());

            IdentityService identity = ctx.getBean(IdentityService.class);
            User user = identity.getCurrentUser();
            assertEquals("admin", user.getId());
            assertEquals("admin", identity.getCurrentUserId());
            assertEquals("1", user.getDomainId());
            assertTrue(identity.getCurrentUserDataPermission().isFullData());
            assertTrue(ctx.getBean(DataPermissionLookup.class).getDataPermission("other", "9").isFullData());

            DomainSvc domains = ctx.getBean(DomainSvc.class);
            assertEquals("1", domains.list().get(0).getId());
            assertThrows(UnsupportedOperationException.class, () -> domains.create("n", "d", "a"));
            assertThrows(UnsupportedOperationException.class, () -> domains.update("1", "n", "d"));
            assertThrows(UnsupportedOperationException.class, () -> domains.delete("1"));

            SchemaPermissionService permissions = ctx.getBean(SchemaPermissionService.class);
            SchemaImportAuthorization prepared = permissions.prepareImport(user);
            assertTrue(prepared.postIds().isEmpty());
            permissions.grantImport(new SchemaImportAuthorization(List.of("post-1")), List.of(Map.of("name", "Order")));

            ctx.getBean(SuperAdminSeed.class).initSuperAdmin();

            IdentityRuntimeSettings settings = ctx.getBean(IdentityRuntimeSettings.class);
            assertEquals(Map.of(), settings.ssoSettings());
            assertEquals(Map.of(), settings.ldapSettings());

            ToolProviderResult tools = ctx.getBean(ToolProvider.class).provideTools(null);
            assertTrue(tools.tools().isEmpty());
        }
    }

    @Test
    void enterpriseTypesAreAbsentFromTheOssClasspath() {
        assertAbsent(
                "cn.dev33.satoken.stp.StpUtil",
                "io.ontomato.dataengine.service.sys.impl.SaTokenIdentityService",
                "io.ontomato.dataengine.service.sys.impl.SuperAdminSeedImpl",
                "io.ontomato.dataengine.service.sys.impl.SchemaPermissionServiceImpl",
                "io.ontomato.dataengine.service.sys.impl.EnterpriseIdentityRuntimeSettings",
                "io.ontomato.dataengine.config.SSOProps",
                "io.ontomato.dataengine.service.ldap.LdapProps",
                "io.ontomato.dataengine.util.AesEncryptUtil",
                "io.ontomato.dataengine.core.utils.UserEncryptUtil",
                "io.ontomato.dataengine.config.LicenseConfig",
                "dev.langchain4j.mcp.McpToolProvider");
    }

    private static void assertAbsent(String... names) {
        for (String name : names) {
            assertThrows(ClassNotFoundException.class, () -> Class.forName(name), name);
        }
    }

}
