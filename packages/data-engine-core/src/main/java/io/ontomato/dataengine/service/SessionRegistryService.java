package io.ontomato.dataengine.service;

public interface SessionRegistryService {

	public String getNodeId();

	public void registerStart(String sessionId);

	public void registerEnd(String sessionId);

	/**
	 * The only implementation of cancellation checking (confirmed design 9): reads the cancellation flag from the routing table by main session number, with a short cache.
	 * A read failure is thrown directly, with no fallback to not-cancelled; callers always take this as authoritative and keep no separate flag.
	 */
	public boolean isSessionCancelled(String sessionId);

	/**
	 * Writes the cancellation time. Called only by the unified session-opening entry point when the heartbeat send fails.
	 */
	public void markSessionCancelled(String sessionId, long cancelledAt);
}
