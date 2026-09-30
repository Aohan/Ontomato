package io.ontomato.dataengine.core.db.jdbc;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.db.jdbc.TableDesc.ColumnInfo;
import io.ontomato.dataengine.core.exception.DaoException;
import io.ontomato.dataengine.core.utils.CommUtils;

public class Condition2Sql {

    public static record Where(String whereSql, List<Object> params) {

        public boolean isEmpty() {
            return whereSql == null || whereSql.isBlank();
        }

    }

    private record CdtField(Field field, String columnName, boolean isCollection, boolean isLike) {
    }

    public static Where empty = new Where("", null);
    TableDesc tableDesc;
    private List<CdtField> cdts;

    public Condition2Sql(TableDesc tableDesc, Class<? extends Condition> cdtClass) {
        super();
        this.tableDesc = tableDesc;
        Map<String, ColumnInfo> nameMap = new HashMap<>();
        this.tableDesc.columns.forEach(fi -> {
            getCdtName(fi.field()).forEach(ff -> {
                nameMap.put(ff, fi);
            });
        });
        this.cdts = Stream.of(cdtClass.getDeclaredFields())
                .filter(field -> !Modifier.isStatic(field.getModifiers()) && !Modifier.isFinal(field.getModifiers()))
                .map(conditionField -> {
                    conditionField.setAccessible(true);
                    ColumnInfo entityField = nameMap.get(conditionField.getName());
                    Class<?> type = conditionField.getType();
                    boolean isCollection = type == java.util.Collection.class;
                    boolean isLike = false;
                    if (!isCollection && type == String.class
                            && Objects.equals(conditionField.getName(), entityField.field().getName())) {
                        isLike = true;
                    }
                    return new CdtField(conditionField, entityField.columnName(), isCollection, isLike);
                })
                .collect(Collectors.toList());
    }

    public Where build(Condition cdt) {
        if (cdt == null) {
            return empty;
        }
        List<Object> params = new ArrayList<>();
        List<String> sqls = new ArrayList<>();
        for (CdtField c : cdts) {
            try {
                Object val = c.field.get(cdt);
                if (val == null) {
                    continue;
                }
                if (c.isCollection) {
                    Collection<?> col = (Collection<?>) val;
                    if (col.isEmpty()) {
                        continue;
                    }
                    List<String> placeholders = new ArrayList<>();
                    for (Object item : col) {
                        placeholders.add("?");
                        params.add(item);
                    }
                    sqls.add(c.columnName + " IN (" + String.join(", ", placeholders) + ")");
                } else if (c.isLike) {
                    if (val instanceof String s) {
                        if (!CommUtils.isEmpty(s)) {
                            s = s.startsWith("%") ? s : "%" + s;
                            s = s.endsWith("%") ? s : s + "%";
                        }
                        val = s;
                    }
                    params.add(val);
                    sqls.add(c.columnName + " LIKE ?");
                } else {
                    String op = getOp(c.field);
                    params.add(val);
                    sqls.add(c.columnName + " " + op + " ?");
                }
            } catch (Exception e) {
                throw new DaoException("cdt err!", e);
            }
        }
        return new Where(String.join(" AND ", sqls), params);
    }

    private String getOp(Field field) {
        String name = field.getName();
        Class<?> type = field.getType();
        if (type == String.class || Objects.equals(name, field.getName())) {
            return "=";
        } else if (name.startsWith("start")) {
            return ">=";
        } else {
            return "<=";
        }
    }

    public List<String> getCdtName(Field field) {
        List<String> r = new ArrayList<>();
        String type = field.getType().getSimpleName();
        String name = field.getName();
        r.add(name);
        r.add(name + "s");
        if ("String".equals(type)) {
            r.add(name + "Equal");
        } else if ("Integer".equals(type) || "Long".equals(type) || "Short".equals(type) || "Date".equals(type)) {
            String fName = upFirstChar(field.getName());
            r.add(name + "s");
            r.add("start" + fName);
            r.add("end" + fName);
        } else if ("Boolean".equalsIgnoreCase(type)) {
        }
        return r;
    }

    public static String upFirstChar(String name) {
        char[] charArray = name.toCharArray();
        charArray[0] = Character.toUpperCase(charArray[0]);
        return new String(charArray);
    }

}
