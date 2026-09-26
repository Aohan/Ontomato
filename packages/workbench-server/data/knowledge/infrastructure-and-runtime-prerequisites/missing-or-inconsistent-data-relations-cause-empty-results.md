# Missing Data Relations or Identifier Inconsistency Causes Empty Query Results

- **Scope**: configuration, metadata, and query generation show no obvious problem, but the actual database query returns no result or differs from expectations; data-fact-layer investigation.
- **Mechanism source**: the database's relationship storage behavior, verified on-site in the dev environment via the same `data_query_execute` channel on 2026-08-26: the source object has a column **named after the relationship** (e.g. `person_to_org`), whose value is `{"_all": [target object ID…]}`, and is null when there is no relationship; the object ID has the form `class identifier:business primary key` (e.g. `univ_demo_org:1112`); `match (a:/ns/a_class)-[:relationship name]->(b:/ns/b_class) return … limit N` can traverse the graph directly.

## Symptoms

- Splitting and DSL are both correct and execution reports no error, but the result is empty or differs from the baseline.
- Directly executing the actual query logic (`diagnostics/query_logic.md` in the Turn workspace) via `data_query_execute` also returns no result.

## Possible Causes

| Situation | Characteristic | Root cause |
| --- | --- | --- |
| Relationship not imported | Source object exists but the relationship column is empty | The import-relationship statement was not executed or failed |
| Target ID inconsistent | Relationship column has value but graph query has no match | Imported target ID format inconsistent with the destination's actual ID |
| Business logic deviation | Graph query has results but differs from expectations | Business association rule misunderstood when creating the relationship |
| Sparse data | Each relationship individually returns data, but multi-relationship joint queries are always empty | Data does not actually hang on multiple links at once; joint conditions too strong |

## Verification and Localization (read-only)

1. Query the source object and observe whether the relationship-named column has a value: `select id, <relationship name> from /ns/a_class where <source-side condition>`; a null column means the object has no such relationship.
2. When the relationship column has a value, take the target ID in its `_all` array and compare format and value with the destination object's actual `id` (`select id from /ns/b_class …`).
3. Starting from a single source object, traverse the graph (`match (a:/ns/a_class where id='…')-[:relationship name]->(b:/ns/b_class) return …`) to verify relationship reachability and business logic.
4. When multi-relationship joint queries are always empty, break them apart and verify individually; whether it is "data modeling is inherently so" or "data missing" needs business-side confirmation, not a conclusion from logs alone.

## When to Exclude

- Identifiers inconsistent with schema (`is not exist`-type errors) → go to [Schema/metadata inconsistency causes query anomalies](schema-metadata-mismatch-causes-query-errors.md).
- Data repair (importing missing relations, correcting IDs) is data-side disposition, requiring user authorization and execution by the data owner; this entry only covers localization.
