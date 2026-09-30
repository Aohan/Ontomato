export interface DiagnosisCallerIdentity {
  domainId: string;
  token?: string;
  apiKey?: string;
}

/**
 * Per-session holder for the caller's identity (domain and credentials).
 *
 * The `AgentTool.execute` signature carries no request context, and the
 * diagnosis tools are created once per session. To let tools use
 * the caller's credentials and domain without changing the core signature, each
 * {@link ManagedSession} owns one mutable `CallerHolder`. The chat entry writes
 * the caller identity into `holder.current` on every turn (overwrite,
 * never persisted), and the tool factories capture the holder in a closure and
 * read `holder.current` at execute time.
 */
export interface CallerHolder {
  current?: DiagnosisCallerIdentity;
}
