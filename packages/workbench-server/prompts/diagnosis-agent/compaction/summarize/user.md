The messages above are a diagnosis conversation to compact. Create a structured checkpoint summary that another LLM can use to continue the same troubleshooting session.

Use this exact format:

## User Question
[What problem the user is asking about, including the current page target if present.]

## Target Context
- page: [observe / autotest / general / unknown]
- target: [turnKey, taskId, runId/caseId, or unknown]

## Evidence
- [Logs, traces, test results, tool outputs, file paths, timestamps, service names, or metrics already observed.]

## Ruled Out
- [Hypotheses or causes that have been checked and rejected.]

## Current Assessment
- [Best current diagnosis and confidence/uncertainty.]

## Pending Work
- [What still needs to be checked.]

## Next Step
1. [The most useful next diagnostic action.]

Keep it concise. Preserve exact turnKeys, task IDs, run IDs, case IDs, service names, paths, commands, timestamps, and error messages.
