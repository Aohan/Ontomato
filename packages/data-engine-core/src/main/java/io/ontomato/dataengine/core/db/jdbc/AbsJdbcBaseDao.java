package io.ontomato.dataengine.core.db.jdbc;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.jdbc.core.BeanPropertyRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.core.db.Dao;
import io.ontomato.dataengine.core.db.PrimaryKeyUtil;
import io.ontomato.dataengine.core.exception.DaoException;
import io.ontomato.dataengine.core.utils.CommUtils;

import lombok.Getter;

public abstract class AbsJdbcBaseDao<E extends Entity, C extends Condition> implements Dao<E, C> {

    private static Map<Class<?>, TableDesc> cache = new ConcurrentHashMap<>();

    public static synchronized TableDesc get(Class<? extends Entity> clazz) {
        return cache.computeIfAbsent(clazz, k -> new TableDesc(clazz));
    }

    public static List<TableDesc> getAllTableDesc() {
        return new ArrayList<>(cache.values());
    }

    Class<E> entityClass;

    protected TableDesc tableDesc;

    protected Condition2Sql condition2Sql;

    @Getter
    JdbcTemplate jdbcTemplate;

    private RowMapper<E> rowMapper;

    @SuppressWarnings("unchecked")
    public AbsJdbcBaseDao(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        Type type = this.getClass().getGenericSuperclass();
        Type[] types = ((ParameterizedType) type).getActualTypeArguments();
        entityClass = (Class<E>) types[0];
        Class<C> conditionClass = (Class<C>) types[1];
        tableDesc = get(entityClass);
        condition2Sql = new Condition2Sql(tableDesc, conditionClass);
        this.rowMapper = new BeanPropertyRowMapper<>(entityClass);
    }

    @Override
    public E getById(String id) {
        if (id == null) {
            return null;
        }
        List<E> data = jdbcTemplate.query(tableDesc.selectSql + " WHERE id = ?", rowMapper, id);
        return data.isEmpty() ? null : data.getFirst();
    }

    @Override
    public List<E> getByIds(Collection<String> ids) {
        if (CommUtils.isEmpty(ids)) {
            return new ArrayList<>();
        }
        List<String> placeholders = new ArrayList<>();
        for (String id : ids) {
            placeholders.add("?");
        }
        return jdbcTemplate.query(tableDesc.selectSql + " WHERE id IN (" + String.join(",", placeholders) + ")",
                rowMapper, ids.toArray());
    }

    @Override
    public String insert(E e) {
        if (e.getId() == null) {
            e.setId(PrimaryKeyUtil.nextObjectId());
        }
        Date date = new Date();
        tableDesc.setCreateTime(e, date);
        tableDesc.setModifyTime(e, date);
        jdbcTemplate.update(tableDesc.insertSql, extract(e).toArray());
        return e.getId();
    }

    @Override
    public int insertBatch(Collection<E> list) {
        Date date = new Date();
        List<Object[]> batchArgs = new ArrayList<>();
        for (E e : list) {
            if (e == null) {
                continue;
            }
            if (e.getId() == null) {
                e.setId(PrimaryKeyUtil.nextObjectId());
            }
            tableDesc.setCreateTime(e, date);
            tableDesc.setModifyTime(e, date);
            batchArgs.add(extract(e).toArray());
        }
        jdbcTemplate.batchUpdate(tableDesc.insertSql, batchArgs);
        return batchArgs.size();
    }

    @Override
    public String saveOrUpdate(E e) {
        if (CommUtils.isEmpty(e.getId())) {
            return insert(e);
        } else {
            return update(e.getId(), e);
        }
    }

    @Override
    public String upsert(E e) {
        if (e.getId() == null) {
            e.setId(PrimaryKeyUtil.nextObjectId());
        }
        Date date = new Date();
        tableDesc.setModifyTime(e, date);

        StringBuilder sql = new StringBuilder(tableDesc.insertSql);
        sql.append(" ON CONFLICT (id) DO UPDATE SET ");
        List<String> setClauses = new ArrayList<>();
        for (TableDesc.ColumnInfo c : tableDesc.columns) {
            if (!"id".equals(c.columnName())) {
                setClauses.add(c.columnName() + " = EXCLUDED." + c.columnName());
            }
        }
        sql.append(String.join(", ", setClauses));

        jdbcTemplate.update(sql.toString(), extract(e).toArray());
        return e.getId();
    }

    @Override
    public String update(String id, E e) {
        return updateSelective(id, e);
    }

    @Override
    public String updateSelective(String id, E data) {
        if (CommUtils.isEmpty(id)) {
            throw new DaoException("id cannot be empty!");
        }
        List<Object> params = new ArrayList<>();
        List<String> updateFields = new ArrayList<>();
        Date date = new Date();
        tableDesc.setModifyTime(data, date);
        tableDesc.columns.forEach(c -> {
            try {
                Object object = c.field().get(data);
                if (object != null) {
                    if (object instanceof Date dt) {
                        object = new Timestamp(dt.getTime());
                    }
                    params.add(object);
                    updateFields.add(c.columnName() + " = ?");
                }
            } catch (Exception e) {
                throw new DaoException("Data conversion error!");
            }
        });
        if (params.isEmpty()) {
            return id;
        }
        String sql = "UPDATE " + tableDesc.tableName + " SET " + String.join(", ", updateFields) + " WHERE id = ?";
        params.add(id);
        jdbcTemplate.update(sql, params.toArray());
        return id;
    }

