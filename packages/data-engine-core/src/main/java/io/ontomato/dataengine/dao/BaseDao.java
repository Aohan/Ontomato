package io.ontomato.dataengine.dao;

import org.springframework.beans.factory.annotation.Autowired;

import io.ontomato.dataengine.config.EmbeddingModelProperties;

/**
 * Base Dao for vector retrieval: holds the configured embedding dimensions (the single source of dimensions for creating vector(n) tables),
 * and provides conversion from distance to similarity score.
 */
public class BaseDao {

    @Autowired
    protected EmbeddingModelProperties embeddingModelProperties;

    /**
     * Convert distance to similarity score (aligned with bleve's score semantics: the smaller the distance, the higher the score).
     */
    protected double distanceToScore(double distance) {
        return 1.0 / (1.0 + distance);
    }

}
