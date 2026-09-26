---
name: query-flow-diagnosis
description: Diagnose standard query result errors, empty results, autotest Cases, or full ABC problems in analysis tasks when the anomaly is already bounded and usable artifacts exist. First confirm the actual winning branch; when the answer comes from ABC, or its recoverable artifacts need analysis, identify standard ABC / ABC Harness and trace back along the actual DSL / data-source query or the formal Python and data. Not applicable when the query is completely unavailable, or the problem clearly belongs to service, configuration, permission, or environment prerequisites.
---

# Query Flow Diagnosis

## Triggers and Boundaries

Use this Skill to handle:

- A full ABC question in standard query, autotest Case, or analysis task already has a clear execution failure.
- The query can form a result, but values, ranges, dimensions, calibers, or the final expression disagree with the external correctness baseline.
- The query is empty, data that should exist cannot be found, or the planning / clarification direction already has a clear deviation.

When the query is completely unavailable, or the problem clearly belongs to service, configuration, permission, or environment prerequisites, do not apply this flow; use the general operations loop instead.

## Prerequisites

Before entering this method you must have:

- A stable identity for the single diagnosis target, a clear anomaly, and a diagnosis goal.
- The full root path of the target's actual artifacts for this round, referred to as `artifactRoot` below. All evidence paths are prefixed by it; do not read the bare `response.md`, `prompts/`, or `diagnostics/` under the repository root.
- When judging business correctness, an external correctness baseline consisting of the expected values, statistical calibers, dimensions, time range, and key business terms; the baseline can only come from confirmed input or verified test cases, and cannot be replaced by `data_query_execute`, operations knowledge, or model guesses.

When inputs or artifacts that would change the judgment are missing, stop and report the corresponding gap instead of drilling into the execution chain without a target.

## Minimal Knowledge Reading

Once the prerequisite inputs are ready, first read `data/knowledge/standard-query-turn/index.md` to establish the whole-round link and evidence map; do not read the whole knowledge root index first, and do not pre-read the two ABC mode pages. After the winning-branch confirmation below, only when the actual answer comes from `abc`, or when there is no winner and the ABC recoverable artifacts genuinely need analysis, continue to identify the ABC internal mode and read the corresponding product model page.

Only when task planning / clarification deviation characteristics match, read `data/knowledge/standard-query-turn/incomplete-dataset-description-causes-planner-bias.md`. Read the corresponding topics under `data/knowledge/infrastructure-and-runtime-prerequisites/` for service, configuration, permission, or metadata prerequisites only when the on-site evidence points in that direction. Failure modes cannot replace this round's evidence.

## Evidence Order

### 1. Confirm the Final Presentation

Read `${artifactRoot}/response.md` and align the final presentation with the known anomaly and the external correctness baseline. The reply only proves the final content, not that the internal query is correct.

### 2. First Confirm the Winning Branch, Then Identify the ABC Internal Mode

1. First confirm from the current query run's `winner` fact whether the final answer comes from `static`, `hot`, or `abc`. When the workspace has no direct query facts, `grep` `${artifactRoot}/raw-logs/app.log` for the `query-node` "winning branch" or "query completed" records. `response.md` only proves the displayed result; the ABC prompts left by parallel execution and the "link mode" in the workspace summary cannot prove `winner=abc`.
2. When `winner=static` / `hot`, stay on the standard query overview, read the coverage-judgment artifacts, logs, and final content for that branch, and locate the deviation along its own answer contract; do not read the ABC mode pages, and do not attribute parallel ABC intermediate artifacts to the actual answer.
3. When `winner=abc`, or there is no winner but the overall error carries ABC recoverable query artifacts, use `ls` to inspect `${artifactRoot}/prompts/` and identify the internal mode by the actual role artifacts of this round's ABC session:
   - Seeing `2.1-question-analyst-*.md` and `2.2-dsl-generator-*.md`: standard ABC.
   - Seeing `2.1-abc-harness-programmer-*.md`: ABC Harness.
   - When both kinds of evidence are insufficient, record the gap; when both appear at once, combine the query run's ABC mode, session, and actual execution facts to locate the adopted link, do not pick one arbitrarily by file recency, and do not borrow the other mode's artifacts to fill evidence.
4. After identifying standard ABC, read `data/knowledge/standard-query-turn/standard-abc-mode.md` then enter 3A; after identifying ABC Harness, read `data/knowledge/standard-query-turn/abc-harness-mode.md` then enter 3B. Do not fill in an arbitrary page when mode evidence is insufficient.

When task planning, clarification, Analysis, Visualization, or response already shows a deviation first, handle it by the stage contract in the overview; do not force-search for an ABC winner just to apply 3A / 3B.

### 3A. Standard ABC: Trace Back Along the Actual Query Logic