    @Override
    public int updateBatch(Collection<E> list) {
        Date date = new Date();
        List<Object[]> batchArgs = new ArrayList<>();
        for (E e : list) {
            if (e == null) {
                continue;
            }
            if (e.getId() == null) {
                e.setId(PrimaryKeyUtil.nextObjectId());
            }
            tableDesc.setModifyTime(e, date);
            List<Object> values = extract(e);
            batchArgs.add(values.toArray());
        }
        StringBuilder upsertSql = new StringBuilder(tableDesc.insertSql);
        upsertSql.append(" ON CONFLICT (id) DO UPDATE SET ");
        List<String> setClauses = new ArrayList<>();
        for (TableDesc.ColumnInfo c : tableDesc.columns) {
            if (!"id".equals(c.columnName())) {
                setClauses.add(c.columnName() + " = EXCLUDED." + c.columnName());
            }
        }
        upsertSql.append(String.join(", ", setClauses));
        jdbcTemplate.batchUpdate(upsertSql.toString(), batchArgs);
        return batchArgs.size();
    }

    @Override
    public List<E> queryList(C cdt, String orders) {
        return queryList(buildSelectSql(cdt, orders, null, null));
    }

    @Override
    public List<E> queryList(Integer pageNum, Integer pageSize, C cdt, String orders) {
        pageNum = pageNum == null || pageNum < 1 ? 1 : pageNum;
        pageSize = pageSize == null ? 100 : pageSize;
        return queryList(buildSelectSql(cdt, orders, pageNum, pageSize));
    }

    @Override
    public Page<E> queryPage(Integer pageNum, Integer pageSize, C cdt, String orders) {
        pageNum = pageNum == null || pageNum < 1 ? 1 : pageNum;
        pageSize = pageSize == null ? 100 : pageSize;
        Condition2Sql.Where where = condition2Sql.build(cdt);
        String countSql = "SELECT COUNT(*) FROM " + tableDesc.tableName;
        if (where != null && !where.isEmpty()) {
            countSql += " WHERE " + where.whereSql();
        }
        Long totalRows = jdbcTemplate.queryForObject(countSql, Long.class,
                where != null && where.params() != null ? where.params().toArray() : new Object[0]);
        if (totalRows == null) {
            totalRows = 0L;
        }
        List<E> data = queryList(buildSelectSql(cdt, orders, pageNum, pageSize));
        return new Page<E>(pageNum, pageSize, totalRows, data);
    }

    private List<E> queryList(QuerySql querySql) {
        return jdbcTemplate.query(querySql.sql, rowMapper, querySql.params.toArray());
    }

    private QuerySql buildSelectSql(C cdt, String orders, Integer pageNum, Integer pageSize) {
        Condition2Sql.Where where = condition2Sql.build(cdt);
        StringBuilder sql = new StringBuilder(tableDesc.selectSql);
        List<Object> params = new ArrayList<>();
        if (where != null && !where.isEmpty()) {
            sql.append(" WHERE ").append(where.whereSql());
            params.addAll(where.params());
        }
        if (orders != null) {
            sql.append(" ORDER BY ").append(orders);
        }
        if (pageNum != null && pageSize != null) {
            sql.append(" LIMIT ? OFFSET ?");
            params.add(pageSize);
            params.add((pageNum - 1) * pageSize);
        }
        return new QuerySql(sql.toString(), params);
    }

    private record QuerySql(String sql, List<Object> params) {
    }

    public List<Object> extract(Entity entity) {
        List<Object> r = new ArrayList<>();
        tableDesc.columns.forEach(c -> {
            try {
                Object val = c.field().get(entity);
                if (val instanceof Date dt) {
                    val = new Timestamp(dt.getTime());
                }
                r.add(val);
            } catch (Exception e) {
                throw new DaoException("Data conversion error!");
            }
        });
        return r;
    }

    @Override
    public void deleteById(String id) {
        if (CommUtils.isEmpty(id)) {
            return;
        }
        jdbcTemplate.update(tableDesc.deleteSql + " WHERE id = ?", id);
    }

    @Override
    public void deleteByIds(Collection<String> ids) {
        if (CommUtils.isEmpty(ids)) {
            return;
        }
        List<String> placeholders = new ArrayList<>();
        for (String id : ids) {
            placeholders.add("?");
        }
        jdbcTemplate.update(tableDesc.deleteSql + " WHERE id IN (" + String.join(",", placeholders) + ")",
                ids.toArray());
    }

    @Override
    public void deleteByCdt(C cdt) {
        if (cdt == null) {
            return;
        }
        Condition2Sql.Where where = condition2Sql.build(cdt);
        if (where != null && !where.isEmpty()) {
            jdbcTemplate.update(tableDesc.deleteSql + " WHERE " + where.whereSql(), where.params().toArray());
        }
    }

    @Override
    public void deleteAll() {
        jdbcTemplate.update(tableDesc.deleteSql);
    }

}
