package io.ontomato.dataengine.dataAdapter;

/** How an adapter may treat a DSL it is asked to execute. */
public enum DslExecutionMode {
	/** Execute the DSL exactly as given. */
	RAW,
	/**
	 * The adapter may rewrite the DSL into an equivalent cheaper form, for example by keeping a two-step
	 * query's intermediate result in memory instead of saving it to a table.
	 */
	OPTIMIZED,
}
