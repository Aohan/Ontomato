# Schema/Metadata Inconsistency Causes Query Anomalies

- **Scope**: query failures, empty results, or graph not displayed caused by JSONRule metadata being inconsistent with the actual database schema.
- **Mechanism source**: the query backend management console's pretty JSONRule and internal storage bidirectional conversion (`service/impl/AdminServiceImpl.java`), `util/JSONCheckUtil.java`; database queries are strictly case-sensitive.
- **Last verified**: 2026-08-26.

## Symptoms

- Query reports `class not found` / `property not found` / `relation not found`, or returns empty when there should be data.
- Identifiers in the DSL appear as PascalCase / camelCase (e.g. `/univ_demo/Person`, `personToTechDuty`), while the database is actually all-lowercase / snake_case.
- The object-class relationship graph has no content or missing links.
- The metadata probing tool's type judgment conflicts with the schema description (e.g. a field marked varchar but the probing tool refuses to process it as varchar).

## Possible Causes

- **Naming style inconsistency**: the Agent generates DSL based on JSONRule; when class names, field names, and relationship names are inconsistent with the database's actual naming, the query fails or is empty. The database is strictly case-sensitive.
- **Dangling relationship references**: `relationshipDefs`' `fromClass` / `toClass` are hand-written strings and may reference class names that do not exist in `classDefs` (trailing/leading underscores, spaces, case differences).
- Note: `classDefs` / `relationshipDefs` refer to the pretty JSONRule format visible in the management console; the internal storage field names differ (`classDef` / `relationship_rule` / `fromclass` / `toclass`); verification should use the pretty format exported from the management console.

## Distinguishing Characteristics

- `is not exist` involving business class/field/relationship names → this entry; involving `sys_` prefixed system tables → go to [System index and table initialization failure causes startup or link anomalies](system-index-and-table-init-failure-causes-startup-or-link-errors.md).
- Type registration problems can also appear as execution-layer failures (conditions silently dropped, SQL generation anomalies), see [Unregistered class names cause execution NPE or illegal SQL](../standard-query-turn/unregistered-class-name-causes-npe-or-invalid-sql.md).

## Verification and Localization

1. From the current artifacts (`diagnostics/query_logic.md` or the failed result's query logic), extract the actual DSL's class names, field names, and relationship names.
2. Use `read_metadata` to obtain the current JSONRule, and `data_query_execute` to sample-verify the actual database schema, comparing case, naming style, and extra characters one by one.
3. For graph problems, iterate `relationshipDefs`, checking that each `fromClass` / `toClass` exactly exists in `classDefs[].name`.
4. Manually changing DSL identifiers to the actual database names for temporary verification is only for attribution; disposition is to fix the metadata and then retest with the original question.

## When to Exclude

- Identifiers all consistent and query legal but still no result → go to [Missing data relations or identifier inconsistency causes empty query results](missing-or-inconsistent-data-relations-cause-empty-results.md).
