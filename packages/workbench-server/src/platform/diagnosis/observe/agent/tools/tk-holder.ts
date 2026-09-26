/**
 * Per-session holder for the datarag login token (`tk`).
 *
 * The `AgentTool.execute` signature carries no request context, and the
 * diagnosis tools are created once per session. To let datarag-backed tools use
 * the page's latest `tk` without changing the core signature, each
 * {@link ManagedSession} owns one mutable `TkHolder`. The chat route writes the
 * `tk` from the request header into `holder.current` on every turn (overwrite,
 * never persisted), and the tool factories capture the holder in a closure and
 * read `holder.current` at execute time.
 */
export interface TkHolder {
  current?: string;
}
