# Services

- **Scope**: the ontomato, the query backend, the database, the frontend, and log retrieval services that the current two operations responsibilities commonly depend on; does not describe the topology or current state of any deployment.
- **Current implementation source**: `src/platform/observe/agent/tools/service-health-tool.ts`, `src/config/api.ts`, each service's startup and proxy entry.
- **Last verified**: 2026-07-22.

## Role and Dependencies

- The frontend carries user operations and streaming display; ontomato owns standard query, analysis tasks, the operations Agent, and observable entry points; the query backend handles query configuration; the database executes data queries; the log retrieval service supports backend evidence collection.
- The business facts in PostgreSQL and the on-disk workspace are the diagnostic basis, and must not be replaced by reverse inference from logs. Log or observability dependency anomalies may only affect evidence collection, and do not necessarily mean the query execution itself failed.
- Upstream unreachable, service stopped, or resource exhaustion presents downstream as unresponsive pages, interface failures, interrupted queries, or missing evidence; first locate the earliest unavailable dependency, and do not treat the final page wording directly as the root cause.

## On-Site Evidence

- `service_health` read-only returns the current deployment's service status and server resource summary; use this return to explain online, offline, and components not involved in the current query link, and do not statically memorize health conclusions.
- For deeper connectivity, use `data_query_execute`, `read_metadata`, or `view_app_config` per the target. Tool failures themselves must distinguish login state, proxy chain, target service, and business request errors.
- For a single execution, prefer reading its workspace `manifest.json`, `raw-logs/`, and `diagnostics/`; when backend log collection succeeds it is the entity `raw-logs/backend.log`. A new workspace does not require a timeline or flow diagram as essential evidence.

## Deviation Propagation and Verification

- After service recovery, re-execute the minimal request from the original failing entry, and confirm both the user result and necessary diagnostic evidence recover; seeing only a container online does not prove the business link has recovered.
- If only the evidence-collection service can be recovered while the original query state is unknown, the conclusion should state "evidence-collection capability recovered, business result pending retest".
