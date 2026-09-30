# Configuration

- **Scope**: the query backend's current effective business configuration, ontomato's system model configuration, and the models, vectorization, and data connections that depend on them; does not save any environment's current values.
- **Current implementation source**: `src/platform/observe/agent/tools/view-app-config-tool.ts`, `src/config/system-model.ts`, `src/config/index.ts` and the query backend configuration-read implementation.
- **Last verified**: 2026-07-22.
- **Verification scope**: 2026-09-22 covers only the fact that business knowledge and business terms were merged into one entry (the standalone term entry, term retrieval, and `BussinessTermDao` were removed); the rest of this file was not re-verified.

## Role and Dependencies

- The current running configuration may come from deployment initial values or persisted configuration; once saved, the running effective value and how it takes effect are the diagnostic facts, not just the example file or another environment's configuration.
- Model connections, auth, custom request parameters, data connections, and some execution parameters affect the query or analysis link; save links that need vectorization also depend on the corresponding embedding capability. A configuration that looks suspicious is only a candidate cause, and still needs to be combined with the current error or connection test.
- the query backend vector-retrieves business knowledge by question relevance; only confirmed knowledge participates in augmentation; the embedding capability also affects whether later knowledge augmentation is available.
- Knowledge augmentation failure needs to be combined with this round's planning, query, and error evidence to judge the impact scope; it does not mean the whole query is necessarily interrupted.
- Configuration descriptions and configuration values have different responsibilities: descriptions explain modification entry points and how they take effect, and do not represent current values.

## On-Site Evidence

- Use `view_app_config` to read the query backend's current effective configuration; `data.config` is the masked current content, and `data.desc` is the backend-provided modification and effect description. Read the minimal configuration segment per goal.
- Sensitive values are masked, so whether credentials are still valid cannot be judged from them; combine with specific call errors or have the user test at the authorized management entry.
- Configuration read failure, not configured, and configuration read but call failure are different states. Record the tool return, related service status, and the specific stage where the error occurred; do not substitute fixed URL patterns for on-site verification.

## Deviation Propagation and Verification

- Configuration deviation can first appear at the model call, vectorization save, data connection, or runtime parameter stage, and present downstream as missing planning, query failure, or page errors.
- After authorized modification, first confirm the target configuration has become the current effective value, then retest the original failing action; a successful test only proves that request pattern can be called, and the final business link still needs separate verification.
