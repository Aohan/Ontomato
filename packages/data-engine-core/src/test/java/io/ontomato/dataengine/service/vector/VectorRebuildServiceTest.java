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

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service.start("d1", "zh-CN"));
        assertTrue(error.getMessage().contains("Vector.rebuildNotNeeded"), error.getMessage());
        verify(langService).get(eq("zh-CN"), eq("Vector.rebuildNotNeeded"));
        assertFalse(service.isRunning("d1"));
    }

    @Test
    void startRefusesWhileOneAlreadyRuns() {
        when(businessConfigService.get("d1")).thenReturn(config(1024, 2048));
        rebuildTracker.tryStart("d1");

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service.start("d1", "zh-CN"));
        assertTrue(error.getMessage().contains("Vector.rebuildAlreadyRunning"), error.getMessage());
        verify(langService).get(eq("zh-CN"), eq("Vector.rebuildAlreadyRunning"));
    }

    @Test
    void runSuccessPublishesTheStartTimeConfiguration() {
        // A fresh instance per read, like the deserialized database record.
        BusinessConfig firstRead = config(1024, 2048);
        when(businessConfigService.get("d1")).thenReturn(firstRead, config(1024, 2048));
        when(knowledgeDao.countDomainRows("d1")).thenReturn(1);
        when(knowledgeDao.listDomainVectors("d1"))
                .thenReturn(List.of(new VectorRebuildItem("k1", "hello")));

        service.run("d1", firstRead.getEmbeddingModelProperties());

        ArgumentCaptor<float[]> vector = ArgumentCaptor.forClass(float[].class);
        verify(knowledgeDao).updateDomainVector(eq("k1"), vector.capture());
        assertArrayEquals(new float[] { 0.1f, 0.2f }, vector.getValue());
        verify(knowledgeDao).clearDomainVectors("d1");
        verify(resourceDao).clearDomainVectors("d1");

        ArgumentCaptor<BusinessConfig> saved = ArgumentCaptor.forClass(BusinessConfig.class);
        verify(businessConfigService, org.mockito.Mockito.times(2)).set(saved.capture(), eq("d1"));
        assertEquals(2, saved.getAllValues().size());
        BusinessConfig.EmbeddingVectorSource invalidated = saved.getAllValues().get(0).getEmbeddingVectorSource();
        assertNull(invalidated.getBaseUrl());
        assertNull(invalidated.getModelName());
        assertNull(invalidated.getDimensions());
        BusinessConfig.EmbeddingVectorSource published = saved.getAllValues().get(1).getEmbeddingVectorSource();
        assertEquals("http://emb/v1", published.getBaseUrl());
        assertEquals("m1", published.getModelName());
        assertEquals(2048, published.getDimensions());

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

        // Only the invalidation write happens: the start-time configuration is never published.
        ArgumentCaptor<BusinessConfig> saved = ArgumentCaptor.forClass(BusinessConfig.class);
        verify(businessConfigService, org.mockito.Mockito.times(1)).set(saved.capture(), eq("d1"));
        BusinessConfig.EmbeddingVectorSource invalidated = saved.getValue().getEmbeddingVectorSource();
        assertNull(invalidated.getBaseUrl());
        assertNull(invalidated.getModelName());
        assertNull(invalidated.getDimensions());
        // With the configuration reverted to the original values, the invalidated source still needs a rebuild.
        BusinessConfig reverted = config(1024, 2048);
        reverted.setEmbeddingVectorSource(invalidated);
        assertTrue(VectorRetrievalGate.isRebuildNeeded(reverted));
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
