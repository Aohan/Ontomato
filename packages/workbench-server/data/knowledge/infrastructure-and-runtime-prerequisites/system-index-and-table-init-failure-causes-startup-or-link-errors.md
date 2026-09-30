# System Index and Table Initialization Failure Causes Startup or Link Anomalies

- **Scope**: during first deployment, version upgrade, namespace change, or the database unreachable, the service cannot start or the query link is wholly abnormal.
- **Mechanism source**: the query backend's various Dao `@PostConstruct initIndex()` (PostgreSQL table creation, `CREATE TABLE IF NOT EXISTS`).
- **Last verified**: 2026-08-26.

## Symptoms

- Service startup fails (Spring container won't come up); or startup succeeds but the query link has anomalies at multiple points.
- Logs show `is not exist` involving `sys_` prefixed tables or system indexes.

## Possible Causes

Automatic table initialization at startup has no exception fallback — failure means startup failure:

- **PostgreSQL tables**: each Dao creates tables at startup (`CREATE TABLE IF NOT EXISTS`), creating them automatically if missing; when the database is unreachable, startup fails directly.
- The core runtime link-break dependency is the `jsonRule` table: the query link's type judgment, adapter conversion, and permission lineage all read from `jsonRule.classDef`; when this table's content is missing or empty, the link breaks at multiple points.

## Verification and Localization

1. First confirm whether the service started successfully and whether initialization errored in the startup log; on startup failure, prioritize checking PostgreSQL connectivity and namespace configuration.
2. When startup succeeds but the link breaks, use `read_metadata` to check whether the `jsonRule` content exists and classDef is non-empty.
3. Manually creating DDL is only a fallback when automatic initialization is unavailable; before executing, first confirm the root cause of the initialization failure and obtain user authorization.

## When to Exclude

- `is not exist` involving business class, field, or relationship names → go to [Schema/metadata inconsistency causes query anomalies](schema-metadata-mismatch-causes-query-errors.md).
- App started successfully and errors appear only in individual requests → more likely permission or data problems.
