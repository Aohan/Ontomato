package io.ontomato.dataengine.service.vector;

import java.util.Objects;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;

/**
 * Owns the "vectors need rebuilding" rule and the retrieval gate. A rebuild is needed when the
 * recorded vector source differs from the current embedding configuration in baseUrl, modelName or
 * dimensions; the key and the other execution fields never count.
 */
@Component
public class VectorRetrievalGate {

    @Autowired
    private BusinessConfigService businessConfigService;

    @Autowired
    private VectorRebuildTracker rebuildTracker;

    @Autowired
    private LangService langService;

    public static boolean isRebuildNeeded(BusinessConfig businessConfig) {
        BusinessConfig.EmbeddingVectorSource source = businessConfig.getEmbeddingVectorSource();
        if (source == null) {
            throw new IllegalStateException(
                    "The embeddingVectorSource of this domain is missing; run the upgrade migration first");
        }
        BusinessConfig.EmbeddingModelProperties current = businessConfig.getEmbeddingModelProperties();
        if (current == null) {
            throw new IllegalStateException(
                    "The embeddingModelProperties of this domain is missing; run the upgrade migration first");
        }
        return !Objects.equals(source.getBaseUrl(), current.getBaseUrl())
                || !Objects.equals(source.getModelName(), current.getModelName())
                || !Objects.equals(source.getDimensions(), current.getDimensions());
    }

    /**
     * Throw before a vector search of this domain when its vectors need rebuilding and no rebuild is
     * running. A running rebuild only returns rows whose vector is already regenerated.
     */
    public void requireRetrievable(String domainId) {
        BusinessConfig businessConfig = businessConfigService.get(domainId);
        if (isRebuildNeeded(businessConfig) && !rebuildTracker.isRunning(domainId)) {
            throw new IllegalStateException(langService.get(businessConfig.getLang(), "Vector.rebuildRequired"));
        }
    }

}
