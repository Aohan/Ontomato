package io.ontomato.dataengine.service.impl;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.dao.AssetLookupPolicy;

/** OSS checks information_schema before ActionDao and MetricViewDao lookups. */
@Configuration
public class OssAssetLookupAssembly {

    @Bean
    public AssetLookupPolicy assetLookupPolicy() {
        return (jdbc, tableName) -> tableExists(jdbc, tableName);
    }

    private static boolean tableExists(JdbcTemplate jdbc, String tableName) {
        try {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
                    Integer.class, tableName);
            return count != null && count > 0;
        } catch (Exception e) {
            return false;
        }
    }
}
