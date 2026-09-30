The messages above are an analysis conversation to compact. Create a structured checkpoint summary that another LLM can use to continue the same task.

Use this exact format:

## Analysis Question
[The user's analysis question.]

## Evidence Collected
- [questionId | query question | success or failure | the key numbers and definitions already confirmed in this question's evidence.]

## Evidence Gaps
- [Questions that failed or returned nothing, and what is still missing.]

## Findings So Far
- [Conclusions already supported by the collected evidence.]

{{reportDeliverableCheckpointSection}}

## Dispatches In Flight
- [Topics handed to workers whose briefs have not come back yet.]

## Next Step
1. [The most useful next action for completing the task.]

Keep it concise. {{reportDeliverablePreservationInstruction}}
Preserve exact questionIds, metric names, units, time ranges, numbers and error messages.
