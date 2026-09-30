package io.ontomato.dataengine.dao;

/**
 * One row of the {@code session_registry} table: which DataRAG node hosts a given business session, plus its start and end times.
 * The return shape of a read-only query, for {@code ObserveLogController} to serialize directly.
 */
public record SessionRegistryEntry(String sessionId, String nodeId, Long startTs, Long endTs, Long cancelledAt) {
}
