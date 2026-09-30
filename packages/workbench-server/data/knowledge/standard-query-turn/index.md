# Standard Query Turn

- **Scope**: one round of execution of the standard query real-time dialogue and its Turn workspace; does not include the analysis agent's task report flow.
- **Current implementation source**: `src/core/graph/workflow.ts`, `src/core/graph/nodes/`, `src/services/data-query/`, `src/platform/workspace-artifact/`; for the query execution foundation, see the query backend `util/HttpRequestUtil.java`, `dataAdapter/DataAdapterFactory.java` and each `*Adapter`.
- **Last verified**: 2026-08-26.

## Reading Triage

This page first explains the whole round's three-layer relationship and common downstream. After the ABC internal mode is identified on-site, read [Standard ABC Mode](standard-abc-mode.md) or [ABC Harness Mode](abc-harness-mode.md); do not mix the roles and evidence of the two modes.

## Three-Layer Mainline

1. **Task planning**: `standard-query-TaskPlanner` judges whether the task is clear, outputting `reply`, `clarify`, or `ready`. A `ready` plan contains at most one upper-level query request; when there is no query this round, a single real available historical query fact in the current replay can be selected for later analysis or visualization. A new query and a historical-query selection are mutually exclusive; a single query can still contain multiple metrics and sub-questions.
2. **Basic query race**: when the plan contains a query, the query orchestration node hands the same complete question in parallel to `static`, `hot`, `reportCard`, `abc`. Each branch completes its required coverage judgment, content or data acquisition, result adaptation, and answer close-out per its own contract; only branches that produce a Dataset go through field adaptation. The first branch to complete its own full answer contract is the winner; producing data, DSL, or code first does not count as winning.
3. **ABC internal solving**: the `abc` branch then enters the traditional multi-role pipeline or the single Programmer Agent tool loop per the current mode. Mode-internal artifacts cannot cross the full-answer boundary and become a race winner early.

## Branch Flow

```text
TaskPlanner
├─ reply   → Reply Agent → direct-reply snapshot
├─ clarify → clarification snapshot
└─ ready   → ordered query / Analysis / Visualization steps
            ├─ has query (at most one) → four-branch race → ABC mode (if ABC)
            ├─ no query + one selected historical query fact → Analysis / Visualization
            └─ current context already has available data → Analysis / Visualization
            → response page snapshot
```

## Entry Planning and Direct Close-Out

| Component | Type | Responsibility | Expected input | Expected output | Completion condition & downstream | Observable evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `standard-query-TaskPlanner` | Model Agent | Uniformly judge whether the task is clear, and plan direct reply, clarification, or execution steps; does not answer data questions | This round's user input, dataset descriptions, business knowledge, recent replay and previous-round clarification context | Readable planning description and machine plan of `reply` / `clarify` / `ready` | Plan passes strict parsing and constraint validation; `reply` goes to Reply Agent, `clarify` goes to response close-out, `ready` enters ordered steps | `prompts/1.1 Task Planner-*.md`, task planning events and checkpoint planning facts |
| `standard-query-Reply` | Model Agent | Generate a no-query direct answer per the reply type and requirements given by the task planner; the task planner itself does not answer | `replyKind`, `replyInstruction`, user question, recent user context; capability/explanation types add the latest dataset descriptions as needed | Streaming direct-answer text | Text or defined error fallback forms an assistant message and writes the direct-reply snapshot | Corresponding Agent prompt/LLM logs, `chat_render_snapshots` |
| clarification / response | Deterministic orchestration nodes | Fix the task planner's already-generated clarification question and executable options as this round's page result | `clarify` plan | Clarification card snapshot | Writes one replayable assistant result; does not start the basic query | `chat_render_snapshots`, `execution_events` |

## Basic Query Race and Common Answer Boundary

