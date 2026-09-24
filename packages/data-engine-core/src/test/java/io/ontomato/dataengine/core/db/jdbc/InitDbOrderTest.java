package io.ontomato.dataengine.core.db.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

class InitDbOrderTest {

    @Test
    void jdbcInitDbInitializationRunsDdlThenSeedThenInitData() throws Exception {
        List<String> events = new ArrayList<>();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(invocation -> {
            events.add("ddl");
            return null;
        }).when(jdbc).execute(anyString());
        doAnswer(invocation -> {
            events.add("initdata");
            return 1L;
        }).when(jdbc).queryForObject(anyString(), eq(Long.class));

        @SuppressWarnings("rawtypes")
        AbsJdbcBaseDao dao = mock(AbsJdbcBaseDao.class);
        TableDesc tableDesc = mock(TableDesc.class);
        when(tableDesc.ddl()).thenReturn("ddl-marker");
        dao.tableDesc = tableDesc;
        dao.entityClass = InitOrderMarker.class;

        ApplicationContext context = mock(ApplicationContext.class);
        @SuppressWarnings("rawtypes")
        Map<String, AbsJdbcBaseDao> daos = new HashMap<>();
        daos.put("probe", dao);
        when(context.getBeansOfType(AbsJdbcBaseDao.class)).thenReturn(daos);

        InitDb initDb = new InitDb(new JdbcProps(), jdbc, () -> events.add("seed"));
        initDb.setApplicationContext(context);
        initDb.afterPropertiesSet();

        assertEquals(List.of("ddl", "seed", "initdata"), events);
    }

    public static class InitOrderMarker implements io.ontomato.dataengine.core.bean.Entity {
        public String getId() { return null; }
        public void setId(String id) {}
    }
}
