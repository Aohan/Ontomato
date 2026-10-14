package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Thrown when a DSL query cannot be honored faithfully by this deployment.
 *
 * <p><b>The DSL execution contract.</b> A valid DSL construct is either rendered
 * faithfully, or rejected with a located, machine-readable violation. It is <em>never</em>
 * silently dropped and never silently truncated. Adapters uphold this contract; the
 * planner (ABC programmer, MCP agents, legacy pipeline) stays adapter-blind and simply
 * retries with a supported shape when it gets one of these back.</p>
 *
 * <p>Every violation carries a {@link Code}, the {@code dslPath} it was found at
 * (a JSON-pointer-like locator such as {@code steps[0].objects[o].conditions}), and a
 * human-readable detail naming the offending construct / field / operator / type.</p>
 */
public class DslContractViolationException extends RuntimeException {

	private static final long serialVersionUID = 1L;

	/** Machine-readable reason. Keep this list small and stable; callers switch on it. */
	public enum Code {
		/** The DSL is internally contradictory (e.g. {@code timeseries} on a non-bucket field). */
		INVALID_GRAMMAR,
		/** This deployment does not implement the construct at all (e.g. {@code timeseries}). */
		UNSUPPORTED_CONSTRUCT,
		/** The construct is implemented, but not for this (operator, field type) pair. */
		UNSUPPORTED_OPERATOR_FOR_TYPE,
		/** The construct is implemented, but not for this arity (e.g. a multi-column join). */
		UNSUPPORTED_JOIN_ARITY
	}

	/** One located contract violation. */
	public static class Violation {
		private final Code code;
		private final String dslPath;
		private final String detail;

		public Violation(Code code, String dslPath, String detail) {
			this.code = code;
			this.dslPath = dslPath;
			this.detail = detail;
		}

		public Code getCode() {
			return code;
		}

		public String getDslPath() {
			return dslPath;
		}

		public String getDetail() {
			return detail;
		}

		@Override
		public String toString() {
			return code + " at " + dslPath + ": " + detail;
		}
	}

	private final List<Violation> violations;

	public DslContractViolationException(List<Violation> violations) {
		super(buildMessage(violations));
		this.violations = Collections.unmodifiableList(new ArrayList<Violation>(violations));
	}

	public DslContractViolationException(Code code, String dslPath, String detail) {
		this(Collections.singletonList(new Violation(code, dslPath, detail)));
	}

	public List<Violation> getViolations() {
		return violations;
	}

	private static String buildMessage(List<Violation> violations) {
		StringBuilder sb = new StringBuilder();
		sb.append("DSL rejected by the execution contract (")
				.append(violations.size())
				.append(" violation").append(violations.size() == 1 ? "" : "s")
				.append("); the query was not executed. ");
		for (int i = 0; i < violations.size(); i++) {
			if (i > 0) {
				sb.append("; ");
			}
			sb.append(violations.get(i));
		}
		return sb.toString();
	}
}
