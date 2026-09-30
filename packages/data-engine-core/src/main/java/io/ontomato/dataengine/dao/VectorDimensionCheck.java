package io.ontomato.dataengine.dao;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.EmbeddingModelProperties;

import jakarta.annotation.PostConstruct;

/**
 * At startup, check whether the dimension of every pgvector column in the current schema equals the configured embedding dimension.
 * If any column does not match, startup fails: the table must be rebuilt and re-vectorized manually, never started with a wrong dimension.
 */
@Component
public class VectorDimensionCheck {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EmbeddingModelProperties embeddingModelProperties;

    @PostConstruct
    public void check() {
        Integer configuredDimension = embeddingModelProperties.getDimensions();
        List<Map<String, Object>> columns = jdbcTemplate.queryForList(
                "SELECT c.relname AS table_name, a.attname AS column_name, a.atttypmod AS dimension "
                        + "FROM pg_attribute a "
                        + "JOIN pg_class c ON c.oid = a.attrelid "
                        + "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        + "JOIN pg_type t ON t.oid = a.atttypid "
                        + "WHERE t.typname = 'vector' AND c.relkind = 'r' "
                        + "AND n.nspname = current_schema() "
                        + "AND a.attnum > 0 AND NOT a.attisdropped "
                        + "ORDER BY c.relname, a.attname");
        for (Map<String, Object> column : columns) {
            Integer tableDimension = ((Number) column.get("dimension")).intValue();
            if (!tableDimension.equals(configuredDimension)) {
                throw new IllegalStateException("Vector column " + column.get("table_name") + "."
                        + column.get("column_name") + " has dimension " + tableDimension
                        + "; configured embedding dimension is " + configuredDimension
                        + ". Recreate the table and regenerate embeddings.");
            }
        }
    }

}
