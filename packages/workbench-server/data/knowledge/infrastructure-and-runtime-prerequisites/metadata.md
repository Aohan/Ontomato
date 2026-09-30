# Metadata

- **Scope**: the JSONRule / ontology graph used by the query backend, the dataset descriptions oriented to the task planner, and the actual classes, fields, relations, and data facts in the database.
- **Current implementation source**: `src/platform/observe/agent/tools/read-metadata-tool.ts`, `src/platform/observe/agent/tools/data-query-execute-tool.ts`, the task planner's dataset-description read link.
- **Last verified**: 2026-08-26.

## Role and Dependencies

- The JSONRule / ontology graph describes the queryable classes, fields, and relations; the dataset description relevant to the question is the task planner's current understanding scope. The two, together with the database's actual schema, relationship instances, and business data, carry different facts and cannot substitute for each other.
- Inconsistent identifiers, relationship endpoints, or data types will cause planning, DSL, or execution to deviate; when the metadata structure is correct but relationship instances or business data are missing, a legal empty result may still occur.
- ontomato proxies external data sources and metadata capabilities and does not keep an authoritative schema locally.
- `jsonRule.classDef` registration not only serves planning and DSL generation but is also the basis for execution-layer type judgment and permission lineage determination, matched exactly by class name. Runtime temporary class names (`save_table`, `/temp_*`, `/final_class`) are never registered; unregistered class names entering the execution layer trigger a known failure, see [Unregistered class names cause execution NPE or illegal SQL](../standard-query-turn/unregistered-class-name-causes-npe-or-invalid-sql.md).

## On-Site Evidence

- `read_metadata` reads the current JSONRule / ontology graph by default; use the Markdown format to read the current dataset-description capability. The tool uses the session's latest `tk`, and what it returns is the fact of this invocation.
- Confirm the actual injected scope from the current task planner prompt; confirm the actually used classes, fields, and relations from the standard ABC's DSL or the Harness final Python; use `data_query_execute` to verify the schema and data in the database.
- When a query succeeds but is empty, first distinguish filter logic, schema, relationship instances, target identifiers, and value ranges; do not assume fixed relationship fields or import commands.

## Deviation Propagation and Verification

- Missing full metadata affects dataset descriptions and downstream queries; full metadata present but the current description omitted → deviation starts from task planning; the current description and query logic are both correct but data is empty → continue checking actual data facts.
- After disposition, re-read the current metadata, retest with the original question, and confirm that task planning, query evidence, and final result recover consistently.
