# Infrastructure and Runtime Prerequisites

This topic describes the runtime prerequisites shared by standard query Turns and analysis agent tasks. First select only one specific topic based on the problem; do not treat checking every prerequisite item-by-item as a fixed flow for every diagnosis.

| Goal | File to read |
| --- | --- |
| Whether services are online, dependencies reachable, resources abnormal | `services.md` |
| Whether the current effective model or runtime configuration matches expectations | `configuration.md` |
| Whether page/API authorization or data visibility scope matches the current user identity | `permissions.md` |
| Whether classes, fields, relations, dataset descriptions, or actual data relations match query needs | `metadata.md` |

The above files store stable meanings and evidence-collection directions, not the current values of service addresses, keys, namespace, model parameters, user permissions, or schema. Dynamic facts continue to be obtained through existing tools, external permission systems, the current round of page/API evidence, and user supplements.

## Failure Modes

Read only when symptom characteristics match; entries only provide candidate directions, and conclusions must return to the current round of evidence.

| Symptom characteristic | Entry |
| --- | --- |
| Results or tables show `****` placeholders | [Mechanism triage for masked placeholders appearing in results](desensitized-placeholder-mechanism-triage.md) |
| Page/API unavailable or entry missing, pointing to authorization | [Missing permission configuration causes pages inaccessible or data masked](missing-permission-config-blocks-access-or-masks-data.md) |
| Terms/knowledge/examples fail to save | [Business knowledge vectorization failure causes save failure](business-knowledge-vectorization-failure-blocks-saving.md) |
| Startup failure or `sys_` table/index `is not exist` | [System index and table initialization failure causes startup or link anomalies](system-index-and-table-init-failure-causes-startup-or-link-errors.md) |
| Business class/field/relation names report not exist, graph missing links | [Schema/metadata inconsistency causes query anomalies](schema-metadata-mismatch-causes-query-errors.md) |
| DSL correct, execution succeeds but no result or abnormal result | [Missing data relations or identifier inconsistency causes empty query results](missing-or-inconsistent-data-relations-cause-empty-results.md) |
| backend log repeats starChart file not exist every second | [Missing star chart full data causes retries every second](missing-star-chart-full-data-causes-retry-every-second.md) |

Execution-layer failure modes (DSL execution NPE, illegal SQL) are attached under the [Standard Query Turn](../standard-query-turn/index.md) topic.
