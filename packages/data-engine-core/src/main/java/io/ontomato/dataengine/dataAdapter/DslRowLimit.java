package io.ontomato.dataengine.dataAdapter;

/**
 * Single source of truth for the row cap a data adapter applies when a DSL step omits
 * {@code output.limit}, and for reporting it when that cap actually truncates a result.
 *
 * <p>The cap is a DSL-level semantic — it bounds what the engine returns to the caller — so it is
 * defined once here instead of as a per-adapter string literal. An omitted limit is <em>not</em>
 * "no bound": it means "apply the engine default". Whenever that default truncates, the adapter
 * marks the answer, so no caller can mistake a capped result for a complete one.</p>
 *
 * <p>This complements {@link DslContractViolationException}: an unrenderable construct is rejected,
 * while a defaulted-and-hit cap is a successful but incomplete result that is reported, never silent.</p>
 */
public final class DslRowLimit {

	/** Default number of rows a terminal step returns when it omits {@code output.limit}. */
	public static final int DEFAULT_ROW_LIMIT = 20000;

	/** Answer key: {@code true} when the default cap truncated the returned rows. */
	public static final String TRUNCATED = "truncated";
	/** Answer key: the cap that was hit (present only when {@link #TRUNCATED} is true). */
	public static final String ROW_LIMIT = "rowLimit";
	/** Answer key: an actionable sentence for the planner when truncation happened. */
	public static final String TRUNCATION_HINT = "truncationHint";

	private DslRowLimit() {
	}

	/**
	 * The effective default row cap. Overridable per deployment — and by tests — through the
	 * {@code ontomato.dsl.defaultRowLimit} system property; read per query so a test can shrink it
	 * without touching adapter state.
	 */
	public static int defaultRowLimit() {
		int configured = Integer.getInteger("ontomato.dsl.defaultRowLimit", DEFAULT_ROW_LIMIT);
		return configured > 0 ? configured : DEFAULT_ROW_LIMIT;
	}

	/** The hint appended to a truncated answer. */
	public static String truncationHint(int limit) {
		return "The result was capped at the default limit of " + limit
				+ " rows and is incomplete; add an explicit output.limit or aggregate before relying on it.";
	}

	/**
	 * Per-call state threaded from the DSL to SQL/Cypher translation into the result assembly, so the
	 * adapter knows whether the cap it applied to the terminal step was its own default. Only a
	 * defaulted cap may truncate silently, so only then is the answer marked.
	 */
	public static final class Tracker {
		private int effectiveLimit = -1;
		private boolean defaulted;
		private boolean truncated;

		/** Record the cap applied to the terminal step. {@code defaulted} = it was the engine default. */
		public void terminalLimit(int limit, boolean defaulted) {
			this.effectiveLimit = limit;
			this.defaulted = defaulted;
		}

		/** Mark that the defaulted cap actually dropped rows. */
		public void markTruncated() {
			this.truncated = true;
		}

		public boolean defaulted() {
			return defaulted;
		}

		public int effectiveLimit() {
			return effectiveLimit;
		}

		public boolean truncated() {
			return truncated;
		}
	}
}