| Component | Type | Responsibility | Expected input | Expected output | Completion condition & downstream | Observable evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Basic query race | Deterministic orchestration service | Start allowed query branches simultaneously, select the first complete answer and cancel the rest | One complete query question, current identity and language, current ABC mode, cancellation signal | A unique complete winner; or overall error plus latest ABC recoverable artifact | A branch can win only by completing its own answer contract; no winner means no stitching of other branches' intermediate artifacts | query thinking, branch logs, winner / status and artifacts of `query_runs` |
| `static` | Retrieval service + coverage judgment model | Try to cover the current question with fixed-metric hot data, then fetch detail, adapt and generate this branch's conclusion | Complete question, fixed metric cards, business knowledge, current identity | Dataset, field display and branch answer | Coverage sufficient and answer close-out complete; otherwise exit the race | `data-query-HotDataStatic` prompt/log, query events |
| `hot` | Retrieval service + coverage judgment model | Try to cover the current question with dynamic-metric hot data and form the current-data answer | Complete question, dynamic metric cards, business knowledge, current identity | Dataset, field display and branch answer | Coverage sufficient, current data obtained and answer close-out complete | `data-query-HotDataDynamic` prompt/log, query events |
| `reportCard` | Retrieval service + metric validation model | Verify whether the precomputed metric matches the question and return the saved latest metric body | Complete question, precomputed metric candidates, current identity | Verified precomputed Markdown / card answer; current implementation `datasets=[]` | Coverage model judges answerable and non-empty precomputed body is ready; the body itself is the complete answer, not requiring Dataset, FieldAdapter or extra Conclusion | `data-query-HotDataPrecomputed` prompt/log, card thinking and query content |
| `abc` | Mode routing and query service | Choose traditional ABC or Harness, execute the broadest-coverage solving link | Complete question, dataset definitions, knowledge, current permission context and mode snapshot | Mode-specific content, dataset, code/DSL and replay facts | The corresponding mode's full answer contract completes; details in the two mode pages | Backend ABC role artifacts, `query_runs`, `diagnostics/query_logic.md` |
| `data-query-FieldAdapter` + display rules | Display planning model + deterministic conversion | For `static`, `hot` and `abc` results that produce a Dataset, plan each new data's field names, units, scale and precision only once, then deterministically generate display values and tables; current `reportCard` does not pass this stage | Raw rows, question, language, output field descriptions, actual Python code | `fieldDisplayPlan`, Dataset preserving original values, display rows and table | Legal plan or conservative fallback forms; the same plan is reused for answer, page, and deep analysis | `prompts/3.3 Field Display Planner-*.md`, Dataset and query snapshots |
| Branch-specific answer close-out | Model + deterministic fallback | Answer the complete question with each branch's own evidence form: `static` / `hot` use Conclusion, `reportCard` directly uses the verified precomputed body, traditional ABC and Harness each close out themselves | The current branch's authoritative result, plus the field display plan and query process the branch needs | User-facing branch answer | Model answer, precomputed body, or the branch-defined fallback must complete before the race answer boundary is met | `data-query-Conclusion`, `data-query-AbcHarnessAnswer`, precomputed cards or each hot-data Agent artifact |
| Standard query ABC quality check | Backend quality-check service | Attach credibility diagnostics to the complete winning ABC query, without rewriting the main query result | The winning ABC's `sessionId`, actual ABC mode and current identity | Quality-check steps, conclusion/score | Runs only when `winner=abc` and a session exists; degrades on failure, does not turn a no-winner artifact into a winner | `post_thinking` / `qcState`, quality check in query run and page snapshot |

Zero rows is a successful query result, not an execution failure. Data adaptation, field display, and branch answers must all preserve its result identity. If ABC only forms a recoverable artifact without completing the answer contract, it can only be returned along with the overall error when all branches have no winner; that artifact does not undergo quality checks.

## Optional Execution Steps and Page Reply

