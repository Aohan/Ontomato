package io.ontomato.dataengine.dao.sys.impl;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.core.db.jdbc.AbsJdbcBaseDao;
import io.ontomato.dataengine.dao.sys.CSysDomain;
import io.ontomato.dataengine.dao.sys.SysDomain;
import io.ontomato.dataengine.dao.sys.SysDomainDao;

@Service
public class SysDomainDaoJdbcImpl extends AbsJdbcBaseDao<SysDomain, CSysDomain> implements SysDomainDao {

    public SysDomainDaoJdbcImpl(JdbcTemplate jdbcTemplate) {
        super(jdbcTemplate);
    }

}
