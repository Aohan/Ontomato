package io.ontomato.dataengine.dao;

import java.util.List;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Slf4j
@Component("sessionRegistryDao")
public class SessionRegistryDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "session_registry";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "session_id VARCHAR(255), "
				+ "node_id VARCHAR(255), "
				+ "start_ts BIGINT, "
				+ "end_ts BIGINT, "
				+ "cancelled_at BIGINT, "
				+ "PRIMARY KEY (session_id, node_id)"
				+ ")");
		log.info(">>>session_registry table initialization complete");
	}

	/**
	 * Only writes this node's own row: the start time takes this node's first registration (on conflict the existing start_ts is kept), and the end time is updated.
	 * When a data retrieval request lands on another node, that node's own row is added without overwriting the row of the node it was split from.
	 */
	public void save(String sessionId, String nodeId, long startTs, Long endTs) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (session_id, node_id, start_ts, end_ts) VALUES (?, ?, ?, ?) "
						+ "ON CONFLICT (session_id, node_id) DO UPDATE SET "
						+ "start_ts = LEAST(" + TABLE_NAME + ".start_ts, EXCLUDED.start_ts), end_ts = EXCLUDED.end_ts",
				sessionId, nodeId, startTs, endTs);
	}

	/**
	 * All routing rows of the session (one row per node per session); an empty list when there are no records.
	 */
	public List<SessionRegistryEntry> findAllBySessionId(String sessionId) {
		return jdbcTemplate.query(
					"SELECT session_id, node_id, start_ts, end_ts, cancelled_at FROM " + TABLE_NAME + " WHERE session_id = ?",
					(rs, rowNum) -> new SessionRegistryEntry(
							rs.getString("session_id"),
							rs.getString("node_id"),
							rs.getObject("start_ts", Long.class),
							rs.getObject("end_ts", Long.class),
							rs.getObject("cancelled_at", Long.class)),
					sessionId);
	}

	/**
	 * Writes the cancellation to this node's own row (confirmed design 9 of the work item "Positioning and Cancellation of Question-Answering Backend Sessions").
	 * Called only by the unified session-opening entry point when sending the heartbeat fails. The first cancellation time is kept; it is written even when the row does not exist.
	 */
	public void markCancelled(String sessionId, String nodeId, long cancelledAt) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (session_id, node_id, cancelled_at) VALUES (?, ?, ?) "
						+ "ON CONFLICT (session_id, node_id) DO UPDATE SET cancelled_at = COALESCE("
						+ TABLE_NAME + ".cancelled_at, EXCLUDED.cancelled_at)",
				sessionId, nodeId, cancelledAt);
	}

	/**
	 * The session is cancelled if any of its rows has a cancellation time. A single EXISTS query, so multiple rows do not throw an error.
	 */
	public boolean hasCancelMark(String sessionId) {
		Boolean marked = jdbcTemplate.queryForObject(
				"SELECT EXISTS(SELECT 1 FROM " + TABLE_NAME + " WHERE session_id = ? AND cancelled_at IS NOT NULL)",
				Boolean.class,
					sessionId);
		return Boolean.TRUE.equals(marked);
	}

}