| Component | Type | Responsibility | Expected input | Expected output | Completion condition & downstream | Observable evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `standard-query-Analysis` | Model Agent + optional Skill execution | Perform answering analysis on this round's or the selected historical query fact per `analysis.instruction` | Explicit analysis instruction, structured data, field display plan, available analysis Skills | Analysis text, skill results and thinking process | Instruction actually consumed and analysis artifact formed; handed to response snapshot, does not rewrite query facts | Analysis prompt/LLM logs, analysis events and in-request artifacts |
| `chart-ChartPlanner` | Model Agent + visualization Skill execution | Select skills, plan and generate charts per `visualization.instruction` | Explicit visualization instruction, raw structured data, available visualization Skills | Chart plan, HTML and thinking process | Plan only references real fields/categories and executes successfully; handed to response snapshot | Shared chart planning prompt/LLM logs, chart events and in-request artifacts |
| response | Deterministic aggregation and persistence node | Aggregate query body, independent analysis text, charts, quality checks and errors into a single-round page recovery fact; it is not a writing Agent | References to each in-request artifact, errors or clarification results | Assistant message and standard page snapshot | Every round closes out with exactly a replayable reply, clarification, or error | `response.md`, `chat_render_snapshots`, `execution_events` |

## Query Execution Foundation (shared by all query entries)

Standard ABC sub-queries, Harness inline DSL calls, and direct DSL execution share the query backend's same execution chain, in a fixed order:

1. **DSL validation and class name normalization**.
2. **Vector condition rewriting + row permission injection** (`HttpRequestUtil.addVectorAndRowPermission`): all query entries must pass it, located **before** adapter routing; after injecting row permissions, the same query forms "no-permission + row-permission" dual DSL, each executed once.
3. **Data adapter routing** (`DataAdapterFactory`): precisely matches mysql / postgresql / oracle and other relational adapters by the `dataAdapter` configuration string; **unmatched values silently fall back to the default adapter** — a wrong adapter configuration manifests as "thinking it is querying a relational database, but actually hitting the database", without error.
4. **Execution**: the database directly executes the DSL, or the relational adapter first does DSL→SQL conversion then executes. In relational mode both the DSL and the converted SQL are logged at INFO level (`DSL for querying PostgreSQL:` / `converted SQL for PostgreSQL:`); on query failure the generated SQL is still kept in the failed result's query logic.
5. **Result column permission masking** (after return), mechanism see [Permissions](../infrastructure-and-runtime-prerequisites/permissions.md).

Boundary evidence for diagnosis: when the injection stage throws (e.g. NPE), the logs show **no "converted …sql" line at all**; when malformed SQL is visible, the failure is in the conversion stage. The execution layer's type judgment and permission lineage are all based on `jsonRule.classDef` registration; runtime temporary class names are not registered, see [Unregistered class names cause execution NPE or illegal SQL](unregistered-class-name-causes-npe-or-invalid-sql.md).

## Evidence Ownership and Propagation

- `query_runs` saves query business facts; `chat_render_snapshots` saves the page state the user actually saw; `execution_events` saves process diagnostics. The three cannot substitute for each other.
- When the four branches run in parallel, the non-winning ABC may still have left sessions, prompts, DSL, code, or data. The presence of ABC role files — even a workspace summary recognizing the ABC internal mode — does not prove `winner=abc`; first confirm the actual answer source by the query run's winner or the `query-node` winning-branch log.
- The Turn workspace is at `data/traces/{turnKey}/`: `manifest.json` identifies the workspace, `prompts/` saves actual model interactions, `diagnostics/query_logic.md` saves the standard ABC query logic, `response.md` saves the final page reply.
- Planning omissions pollute everything downstream; query deviation propagates to analysis, charts, and replies; when the underlying data is correct but the natural language or presentation is wrong, the deviation lands in the field-display, answer close-out, or response consumption layer.
- Business correctness comes from user confirmation or a verified baseline. When retesting with the same question, identity and definition, observe both the first deviation stage and whether the final page snapshot recovers.

Failure modes are read only when symptom characteristics match, providing only candidate directions, not replacing this round's evidence:

- Task planning or clarification anomaly → [Incomplete dataset description causes task planner decision deviation](incomplete-dataset-description-causes-planner-bias.md)
- DSL execution NPE, illegal SQL, or conditions silently dropped → [Unregistered class names cause execution NPE or illegal SQL](unregistered-class-name-causes-npe-or-invalid-sql.md)
- Results show `****` placeholders → [Mechanism triage for masked placeholders appearing in results](../infrastructure-and-runtime-prerequisites/desensitized-placeholder-mechanism-triage.md)
