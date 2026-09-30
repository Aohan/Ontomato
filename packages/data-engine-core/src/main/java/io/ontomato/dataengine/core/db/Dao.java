package io.ontomato.dataengine.core.db;

import java.util.Collection;
import java.util.List;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;
import io.ontomato.dataengine.core.bean.Page;

public interface Dao<E extends Entity, C extends Condition> {

    E getById(String id);

    List<E> getByIds(Collection<String> id);

    /**
     * Insert data; if no ID is passed, an ID is generated automatically
     * 
     * @param e
     *             entity
     * @return id
     */
    String insert(E e);

    int insertBatch(Collection<E> list);

    String saveOrUpdate(E e);

    /**
     * Update if it exists, insert if it does not (INSERT ... ON CONFLICT (id) DO UPDATE)
     *
     * @param e
     *             entity
     * @return id
     */
    String upsert(E e);

    int updateBatch(Collection<E> list);

    /**
     * Full-attribute update (in m3 this is insert)
     * 
     * @param id
     * @param e
     * @return
     */
    String update(String id, E e);

    /**
     * Update only fields that are not null
     * 
     * @param id
     * @param e
     * @return
     */
    String updateSelective(String id, E e);

    List<E> queryList(C cdt, String orders);

    List<E> queryList(Integer pageNum, Integer pageSize, C cdt, String orders);

    Page<E> queryPage(Integer pageNum, Integer pageSize, C cdt, String orders);

    default List<E> queryList(C cdt) {
        return queryList(cdt, null);
    }

    default List<E> queryList(Integer pageNum, Integer pageSize, C cdt) {
        return queryList(pageNum, pageSize, cdt, null);
    }

    default Page<E> queryPage(Integer pageNum, Integer pageSize, C cdt) {
        return queryPage(pageNum, pageSize, cdt, null);
    }

    void deleteById(String id);

    void deleteByIds(Collection<String> ids);

    void deleteByCdt(C cdt);

    void deleteAll();

}
