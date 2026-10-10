package io.ontomato.dataengine.service.vector;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

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

import lombok.extern.slf4j.Slf4j;

/**
 * The in-service vector rebuild of one domain. Saving the embedding configuration takes effect at
 * once; this task regenerates every vector of the domain with the configuration taken when it
 * started. Only the recorded vector source is updated on full success, so a failure or a restart
 * keeps the rebuild marked as needed and the next run starts over.
 */
@Slf4j
@Service
public class VectorRebuildService {

    @Autowired
    private BusinessConfigService businessConfigService;

    @Autowired
    private EmbeddingService embeddingService;

    @Autowired
    private LangService langService;

    @Autowired
    private VectorRebuildTracker rebuildTracker;

    @Autowired
    private KnowledgeDao knowledgeDao;

    @Autowired
    private BussinessExampleDao bussinessExampleDao;

    @Autowired
    private BusinessExampleQuestionSpliterDao questionSpliterDao;

    @Autowired
    private ActionDao actionDao;

    @Autowired
    private MetricViewDao metricViewDao;

    @Autowired
    private VectorResourceDao vectorResourceDao;

    public VectorRebuildStatus status(String domainId) {
        BusinessConfig businessConfig = businessConfigService.get(domainId);
        VectorRebuildTracker.Progress progress = rebuildTracker.progressOf(domainId);
        VectorRebuildStatus status = new VectorRebuildStatus();
        status.setNeeded(VectorRetrievalGate.isRebuildNeeded(businessConfig));
        status.setRunning(progress.isRunning());
        status.setTotal(progress.getTotal());
        status.setDone(progress.getDone());
        status.setError(progress.getError());
        return status;
    }

    public boolean isRunning(String domainId) {
        return rebuildTracker.isRunning(domainId);
    }

    /** Start the background rebuild of this domain and return at once. */
    public void start(String domainId, String lang) {
        BusinessConfig businessConfig = businessConfigService.get(domainId);
        if (!VectorRetrievalGate.isRebuildNeeded(businessConfig)) {
            throw new IllegalStateException(langService.get(lang, "Vector.rebuildNotNeeded"));
        }
        if (!rebuildTracker.tryStart(domainId)) {
            throw new IllegalStateException(langService.get(lang, "Vector.rebuildAlreadyRunning"));
        }
        BusinessConfig.EmbeddingModelProperties snapshot = businessConfig.getEmbeddingModelProperties();
        Thread thread = new Thread(() -> run(domainId, snapshot), "vector-rebuild-" + domainId);
        thread.setDaemon(true);
        thread.start();
    }

    /**
     * Run the rebuild synchronously: count, clear this domain's vectors, then re-vectorize every row
     * with the start-time configuration. A failure records the error and stops; only full success
     * updates the recorded vector source.
     */
    void run(String domainId, BusinessConfig.EmbeddingModelProperties snapshot) {
        try {
            List<String> resourceTables = vectorResourceDao.listDomainTables(domainId);
            rebuildTracker.addTotal(domainId, knowledgeDao.countDomainRows(domainId));
            rebuildTracker.addTotal(domainId, bussinessExampleDao.countDomainRows(domainId));
            rebuildTracker.addTotal(domainId, questionSpliterDao.countDomainRows(domainId));
            rebuildTracker.addTotal(domainId, actionDao.countDomainRows(domainId));
            rebuildTracker.addTotal(domainId, metricViewDao.countDomainRows(domainId));
            for (String table : resourceTables) {
                rebuildTracker.addTotal(domainId, vectorResourceDao.countTableRows(table));
            }

            // Invalidate the recorded source before clearing: a failure or a restart must keep
            // the rebuild marked as needed no matter how the configuration changes afterwards.
            // A fresh read, so a configuration saved for another reason is not overwritten.
            BusinessConfig invalidated = businessConfigService.get(domainId);
            invalidated.setEmbeddingVectorSource(new BusinessConfig.EmbeddingVectorSource());
            businessConfigService.set(invalidated, domainId);

            knowledgeDao.clearDomainVectors(domainId);
            bussinessExampleDao.clearDomainVectors(domainId);
            questionSpliterDao.clearDomainVectors(domainId);
            actionDao.clearDomainVectors(domainId);
            metricViewDao.clearDomainVectors(domainId);
            vectorResourceDao.clearDomainVectors(domainId);

            for (VectorRebuildItem item : knowledgeDao.listDomainVectors(domainId)) {
                knowledgeDao.updateDomainVector(item.getId(), embed(snapshot, item.getText()));
                rebuildTracker.addDone(domainId, 1);
            }
            for (VectorRebuildItem item : bussinessExampleDao.listDomainVectors(domainId)) {
                bussinessExampleDao.updateDomainVector(item.getId(), embed(snapshot, item.getText()));
                rebuildTracker.addDone(domainId, 1);
            }
            for (VectorRebuildItem item : questionSpliterDao.listDomainVectors(domainId)) {
                questionSpliterDao.updateDomainVector(item.getId(), embed(snapshot, item.getText()));
                rebuildTracker.addDone(domainId, 1);
            }
            for (VectorRebuildItem item : actionDao.listDomainVectors(domainId)) {
                actionDao.updateDomainVector(item.getId(), item.getText(), embed(snapshot, item.getText()));
                rebuildTracker.addDone(domainId, 1);
            }
            for (VectorRebuildItem item : metricViewDao.listDomainVectors(domainId)) {
                metricViewDao.updateDomainVector(item.getId(), item.getText(), embed(snapshot, item.getText()));
                rebuildTracker.addDone(domainId, 1);
            }
            for (String table : resourceTables) {
                for (VectorRebuildItem item : vectorResourceDao.listTableVectors(table)) {
                    vectorResourceDao.updateTableVector(table, item.getId(), embed(snapshot, item.getText()));
                    rebuildTracker.addDone(domainId, 1);
                }
            }

            BusinessConfig.EmbeddingVectorSource source = new BusinessConfig.EmbeddingVectorSource();
            source.setBaseUrl(snapshot.getBaseUrl());
            source.setModelName(snapshot.getModelName());
            source.setDimensions(snapshot.getDimensions());
            // A fresh read before publishing the source, so a configuration saved for another
            // reason while the rebuild ran is not overwritten with the copy taken at the start.
            BusinessConfig current = businessConfigService.get(domainId);
            current.setEmbeddingVectorSource(source);
            businessConfigService.set(current, domainId);
            rebuildTracker.finish(domainId, null);
        } catch (Exception e) {
            log.error("Vector rebuild of domain {} failed: {}", domainId, e.getMessage(), e);
            rebuildTracker.finish(domainId, e.getMessage());
        }
    }

    private float[] embed(BusinessConfig.EmbeddingModelProperties snapshot, String text) {
        return embeddingService.embedWith(snapshot, text).content().vector();
    }

}
