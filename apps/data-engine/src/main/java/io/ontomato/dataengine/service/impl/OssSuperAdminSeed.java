package io.ontomato.dataengine.service.impl;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.core.db.jdbc.SuperAdminSeed;

/** OSS has no enterprise user or role rows to seed after DDL. */
@Component
public class OssSuperAdminSeed implements SuperAdminSeed {

    @Override
    public void initSuperAdmin() {
    }
}
