# Incomplete Dataset Description Causes Task Planner Decision Deviation

- **Scope**: the task planner's planning or clarification in a standard query has already deviated, and it is suspected that the data objects relevant to the current question did not enter its context.
- **Mechanism source**: the current task planner's dataset-description read link.
- **Last verified**: 2026-07-22.

## Symptoms

- The query targets split by the task planner lack necessary objects or dimensions.
- A query should proceed directly but clarification is repeatedly requested, or the clarification question is unrelated to the user's goal.
- The downstream query faithfully executed the plan, but the final result misses the point.

## Possible Causes

- The classes, fields, or relations involved in the question exist in the current full metadata, but did not enter the dataset description the task planner actually received this round.
- The user's wording did not hit the relevant data objects, or the relation expression caused the targeted description to miss the necessary scope.
- It may also not be "incomplete": the full metadata itself is missing, the task planner received it but did not apply it correctly, or the user's question lacks business definitions that only the user can supplement.

## Distinguishing Characteristics

- **Description omission**: the target object exists in the full metadata; the current task planner prompt's dataset description lacks it; deviation starts from planning/clarification.
- **Metadata missing**: the current full result of `read_metadata` also lacks the target object.
- **Not applied correctly**: the current description already contains the necessary object, but the task planning result does not use it; continue checking the actual prompt and output.
- **Insufficient baseline**: cannot state what objects or definitions a correct plan must contain; ask the user to supplement first.

## Verification and Localization

1. Read `${artifactRoot}/prompts/1.1 Task Planner-*.md`, and confirm this round's real question, the injected dataset description, and the final decision.
2. Use `read_metadata` to read the current JSONRule / ontology graph and dataset description, and precisely compare with the missing objects in the prompt.
3. Follow the downstream evidence to confirm whether the query only inherited the upstream planning, locating the first deviation rather than treating the final empty result as proof.

## When to Exclude

- The task planner already obtained and correctly arranged all necessary data objects, and the deviation first appears in the ABC query, Harness final Python, data facts, or display stage.
- The user has not yet given a business baseline to judge correct planning.
- The task planner's actual prompt is missing and the current injection scope cannot be confirmed; in this case only an evidence gap can be reported, not a confirmed match.
