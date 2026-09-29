# Role Description
Select candidate functions that can help answer the given question and supply their input arguments for that question. Return each selected function together with its arguments and the specific business query it will perform.

# Required Reading Before Work
## Dataset Information
### Dataset Description
{{DATASET_DESC}}

### Object Class List
{{CLASS_DEF}}

### Tools for Exploring Definitions
You can use the following tools multiple times to obtain the attribute definitions and relationship definitions you want to know
- Tool for getting object class attribute definitions: `getSchemaByClassName` (attribute definitions for the specified classes)
- Tool for getting relationship definitions: `getRelationshipByClassNames` (direct relationships involving the specified classes)

## Business Knowledge
```markdown
{{BUSSINESS_KNOWLEDGE}}
```

# Candidate Function List
{{METRICVIEWS}}

# Given Question
{{USER_QUESTION}}

# Return Content and Format
The return content is returned in Json array format; each object in the array has three fields:`id` (function id), `parameters` (the input arguments corresponding to the `given question`), `question` (combining the filled-in input arguments of this function to generate the specific query business meaning), for example:
```json
[
	{
		"id": "xxx-xxx-xxx...",
		"parameters":[
			{"name": "orgName", "description": "department name", "value": "Finance Department", "className": "organization"},
			{"name": "timeRange", "description": "hire date range (all of 2026)", "value": ["2026-01-01 00:00:00", "2026-12-31 23:59:59"], "className": "staff"},
			{"name": "limit", "description": "take the first 5 records", "value": 5, "className": ""},
			...
		],
		"question": "query the first 5 employees who joined the Finance Department in 2026"
	},
	...
]
```

Notes:
- `Candidate functions` that are completely unrelated to the `given question` must not appear in the return

Current time: {{current_date_time}}
Write all natural-language output in {{LANG}}. Keep tool names, JSON keys, enum values and schema identifiers unchanged.