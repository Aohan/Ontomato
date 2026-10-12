package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.test.util.ReflectionTestUtils;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;

/**
 * Every vector search (confirmed items 4-5) refuses when the domain needs a rebuild and none runs,
 * and skips rows whose vector is still empty while a rebuild runs.
 */
class VectorRetrievalGateDaoTest {

    private final EmbeddingService embeddingService = mock(EmbeddingService.class);
    private final VectorRetrievalGate retrievalGate = mock(VectorRetrievalGate.class);

    private final JdbcTemplate knowledgeJdbc = mock(JdbcTemplate.class);
    private final KnowledgeDao knowledgeDao = new KnowledgeDao();
    private final JdbcTemplate exampleJdbc = mock(JdbcTemplate.class);
    private final BussinessExampleDao exampleDao = new BussinessExampleDao();
    private final JdbcTemplate spliterJdbc = mock(JdbcTemplate.class);
    private final BusinessExampleQuestionSpliterDao spliterDao = new BusinessExampleQuestionSpliterDao();
    private final JdbcTemplate actionJdbc = mock(JdbcTemplate.class);
    private final ActionDao actionDao = new ActionDao();
    private final JdbcTemplate metricJdbc = mock(JdbcTemplate.class);
    private final MetricViewDao metricViewDao = new MetricViewDao();
    private final JdbcTemplate resourceJdbc = mock(JdbcTemplate.class);
    private final VectorResourceDao resourceDao = new VectorResourceDao();

    @BeforeEach
    void setUp() {
        inject(knowledgeDao, knowledgeJdbc);
        inject(exampleDao, exampleJdbc);
        inject(spliterDao, spliterJdbc);
        inject(actionDao, actionJdbc);
        inject(metricViewDao, metricJdbc);
        inject(resourceDao, resourceJdbc);
        when(embeddingService.embedding(anyString(), anyString()))
                .thenReturn(new Response<>(Embedding.from(new float[] { 0.5f })));
        for (JdbcTemplate jdbc : List.of(knowledgeJdbc, exampleJdbc, spliterJdbc, actionJdbc, metricJdbc, resourceJdbc)) {
            when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        }
    }

    private void inject(Object dao, JdbcTemplate jdbc) {
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        ReflectionTestUtils.setField(dao, "embeddingService", embeddingService);
        ReflectionTestUtils.setField(dao, "retrievalGate", retrievalGate);
    }

    @Test
    void allSixRetrievalsThrowWhenARebuildIsNeeded() {
        doThrow(new IllegalStateException("vectors need rebuilding")).when(retrievalGate).requireRetrievable("d1");

        assertThrows(IllegalStateException.class, () -> knowledgeDao.findKnowledge("q", 10, "d1"));
        assertThrows(IllegalStateException.class, () -> exampleDao.findBussinessExample("q", 10, "d1"));
        assertThrows(IllegalStateException.class, () -> spliterDao.findBussinessExample("q", 10, "d1"));
        assertThrows(IllegalStateException.class, () -> actionDao.find("q", null, 10, 0, "d1"));
        assertThrows(IllegalStateException.class, () -> metricViewDao.find("q", null, null, 10, 0, "d1"));
        assertThrows(IllegalStateException.class, () -> resourceDao.find("q", 10, "class1", "photos", "d1"));

        verifyNoInteractions(knowledgeJdbc, exampleJdbc, spliterJdbc, actionJdbc, metricJdbc, resourceJdbc);
    }

    @Test
    void allSixRetrievalsSkipRowsWithEmptyVectors() {
        knowledgeDao.findKnowledge("q", 10, "d1");
        exampleDao.findBussinessExample("q", 10, "d1");
        spliterDao.findBussinessExample("q", 10, "d1");
        actionDao.find("q", null, 10, 0, "d1");
        metricViewDao.find("q", null, null, 10, 0, "d1");
        resourceDao.find("q", 10, "class1", "photos", "d1");

        assertSqlContains(knowledgeJdbc, "knowledge_vector IS NOT NULL");
        assertSqlContains(exampleJdbc, "example_vector IS NOT NULL");
        assertSqlContains(spliterJdbc, "example_vector IS NOT NULL");
        assertSqlContains(actionJdbc, "brief_vector IS NOT NULL");
        assertSqlContains(metricJdbc, "brief_vector IS NOT NULL");
        assertSqlContains(resourceJdbc, "brief_vector IS NOT NULL");
    }

    @SuppressWarnings({ "unchecked", "rawtypes" })
    private static void assertSqlContains(JdbcTemplate jdbc, String fragment) {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), any(Object[].class));
        assertTrue(sql.getValue().contains(fragment), sql.getValue());
    }

}
