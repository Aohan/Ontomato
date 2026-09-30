package io.ontomato.dataengine.core.db.jdbc;

/** Called by jdbcInitDb after DDL and before classpath initdatas. */
public interface SuperAdminSeed {
    void initSuperAdmin();
}
