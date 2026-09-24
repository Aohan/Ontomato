package io.ontomato.dataengine.service;

/**
 * Session cancelled (confirmed design 9 of the work item "Positioning and Cancellation of Question-Answering Backend Sessions").
 *
 * <p>A type that specifically represents cancellation: it passes through layers that swallow exceptions (once the retry loop recognizes it, it does not start a new round
 * and does not take the fallback path; the unified entry point does not send an error frame for it and does not log an error). Wherever an exception is wrapped
 * and rethrown ({@code CompletionException}, {@code ExecutionException},
 * {@code HttpException(502)}), it must first be passed through {@link #throwIfCancelled(Throwable)}
 * to be sent out unchanged, and must not be turned into an ordinary failure.
 */
public class SessionCancelledException extends RuntimeException {

	private final String sessionId;

	public SessionCancelledException(String sessionId) {
		super("Backend session cancelled: " + sessionId);
		this.sessionId = sessionId;
	}

	public String getSessionId() {
		return sessionId;
	}

	/**
	 * If a cancellation is hidden in the exception chain, rethrow it unchanged; otherwise return directly.
	 */
	public static void throwIfCancelled(Throwable error) {
		SessionCancelledException cancelled = findCancelled(error);
		if (cancelled != null) {
			throw cancelled;
		}
	}

	/**
	 * Find a cancellation along the cause chain.
	 */
	public static SessionCancelledException findCancelled(Throwable error) {
		for (Throwable current = error; current != null; current = current.getCause()) {
			if (current instanceof SessionCancelledException cancelled) {
				return cancelled;
			}
		}
		return null;
	}
}
