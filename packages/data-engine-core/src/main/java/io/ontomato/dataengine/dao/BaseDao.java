package io.ontomato.dataengine.dao;

/**
 * Base Dao for vector retrieval: converts distance to similarity score.
 */
public class BaseDao {

    /**
     * Convert distance to similarity score (aligned with bleve's score semantics: the smaller the distance, the higher the score).
     */
    protected double distanceToScore(double distance) {
        return 1.0 / (1.0 + distance);
    }

}