1. Read `${artifactRoot}/diagnostics/query_logic.md` to confirm the classes, fields, relations, filters, aggregations, time range, and results that actually entered the current data source / post-calculation; use query run or diagnostic events to fill in the adopted session, sub-questions, and DSL facts when necessary.
2. Read the relevant candidates in `${artifactRoot}/prompts/2.2 DSL Generator-*.md`, match the adopted output by session, sub-question, try identifier, and the actually executed DSL, then judge whether the deviation first appeared at the query-expression stage.
3. Read the relevant candidates in `${artifactRoot}/prompts/2.1 Question Analyzer-*.md`, match the actual split by the adopted sub-questions and post-calculation requirement, then judge whether the query inherited the split deviation.
4. Only when the deviation continues to propagate upstream, or the known anomaly clearly lies in planning / clarification, read the `${artifactRoot}/prompts/1.1 Task Planner-*.md` corresponding to this round's `ready` / query.
5. Trace back along `actual data-source query/DSL → adopted DSL generation → adopted question split → task planning` to find the first step that disagrees with the correctness baseline. Prompt file order, time, and "the last candidate" do not represent adoption; when they cannot be matched to execution facts, record the evidence gap and do not assemble an assumed link.

When the actual query logic or the corresponding role artifacts are missing, first state which step of the judgment they block; only when processed artifacts are insufficient and it is genuinely necessary, fall back to reading `${artifactRoot}/raw-logs/`.

### 3B. ABC Harness: Use the Final Python as the Main Link

1. Read the `${artifactRoot}/prompts/2.1 ABCHarness Programmer-*.md` corresponding to this round's Harness session to reconstruct the tool-call order.
2. For each successful `outputCode`, record `subQuestionNo`, `question`, and `outKeyRefs`, then match its `question`, `data`, `code`, and `outKeyRefs` against the formal `DATA_TYPE` / query run results. The code and data in the formal result are this round's execution facts; when there is only successful `outputCode` text with no corresponding formal result, record the evidence gap. Fall back to `${artifactRoot}/raw-logs/` when processed artifacts are insufficient.
3. Walk forward to the last successful `test` for the same `subQuestionNo` before the formal output, use its code to explain the debugging process, and cross-check the code in the formal result. `test` prints are only a precheck, not final data evidence; when relevant row permissions are involved, `outputCode` re-runs under the current execution identity's permissions, so the formal data may differ from the test prints.
4. Check the input reading, filtering, deduplication, aggregation, merging, computation, and output of the formal Python, and compare the formal data against the external correctness baseline and `${artifactRoot}/response.md`.
5. Read the DSL / current data-source query only when needed to verify the Python input data; they are not the Harness main link, and do not trace back to the Harness programmer or task planner along a single data-source query.

When a successful `outputCode`, the corresponding successful `test`, the formal `DATA_TYPE` / query run, the final code, or the final data is missing, do not infer code behavior or fill in with test prints; record the evidence gap directly.

### 4. Business Knowledge Attribution

Execute only when the candidate cause falls on business knowledge / prompts:

- Standard ABC confirms from the relevant role artifacts the knowledge actually injected this round and its effect on the split or DSL.
- Harness reads the relevant business knowledge, exploration messages, and sub-question conclusions injected this round from the same programmer artifacts, then connects to the final Python.
- Must distinguish: **knowledge missing** (a required rule was not injected), **knowledge wrong** (the injected rule itself conflicts with the external correctness baseline), **knowledge injected but not correctly applied** (the rule exists, but the decision or code did not follow it).
- The causal chain must at least state `injected knowledge → exploration / split decision → actual query or final Python → final anomaly`. Without an external correctness baseline, you must not conclude knowledge is missing or wrong.

### 5. Verify Candidate Causes on Demand

- `read_metadata`: verify the current classes, fields, relations, and dataset descriptions. On task-planning deviation, compare the range actually injected by the task planner this round with the current full metadata.
- `data_query_execute`: use the current database dialect SQL as described by the tool to verify value domains, data facts, or query logic in the current query data source; it cannot establish a business correctness baseline.
- Raw logs: read only when processed evidence is missing or contradictory, or when the error boundary needs confirmation; avoid aimless roaming.

## Recommendations, Verification, and Stop Conditions

- By default, only give evidence-backed modification suggestions; this method does not perform state changes.
- Post-disposal verification should re-run with the same question, identity, and external correctness baseline; standard ABC checks the new actual query chain, Harness checks the new final Python and execution result, and confirm the final reply is restored at the same time.
- Stop the current path when any of the following is satisfied:
  - The first deviation has been located with this round's evidence and the causal chain is complete;
  - The candidate cause has been ruled out by this round's evidence and you need to switch to another evidence-backed stage;
  - The external correctness baseline is missing and the input gap has been stated;
  - Tools or artifacts cannot supply key evidence, and the gap plus next-step materials have been stated;
  - The state has changed but re-test conditions are not met, and the conclusion is "disposed, pending verification".

## Output Requirements

Close out with the following content:

1. The diagnosis target and the external correctness baseline.
2. The identified mode and this round's facts.
3. The first deviation, the key evidence, and the causal chain to the final anomaly.
4. The fix suggestion and its verification method.
5. The re-test result: verified, verification failed, disposed pending verification, or root cause not yet located with the evidence gap.

Static file existence, keyword hits, or similar failure modes alone cannot prove the LLM diagnosis effect or the on-site root cause.

## Available Tools

`read` / `grep` / `find` / `ls` (artifacts and knowledge) | `read_metadata` (current metadata and dataset descriptions) | `data_query_execute` (live data of the current query data source)
