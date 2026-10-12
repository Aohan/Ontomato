package io.ontomato.dataengine.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/**
 * A new domain (confirmed item 1) defaults its embedding dimensions from the file configuration,
 * and its recorded vector source equals that initial configuration.
 */
class BusinessConfigFromTest {

    @Test
    void newDomainDefaultsDimensionsTo2048WithMatchingVectorSource() {
        ModelDefaultsProperties defaults = new ModelDefaultsProperties();
        EmbeddingModelProperties fileProps = new EmbeddingModelProperties();
        fileProps.setBaseUrl("http://emb/v1");
        fileProps.setApiKey("key");
        fileProps.setModelName("m1");
        fileProps.setDimensions(2048);

        BusinessConfig businessConfig = BusinessConfig.from(defaults, fileProps, new DataRagConfig());

        assertEquals(2048, businessConfig.getEmbeddingModelProperties().getDimensions());
        assertEquals("http://emb/v1", businessConfig.getEmbeddingVectorSource().getBaseUrl());
        assertEquals("m1", businessConfig.getEmbeddingVectorSource().getModelName());
        assertEquals(2048, businessConfig.getEmbeddingVectorSource().getDimensions());
    }

}
