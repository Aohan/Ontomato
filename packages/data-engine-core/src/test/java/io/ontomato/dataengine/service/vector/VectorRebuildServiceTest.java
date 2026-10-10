package io.ontomato.dataengine.service.vector;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.VectorRebuildItem;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.EmbeddingService;

/**
 * The in-service rebuild (confirmed item 5): one run per domain, progress by row count, the recorded
 * source only published on full success.
 */
class VectorRebuildServiceTest {

    private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
    private final EmbeddingService embeddingService = mock(EmbeddingService.class);
    private final LangService langService = mock(LangService.class);
    private final KnowledgeDao knowledgeDao = mock(KnowledgeDao.class);
    private final BussinessExampleDao exampleDao = mock(BussinessExampleDao.class);
    private final BusinessExampleQuestionSpliterDao spliterDao = mock(BusinessExampleQuestionSpliterDao.class);
    private final ActionDao actionDao = mock(ActionDao.class);
    private final MetricViewDao metricViewDao = mock(MetricViewDao.class);
    private final VectorResourceDao resourceDao = mock(VectorResourceDao.class);

    private VectorRebuildTracker rebuildTracker;
    private VectorRebuildService service;

    @BeforeEach
    void setUp() {
        rebuildTracker = new VectorRebuildTracker();
        service = new VectorRebuildService();
        ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(service, "embeddingService", embeddingService);
        ReflectionTestUtils.setField(service, "langService", langService);
        ReflectionTestUtils.setField(service, "rebuildTracker", rebuildTracker);
        ReflectionTestUtils.setField(service, "knowledgeDao", knowledgeDao);
        ReflectionTestUtils.setField(service, "bussinessExampleDao", exampleDao);
        ReflectionTestUtils.setField(service, "questionSpliterDao", spliterDao);
        ReflectionTestUtils.setField(service, "actionDao", actionDao);
        ReflectionTestUtils.setField(service, "metricViewDao", metricViewDao);
        ReflectionTestUtils.setField(service, "vectorResourceDao", resourceDao);
        when(langService.get(any(), anyString())).thenAnswer(invocation -> invocation.getArgument(1));
        when(resourceDao.listDomainTables(anyString())).thenReturn(List.of());
        when(embeddingService.embedWith(any(), anyString()))
                .thenReturn(new Response<>(Embedding.from(new float[] { 0.1f, 0.2f })));
    }

    @Test
    void startRefusesWhenNoRebuildIsNeeded() {
        when(businessConfigService.get("d1")).thenReturn(config(2048, 2048));

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service.start("d1"));
        assertTrue(error.getMessage().contains("Vector.rebuildNotNeeded"), error.getMessage());
        assertFalse(service.isRunning("d1"));
    }

    @Test
    void startRefusesWhileOneAlreadyRuns() {
        when(businessConfigService.get("d1")).thenReturn(config(1024, 2048));
        rebuildTracker.tryStart("d1");

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service.start("d1"));
        assertTrue(error.getMessage().contains("Vector.rebuildAlreadyRunning"), error.getMessage());
    }

    @Test
    void runSuccessPublishesTheStartTimeConfiguration() {
        BusinessConfig businessConfig = config(1024, 2048);
        when(businessConfigService.get("d1")).thenReturn(businessConfig);
        when(knowledgeDao.countDomainRows("d1")).thenReturn(1);
        when(knowledgeDao.listDomainVectors("d1"))
                .thenReturn(List.of(new VectorRebuildItem("k1", "hello")));

        service.run("d1", businessConfig.getEmbeddingModelProperties());

        ArgumentCaptor<float[]> vector = ArgumentCaptor.forClass(float[].class);
        verify(knowledgeDao).updateDomainVector(eq("k1"), vector.capture());
        assertArrayEquals(new float[] { 0.1f, 0.2f }, vector.getValue());
        verify(knowledgeDao).clearDomainVectors("d1");
        verify(resourceDao).clearDomainVectors("d1");

        ArgumentCaptor<BusinessConfig> saved = ArgumentCaptor.forClass(BusinessConfig.class);
        verify(businessConfigService).set(saved.capture(), eq("d1"));
        assertEquals("http://emb/v1", saved.getValue().getEmbeddingVectorSource().getBaseUrl());
        assertEquals("m1", saved.getValue().getEmbeddingVectorSource().getModelName());
        assertEquals(2048, saved.getValue().getEmbeddingVectorSource().getDimensions());

        VectorRebuildTracker.Progress progress = rebuildTracker.progressOf("d1");
        assertFalse(progress.isRunning());
        assertNull(progress.getError());
        assertEquals(1, progress.getTotal());
        assertEquals(1, progress.getDone());
    }

    @Test
    void runFailureRecordsTheErrorAndKeepsTheOldSource() {
        BusinessConfig businessConfig = config(1024, 2048);
        when(businessConfigService.get("d1")).thenReturn(businessConfig);
        when(knowledgeDao.countDomainRows("d1")).thenReturn(2);
        when(knowledgeDao.listDomainVectors("d1")).thenReturn(List.of(
                new VectorRebuildItem("k1", "hello"),
                new VectorRebuildItem("k2", "world")));
        when(embeddingService.embedWith(any(), anyString()))
                .thenReturn(new Response<>(Embedding.from(new float[] { 0.1f })))
                .thenThrow(new RuntimeException("embedding model down"));

        service.run("d1", businessConfig.getEmbeddingModelProperties());

        verify(businessConfigService, never()).set(any(), anyString());
        VectorRebuildTracker.Progress progress = rebuildTracker.progressOf("d1");
        assertFalse(progress.isRunning());
        assertTrue(progress.getError().contains("embedding model down"), progress.getError());
        assertEquals(2, progress.getTotal());
        assertEquals(1, progress.getDone());
    }

    private static BusinessConfig config(int sourceDimensions, int currentDimensions) {
        BusinessConfig businessConfig = new BusinessConfig();
        BusinessConfig.EmbeddingModelProperties props = businessConfig.new EmbeddingModelProperties();
        props.setBaseUrl("http://emb/v1");
        props.setApiKey("key");
        props.setModelName("m1");
        props.setDimensions(currentDimensions);
        businessConfig.setEmbeddingModelProperties(props);
        BusinessConfig.EmbeddingVectorSource source = new BusinessConfig.EmbeddingVectorSource();
        source.setBaseUrl("http://emb/v1");
        source.setModelName("m1");
        source.setDimensions(sourceDimensions);
        businessConfig.setEmbeddingVectorSource(source);
        return businessConfig;
    }

}
