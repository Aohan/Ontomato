package io.ontomato.dataengine.core.db.jdbc;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@RequiredArgsConstructor
public class InitDb implements InitializingBean, ApplicationContextAware {

    final JdbcProps props;

    final JdbcTemplate jdbcTemplate;

    final SuperAdminSeed superAdminSeed;

    @SuppressWarnings("rawtypes")
    Map<String, AbsJdbcBaseDao> daos;

    @Override
    public void afterPropertiesSet() throws Exception {
        log.info("Initializing database table structure!");

        daos.values().forEach(dao -> {
            jdbcTemplate.execute(dao.tableDesc.ddl());
        });

        superAdminSeed.initSuperAdmin();
        initData();
    }


    @Override
    public void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        daos = applicationContext.getBeansOfType(AbsJdbcBaseDao.class);
    }

    @SuppressWarnings("unchecked")
    private void initData() {
        for (AbsJdbcBaseDao<Entity, Condition> dao : daos.values()) {
            String resPath = "initdatas/" + dao.entityClass.getSimpleName() + ".json";
            ClassPathResource res = new ClassPathResource(resPath);
            if (res.exists()) {
                try {
                    Long count = jdbcTemplate.queryForObject(
                            "SELECT COUNT(*) FROM " + dao.tableDesc.tableName, Long.class);
                    if (count != null && count > 0) {
                        continue;
                    }
                    List<Entity> datas = (List<Entity>) JSON.parseArray(res.getContentAsString(StandardCharsets.UTF_8),
                            dao.entityClass);
                    if (!datas.isEmpty()) {
                        dao.insertBatch(datas);
                    }
                } catch (Exception e) {
                    log.warn(e.getMessage(), e);
                }
            }
        }
    }

}
