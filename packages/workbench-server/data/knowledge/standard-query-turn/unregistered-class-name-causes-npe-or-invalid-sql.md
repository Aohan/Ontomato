# Unregistered Class Names Cause Execution NPE or Illegal SQL

- **Scope**: any DSL entering the query backend query execution layer — standard ABC sub-queries, Harness inline DSL, direct DSL execution; when the target class name or field is not registered in `jsonRule.classDef`.
- **Mechanism source**: the query backend `util/DslUtil.java` (`splitToVector`'s classDefMap only loads `jsonRule.classDef`), `util/HttpRequestUtil.java` (`addVectorAndRowPermission`), each `dataAdapter/*Adapter.java`'s `toSql` (classAttrTypeMap from the same source).
- **Last verified**: 2026-08-26.

## Symptoms

- DSL execution reports `NullPointerException: Cannot invoke "java.util.Map.get(Object)"`, with stack containing `DslUtil.splitToVector` / `addVectorAndRowPermission`.
- In relational mode SQL syntax error: `syntax error at or near "/"` (table name with a leading slash and not quoted), or `syntax error at or near "and"` (condition loss produces a broken `( and (`).
- Often manifests as "DSL semantics look correct but execution fails", with the Agent repeatedly rewriting the DSL and still failing; or a filter condition is silently dropped, producing an abnormally large row count.

## Possible Causes

The execution layer's type judgment and permission lineage are all based on `jsonRule.classDef` registration, matched exactly by class name:

- **Injection stage (before adapter routing)**: vector condition rewriting looks up classDefMap for each class in `steps[0]`; an unregistered class name resolves to null and is then directly dereferenced → NPE. This always occurs when a two-step DSL's second step references a temporary table (`save_table_<sessionId>`, `/temp_*`, `/final_class`) — runtime temporary class names are never registered in classDef.
- **Relational adapter DSL→SQL conversion stage**: when a class or field type cannot be found, the leaf condition is generated as null and silently dropped while the AND separator is still output (broken `( and (`); table names are concatenated raw without quoting (leading `/` goes directly into the SQL). Each relational adapter's `toSql` is copy-paste, so the same defect exists once in each adapter.
- The trigger surface includes both runtime temporary tables and normal class/field names missing or inconsistent in the JSONRule registration.

## Distinguishing Characteristics

- **NPE form occurs before the adapter**: logs have the DSL text and a query-started marker, but no "converted …sql" INFO line — this is the boundary evidence placing the failure in the injection stage rather than the conversion/execution stage.
- **SQL syntax error form**: INFO logs directly show the malformed SQL (`from /xxx` unquoted, `( and (`); the failed result's query logic also keeps the generated SQL.
- Distinguishing from "DSL logic written wrong": manually verify the same DSL's semantics — in this failure the DSL semantics are often correct, and the failure stems from the execution layer's handling of unregistered class names.
- Downstream amplification: after data-fetch failure, conclusion generation may fabricate "data permission restriction" wording, see [Mechanism triage for masked placeholders appearing in results](../infrastructure-and-runtime-prerequisites/desensitized-placeholder-mechanism-triage.md).

## Verification and Localization

1. Take the actual DSL and (if any) generated SQL from backend logs or the failed result's query logic, and use `read_metadata` to check whether the target class name is a runtime temporary table or exists in the current JSONRule classDef.
2. Use the boundary evidence above to judge whether the failure is in the injection stage or the conversion stage.
3. For the condition-loss form, compare the DSL condition count with the SQL where condition count one by one, confirming which field was silently dropped and whether that field's type is registered in classDef.

## When to Exclude

- The target class name is registered and the SQL form is legal, with errors from the database itself (connection, timeout, data type) — not this entry.
- The DSL semantics are themselves wrong (wrong table, wrong condition), and it executes after correcting the DSL — belongs to generation-quality problems, not execution-layer failures.
