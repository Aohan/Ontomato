The messages above are NEW diagnosis conversation messages to merge into the existing summary in <previous-summary>.

Update the existing summary using the same exact format:

## User Question
[Preserve the original question unless the user's goal changed.]

## Target Context
- page: [observe / autotest / general / unknown]
- target: [turnKey, taskId, runId/caseId, or unknown]

## Evidence
- [Preserve existing evidence and add new observations.]

## Ruled Out
- [Preserve and update rejected hypotheses.]

## Current Assessment
- [Update the current diagnosis and uncertainty.]

## Pending Work
- [Remove completed checks and add new pending checks.]

## Next Step
1. [The most useful next diagnostic action.]

Preserve exact turnKeys, task IDs, run IDs, case IDs, service names, paths, commands, timestamps, and error messages. Remove stale details only when they are clearly superseded.
