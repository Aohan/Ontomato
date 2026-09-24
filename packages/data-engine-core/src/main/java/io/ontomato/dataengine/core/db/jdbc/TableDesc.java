package io.ontomato.dataengine.core.db.jdbc;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Objects;

import io.ontomato.dataengine.core.bean.Entity;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
public class TableDesc {

    /**
     * Marker value for unlimited-length text in @Schema (>= 30000 maps to the PostgreSQL TEXT type)
     */
    public static final int UNLIMITED_TEXT_LENGTH = 65_536;

    public final Class<? extends Entity> entityClass;

    public final String tableName;

    public final String alias;

    public final List<ColumnInfo> columns;

    public final String insertSql;

    public final String selectSql;

    public final String deleteSql;

    public final DateSet createTimeSet;

    public final DateSet modifyTimeSet;

    public TableDesc(Class<? extends Entity> entityClass) {
        this.entityClass = entityClass;
        String[] nameAndDesc = getTableNameAndDesc();
        this.tableName = nameAndDesc[0];
        this.alias = nameAndDesc[1];
        this.columns = Arrays.stream(entityClass.getDeclaredFields())
                .filter(f -> !Modifier.isStatic(f.getModifiers()) && !Modifier.isFinal(f.getModifiers()))
                .map(ColumnInfo::from)
                .toList();
        DateSet createTimeSet = null;
        DateSet modifyTimeSet = null;
        for (ColumnInfo c : this.columns) {
            if ("createTime".equals(c.field().getName())) {
                createTimeSet = new DateSet(c.field);
            }
            if ("modifyTime".equals(c.field().getName())) {
                modifyTimeSet = new DateSet(c.field);
            }
        }
        this.createTimeSet = createTimeSet;
        this.modifyTimeSet = modifyTimeSet;
        this.insertSql = buildInsertSql();
        this.selectSql = buildSelectSql();
        this.deleteSql = "DELETE FROM " + tableName;
    }

    public String ddl() {
        StringBuilder sb = new StringBuilder();
        sb.append("CREATE TABLE IF NOT EXISTS ").append(tableName).append(" (\n");
        sb.append("  id VARCHAR(1024) PRIMARY KEY");
        for (ColumnInfo c : columns) {
            if ("id".equals(c.columnName())) {
                continue;
            }
            sb.append(",\n  ").append(c.columnName()).append(" ").append(c.dbType());
        }
        sb.append("\n)");
        return sb.toString();
    }

    private String[] getTableNameAndDesc() {
        String[] r = new String[] { null, "" };
        Schema clsSchema = entityClass.getAnnotation(Schema.class);
        if (clsSchema != null) {
            r[0] = clsSchema.name().trim();
            r[1] = clsSchema.description();
        }
        r[0] = toSnakeCase(isEmpty(r[0]) ? entityClass.getSimpleName() : r[0]);
        return r;
    }

    private String buildInsertSql() {
        StringBuilder sql = new StringBuilder("INSERT INTO ").append(tableName).append(" (");
        for (int i = 0; i < columns.size(); i++) {
            sql.append(columns.get(i).columnName());
            if (i < columns.size() - 1)
                sql.append(", ");
        }
        sql.append(") VALUES (");
        for (int i = 0; i < columns.size(); i++) {
            sql.append("?");
            if (i < columns.size() - 1)
                sql.append(", ");
        }
        sql.append(")");
        return sql.toString();
    }

    private String buildSelectSql() {
        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(String.join(",", this.columns.stream()
                .map(c -> Objects.equals(c.columnName, c.field.getName()) ? c.columnName
                        : c.columnName + " AS " + c.field.getName())
                .toList()));
        sql.append(" FROM ").append(this.tableName);
        return sql.toString();
    }

    private static boolean isEmpty(String s) {
        return s == null || "".equals(s.trim());
    }

    private static String toSnakeCase(String name) {
        return name.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase();
    }

    public static record ColumnInfo(Field field, String columnName, String dbType, String comments) {

        public static ColumnInfo from(Field field) {
            field.setAccessible(true);
            Schema schema = field.getAnnotation(Schema.class);
            String name = null;
            String comments = null;
            int maxLength = 0;
            if (schema != null) {
                name = schema.name();
                comments = schema.description();
                maxLength = schema.maxLength() == Integer.MAX_VALUE ? 0 : schema.maxLength();
            }
            String columnName = toSnakeCase(isEmpty(name) ? field.getName() : name);
            String dbType = mapToDbType(field.getType(), maxLength);
            return new ColumnInfo(field, columnName, dbType, comments);
        }

        private static String mapToDbType(Class<?> type, int maxLength) {

            String StringDbType = "TEXT";
            if (maxLength >= 30000) {
                StringDbType = "TEXT";
            } else if (maxLength == 0) {
                StringDbType = "VARCHAR(255)";
            } else if (maxLength > 0) {
                StringDbType = "VARCHAR(" + maxLength + ")";
            } else {
                StringDbType = "VARCHAR(255)";
            }

            return switch (type.getSimpleName()) {
                case "Integer", "int", "Short", "short", "Byte", "byte" -> "INTEGER";
                case "Long", "long" -> "BIGINT";
                case "Double", "double", "Float", "float" -> "DOUBLE PRECISION";
                case "Boolean", "boolean" -> "BOOLEAN";
                case "String", "CharSequence", "StringBuilder", "StringBuffer" -> StringDbType;
                case "LocalDateTime", "Instant", "Date", "Timestamp" -> "TIMESTAMP";
                default -> "VARCHAR(255)";
            };
        }
    }

    public void setCreateTime(Object data, Date date) {
        if (createTimeSet != null) {
            createTimeSet.set(data, date);
        }
    }

    public void setModifyTime(Object data, Date date) {
        if (modifyTimeSet != null) {
            modifyTimeSet.set(data, date);
        }
    }

    record DateSet(Field f) {

        public void set(Object data, Date date) {
            if (date == null || data == null) {
                return;
            }
            Object v = date;
            if (f.getType() == Long.class) {
                v = date.getTime();
            }
            try {
                f.set(data, v);
            } catch (Exception e) {
            }
        }
    }

}
