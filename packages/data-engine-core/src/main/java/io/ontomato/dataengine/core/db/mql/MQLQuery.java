package io.ontomato.dataengine.core.db.mql;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.alibaba.fastjson2.annotation.JSONField;
import com.alibaba.fastjson2.reader.ObjectReader;

import lombok.Data;
import lombok.NoArgsConstructor;

public interface MQLQuery {
    public static final java.util.Set<String> PROPERTY_SUPPORTED_OPERATORS = java.util.Set.of("=", "!=", ">", ">=", "<",
            "<=", "between", "like", "in", "is", "is not");

    static void validateValueForOperator(String op, Object val) {
        switch (op) {
        case "between" -> {
            if (!(val instanceof List<?> list) || list.size() != 2) {
                throw new IllegalArgumentException("'between' requires a list of two values");
            }
        }
        case "in" -> {
            if (!(val instanceof List<?>)) {
                throw new IllegalArgumentException("'in' requires a list of values");
            }
        }
        case "is", "is not" -> {
            if (val != null) {
                throw new IllegalArgumentException("'is'/'is not' must have null value");
            }
        }
        default -> {
            if (val == null) {
                throw new IllegalArgumentException("Value cannot be null for operator: " + op);
            }
        }
        }
    }

    /**
     * Get the operator
     * 
     * @return
     */
    String getOperator();

    public static class LogicQueryObjectReader implements ObjectReader<List<MQLQuery>> {

        @Override
        public List<MQLQuery> readObject(JSONReader jsonReader, Type fieldType, Object fieldName, long features) {
            return jsonReader.readJSONArray().stream().map(obj -> (JSONObject) obj)
                    .map(MQLQuery::parseQuery)
                    .collect(Collectors.toList());
        }

    }

    static MQLQuery parseQuery(JSONObject object) {
        if (object == null) throw new IllegalArgumentException("Query must be an object");
        if (!"logic".equals(object.getString("operator"))) {
            return new PropertyQuery(object.getString("field"), object.getString("operator"), object.get("value"));
        }

        List<String> branches = List.of("and", "or", "not").stream()
                .filter(object::containsKey).toList();
        if (branches.size() != 1) {
            throw new IllegalArgumentException("Logic query must contain exactly one of and, or, not");
        }
        JSONArray source = object.getJSONArray(branches.getFirst());
        if (source == null) throw new IllegalArgumentException("Logic query branch must be an array");
        LogicQuery result = switch (branches.getFirst()) {
            case "and" -> LogicQuery.and();
            case "or" -> LogicQuery.or();
            default -> LogicQuery.not();
        };
        for (Object child : source) {
            if (!(child instanceof JSONObject childObject)) {
                throw new IllegalArgumentException("Logic query child must be an object");
            }
            result.add(parseQuery(childObject));
        }
        return result;
    }

    public static class PropertyQuery implements MQLQuery {

        // Whitelist of supported operators
        final String field;
        final String operator;
        @JSONField(serializeFeatures = Feature.WriteNulls)
        final Object value;

        public PropertyQuery(String field, String operator, Object value) {
            super();
            this.field = field;
            this.operator = operator;
            this.value = value;

            if (field == null || field.isBlank()) {
                throw new IllegalArgumentException("Field must not be blank");
            }
            if (!PROPERTY_SUPPORTED_OPERATORS.contains(operator)) {
                throw new IllegalArgumentException("Unsupported operator: " + operator);
            }
            // Validate that value matches the operator
            MQLQuery.validateValueForOperator(operator, value);
        }

        public String getField() {
            return field;
        }

        @Override
        public String getOperator() {
            return operator;
        }

        public Object getValue() {
            return value;
        }
    }

    @Data
    @NoArgsConstructor
    public static class LogicQuery implements MQLQuery {
        @JSONField(ordinal = 1)
        final String operator = "logic";

        @JSONField(deserializeUsing = LogicQueryObjectReader.class, ordinal = 2, serialize = true)
        List<MQLQuery> and;
        @JSONField(deserializeUsing = LogicQueryObjectReader.class, ordinal = 3, serialize = true)
        List<MQLQuery> or;
        @JSONField(deserializeUsing = LogicQueryObjectReader.class, ordinal = 4, serialize = true)
        List<MQLQuery> not;

