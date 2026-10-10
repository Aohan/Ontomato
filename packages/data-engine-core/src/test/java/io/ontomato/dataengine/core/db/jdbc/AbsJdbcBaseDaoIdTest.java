package io.ontomato.dataengine.core.db.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;

class AbsJdbcBaseDaoIdTest {

    /** A form that starts with id "" must create a row under a generated id, never under "". */
    @Test
    void saveOrUpdateWithBlankIdInsertsUnderGeneratedId() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProbeDao dao = new ProbeDao(jdbc);
        Probe probe = new Probe();
        probe.setId("");

        String id = dao.saveOrUpdate(probe);

        assertFalse(id.isBlank());
        assertEquals(id, probe.getId());
        verify(jdbc).update(eq(dao.tableDesc.insertSql), any(Object[].class));
    }

    static class ProbeDao extends AbsJdbcBaseDao<Probe, ProbeCondition> {
        ProbeDao(JdbcTemplate jdbcTemplate) {
            super(jdbcTemplate);
        }
    }

    public static class Probe implements Entity {
        private String id;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }
    }

    public static class ProbeCondition implements Condition {
    }
}
