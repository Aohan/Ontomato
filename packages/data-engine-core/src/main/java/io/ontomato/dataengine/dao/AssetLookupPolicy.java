package io.ontomato.dataengine.dao;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Whether ActionDao and MetricViewDao should run an id or list lookup.
 * Applications supply the bean. This is not a user or schema permission check.
 */
public interface AssetLookupPolicy {

    boolean shouldQuery(JdbcTemplate jdbc, String tableName);
}