        private LogicQuery(List<MQLQuery> and, List<MQLQuery> or, List<MQLQuery> not) {
            super();
            this.and = and;
            this.or = or;
            this.not = not;
        }

        @JSONField(serialize = false)
        private List<MQLQuery> get() {
            return and != null ? and : or != null ? or : not;
        }

        @JSONField(serialize = false)
        public boolean isEmpty() {
            List<MQLQuery> list = get();
            return list == null || get().isEmpty();
        }

        public LogicQuery add(MQLQuery q) {
            get().add(q);
            return this;
        }

        public LogicQuery and(Consumer<LogicQuery> b) {
            LogicQuery and = and();
            b.accept(and);
            return add(and);
        }

        public LogicQuery or(Consumer<LogicQuery> b) {
            LogicQuery or = or();
            b.accept(or);
            return add(or);
        }

        public LogicQuery not(Consumer<LogicQuery> b) {
            LogicQuery not = not();
            b.accept(not);
            return add(not);
        }

        public LogicQuery eq(String field, Object value) {
            return add(new PropertyQuery(field, "=", value));
        }

        public LogicQuery neq(String field, Object value) {
            return add(new PropertyQuery(field, "!=", value));
        }

        public LogicQuery gt(String field, Object value) {
            return add(new PropertyQuery(field, ">", value));
        }

        public LogicQuery ge(String field, Object value) {
            return add(new PropertyQuery(field, ">=", value));
        }

        public LogicQuery lt(String field, Object value) {
            return add(new PropertyQuery(field, "<", value));
        }

        public LogicQuery le(String field, Object value) {
            return add(new PropertyQuery(field, "<=", value));
        }

        public LogicQuery between(String field, Object lower, Object upper) {
            return add(new PropertyQuery(field, "between", List.of(lower, upper)));
        }

        public LogicQuery like(String field, String pattern) {
            return add(new PropertyQuery(field, "like", pattern));
        }

        public LogicQuery in(String field, Collection<?> values) {
            if (values == null || values.isEmpty()) {
                throw new IllegalArgumentException("IN values must not be null or empty");
            }
            return add(new PropertyQuery(field, "in", new ArrayList<>(values)));
        }

        public LogicQuery isNull(String field) {
            return add(new PropertyQuery(field, "is", null));
        }

        public LogicQuery isNotNull(String field) {
            return add(new PropertyQuery(field, "is not", null));
        }

        public JSONObject toJSONObject() {
            JSONObject result = new JSONObject();
            result.put("operator", "logic");
            String branch = and != null ? "and" : or != null ? "or" : "not";
            JSONArray children = new JSONArray();
            List<MQLQuery> values = get();
            if (values != null) {
                for (MQLQuery value : values) {
                    if (value instanceof LogicQuery logic) {
                        children.add(logic.toJSONObject());
                    } else if (value instanceof PropertyQuery property) {
                        JSONObject child = new JSONObject();
                        child.put("field", property.getField());
                        child.put("operator", property.getOperator());
                        child.put("value", property.getValue());
                        children.add(child);
                    } else {
                        throw new IllegalArgumentException("Unsupported query type: " + value.getClass().getName());
                    }
                }
            }
            result.put(branch, children);
            return result;
        }
        public static LogicQuery parse(String mql) {
            MQLQuery query = parseQuery(JSON.parseObject(mql));
            if (!(query instanceof LogicQuery logic)) {
                throw new IllegalArgumentException("Top-level query must be a logic query");
            }
            return logic;
        }

        public static LogicQuery and(MQLQuery... and) {
            return new LogicQuery(Arrays.stream(and).collect(Collectors.toList()), null, null);
        }

        public static LogicQuery or(MQLQuery... or) {
            return new LogicQuery(null, Arrays.stream(or).collect(Collectors.toList()), null);
        }

        public static LogicQuery not(MQLQuery... not) {
            return new LogicQuery(null, null, Arrays.stream(not).collect(Collectors.toList()));
        }
    }

}
