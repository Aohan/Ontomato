---
name: ontomato-analyst
description: Query and analyze business data through Ontomato. Use when reading the ontomap (dataset description, classes, attributes, relationships), exploring attribute values, running a DSL query, asking a natural-language data question, or running a deep analysis with an Ontomato analysis agent.
---

# Ontomato analyst

Query and analyze the data behind an Ontomato ontomap. Copy this directory and install it on its own. `ontomato.mjs` reads `application.yml` from the directory that contains the script.

Three ways to get data, from most control to least:

- **DSL**: read the ontomap, write a DSL query, run it with `execute-dsl`. Results come back as rows.
- **Natural language**: `ask` hands a question to Ontomato, which plans and runs the queries itself.
- **Analysis agents**: an MCP server runs multi-dimensional analysis and produces reports. Configure it in your MCP client; this skill does not call it.

## Prerequisites

- Ontomato is deployed and an ontomap is imported.
- You have the frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every script call goes through the frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, with no path suffix:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

## Commands

Run `node ontomato.mjs <command>` from this directory, or pass the script path. JSON may be an argument or `@file`.

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <class> [<class> ...]
node ontomato.mjs relationships <class> [<class> ...]
node ontomato.mjs distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs ask [--lang <tag>] "How many orders were placed last month?"
```

| Command | Backend call | Returns |
| --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | Business description of the whole dataset |
| `classes` | `GET /admin/getAllClassNames` | Class names |
| `schema` | `POST /admin/getSchemaByClassName` | Per class: description, then each enabled attribute's name, type, primary-key flag and description |
| `relationships` | `POST /admin/getRelationshipByClassNames` | Relationships that start or end at the classes: source class, relationship type, target class, description |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | Distinct values of a `varchar` or `text` attribute |
| `execute-dsl` | `POST /dsl/executeV1` | DSL result JSON |
| `ask` | `POST /abcHarness` | Streamed events, then the data |

`distinct-values`: `--like` filters values; without `%` the pattern is wrapped as `%pattern%`. Without `--limit` at most 100 values are shown. Use it to find the exact stored value before writing an `=` or `in` condition.

A non-2xx response prints the status and body and exits non-zero. A JSON body with `success: false` prints its message and exits non-zero.

## Query workflow

1. `dataset-desc` and `classes` to see what the dataset covers.
2. `schema` for the classes the question needs, and `relationships` for how they join. If an attribute has type `vector`, it represents a set of file or text resources attached to the object, queried by semantics and cannot be used for equality or range comparisons.
3. `distinct-values` to confirm filter values.
4. Write a DSL query following the rules below and run `execute-dsl`.
5. If the result is empty or wrong, check class and attribute names, filter values and relationship direction, then run again.

For a question you do not want to plan yourself, use `ask`. It often takes several minutes; set the command timeout long enough for the whole run.

## DSL rules

Use the class and attribute names exactly as `classes` and `schema` return them; `schema` and `distinct-values` need the exact name. In a DSL, a leading `/` on a class name is also accepted. A relationship's `type` is the relationship type from `relationships`, and `from` / `to` point at the source and target classes.

```text
1. Represent each question as one JSON object with two properties: problem (the question text) and answer (the query plan).

2. The value of the problem attribute is the question asked

3. answer is an object containing a steps array. Execute the steps in order; a single-step query still uses an array containing one step object.

4. Each single-step query consists of a graph and an output object; graph describes the query rules and output describes the output result of the query.

5. The graph query rules include the list structure of patterns and pattern_logic

	5.1 The list structure of patterns describes the query conditions; pattern_logic represents the and/or logical relationship between multiple patterns

	5.2 patterns is a list structure that describes multiple query conditions; each query condition consists of objects, relationship.

		5.2.1 objects is a list structure that represents the query conditions of class objects; the query condition of each class is a json structure of an object, consisting of idx, variable, class and conditions

		5.2.2 idx is the sequential id within the objects list; the sequential id of the query condition of each class must not be duplicated

		5.2.3 variable is the variable name that stores the query result of this class

		5.2.4 class specifies from which class the objects matching the conditions are queried

		5.2.5 conditions represents the query conditions and consists of properties, vector, and when multiple condition types coexist the logic is `AND`. If there are no conditions, conditions may be omitted; when one of properties, vector, is present, conditions must not be omitted, and a query condition type that is not set is regarded as having no constraint.

			5.2.5.1 properties represents the query conditions of class attributes and may consist of multiple attribute conditions or a single attribute condition. For a single attribute condition it consists of field, operator and value; field is the attribute name, operator is the logical operator, including "=", "!=", ">", ">=", "<", "<=", "between", "like", "in", "is" and "is not", and value is the value of the logical operation. When operator is between, value is a two-element array; when operator is in, value is a multi-element array; when operator is is or is not, value is null. When it consists of multiple attributes, it is represented by the "operator": "logic" field, and the multiple attributes are represented by the list structure of the "and"/"or"/"not" fields; inside the list structure are multiple single-attribute conditions.

			5.2.5.3 vector represents a vector query; if filtering is performed on a vector type field of an object, it can only be defined here, and it is not allowed to perform group by or having on it in a temporary table. It consists of one attribute properties, and the properties object consists of operator and the and/or attributes

				5.2.5.3.1 The value of the operator attribute is "logic"

				5.2.5.3.2 When the constraints are in an `AND` relationship, the and attribute is required, and the and attribute is an array

				5.2.5.3.3 When the constraints are in an `OR` relationship, the or attribute is required, and the or attribute is an array

				5.2.5.3.4 A single object in the array corresponding to the and or or attribute consists of the field and query attributes

					5.2.5.3.4.1 field (required) represents the name of the vector type field in the class

					5.2.5.3.4.2 query (required) represents the text to be queried

		5.2.6  relationship indicates that a certain relationship must be satisfied between objects; it is a list structure, and relationships not returned by `relationships` must not be used. Each element in the list describes

		- the relationship requirement between two objects; each relationship requirement consists of from, to, type, min_hops and max_hops
		- from must be the idx value of the class at the start of the relationship returned by `relationships`, and to must be the idx value of the class at the end of the relationship returned by `relationships`
		- type is a list structure that refers to the list of relationship names between two types of objects; the ["*"] wildcard represents all relationships
		- min_hops represents how many hops of relationship exist at least, and it can currently only be set to 1
		- max_hops represents the maximum number of hops of relationship to query, and -1 means unlimited
		- When the list of relationship is empty, the relationship item may be omitted.

	5.3 pattern_logic represents the logical relationship between each condition within the list elements of patterns, and can be set to and or or

6. output describes the output result and consists of to_user, fields, save_table, sort, limit and group_by

	6.1 The value of to_user: true means the query result of this step is output directly to the user, and false means it is stored in a temporary table as the parameter of the next step

	6.2 save_table represents the name of the temporary table to store; it must start with `/`, the second character must be a letter, there is no requirement on the following characters, and the length must not exceed 64 characters. It takes effect when to_user is false, and when to_user is true this item is not needed,

	In DSL, a temporary table can only be referenced as an intermediate result within a single execution of the same DSL object. The step that produces the temporary table and the step that references the temporary table must be placed in the steps of the same DSL object and executed as a whole through one `execute-dsl` call. It is strictly forbidden to first "save" a temporary table with one `execute-dsl` call and then reference it in another DSL or another `execute-dsl` call.

	6.3 fields represents the output field list, a list structure; each field consists of variable, field or expr (choose one), as, function (not required), distinct (not required), variable specifies which object variable in objects to take, field specifies which attribute of the variable object to take, as is the alias the output is converted to, A distinct value of true indicates deduplication of the field (**and distinct can only act in the output of a temporary table**)
   
		6.3.1 If a field does not need a group aggregation operation, it can be output directly

		6.3.2 If a field needs a group aggregation operation, the aggregation operation must be defined according to the following logic
   
		- When there is a function field, it indicates that an aggregate calculation is needed on this attribute field; the aggregate calculation supports avg for the average, count for counting, min for the minimum, max for the maximum and sum for summation, and it aggregates the entire result set

		- When there is a function aggregate calculation, it needs to be in a different step from the query, that is, the function aggregate calculation is required to act only on the fields of the temporary table

		6.3.3 **Arithmetic operations on multiple numeric type fields may only appear in the output of a temporary table and must not appear in the first step** If arithmetic operations on multiple numeric type fields are needed, the item consists only of the expr and as attributes; expr is the mathematical expression of the arithmetic operation, and as is the alias the output is converted to

		6.3.4 The output of a vector type field requires at least two steps; in the query step the field is output to a temporary table (the as, variable and field attributes are required), and in the following step it is output from the temporary table (consisting of the as, variable, field and query attributes)

			6.3.4.1 If in the following step the field has only the as, variable and field attributes, it means outputting all the files corresponding to the vectors of the field

			6.3.4.2 If in the following step the field has the as, variable, field and query attributes, it means outputting the files corresponding to the vectors of the field filtered by the text content in query

		- It is not allowed to perform group by and having operations on vector type fields in output
		- It is not allowed to perform sort operations on vector type fields in output

	6.4 sort represents the output sorting and consists of the list structure of fields; each field consists of variable, field and order, and the list structure of fields must not be omitted even if there is only one field. variable represents the class query object result participating in the sorting, field represents the attribute field of the class query object result, order represents ascending or descending order, asc means ascending and desc means descending. When the field in sort is a calculation result and does not belong to an attribute of a class, variable may be omitted

	6.5 limit represents from which position to start and how many rows of data to take at most, and consists of offset and count; offset represents from which position to start, and count represents how many rows of data to take at most.

	6.6 group_by represents grouped statistics and consists of fields and having.

    - fields is a list structure; each field consists of variable and field; variable represents the object variable being grouped, and field represents the attribute field of the class query object result
    - having is a list structure that represents the filtering operation after group_by; each filter condition in the list consists of variable, field, function, distinct (not required), operator and value; variable represents the class query object result participating in the filtering, field represents the attribute field of the class query object result, function represents the calculation on the attribute field of the class query object result and may only use avg for the average, count for counting, min for the minimum, max for the maximum and sum for summation, ***other aggregate functions are forbidden***. distinct indicates whether to deduplicate the field attribute, and its value corresponds to true/false. The aggregate function acts on the grouped data; operator represents the logical operator, including "=", "!=", ">", ">=", "<" and "<=", and value represents the value of the logical operation

	6.7 group_by, sort and limit can be implemented in the same step.
```

### Vector Semantics

- **Vector Filtering Mechanism**: The `conditions.vector` condition in DSL takes effect only in the object conditions of the first step. Vector retrieval does not take a fixed top-k items; instead, it automatically truncates the highest-similarity cluster of resources based on similarity scores, extracts the primary keys of the corresponding objects, and converts them into a primary key `in` condition on the underlying query.
- **Two-Step Output and Semantic Filtering**: Outputting a `vector` type attribute requires at least two steps: the first step outputs the attribute to a temporary table (specifying `as`, `variable`, `field`); the following step outputs from the temporary table. If `query` is specified on the field in the second step, only resource items semantically matching the query are retained; if `query` is omitted, all resource items associated with the object are output.
- **Return Shape and Constraints**: The output vector field is an array of objects `[{"path": "<download_url>", "text": "..."}]`, where `path` is an accessible download URL (prefixed by `cardBaseUrl`). Vector fields cannot be used in `sort`, `group_by`, or `having`.

### Examples

#### Example 1: Multi-table join and grouping aggregation

```json
{
  "problem": "For customers in East China, count orders and sum order amounts per customer level, keeping levels with more than 5 distinct customers",
  "answer": {
    "steps": [
      {
        "graph": {
          "patterns": [
            {
              "objects": [
                {
                  "idx": 0,
                  "variable": "c",
                  "class": "customer",
                  "conditions": {
                    "properties": {
                      "operator": "logic",
                      "and": [
                        {"field": "region", "operator": "=", "value": "East China"},
                        {"field": "age", "operator": "between", "value": [20, 60]},
                        {
                          "operator": "logic",
                          "or": [
                            {"field": "level", "operator": "in", "value": ["gold", "silver"]},
                            {"field": "name", "operator": "like", "value": "%Ltd%"}
                          ]
                        },
                        {"field": "email", "operator": "is not", "value": null}
                      ]
                    }
                  }
                },
                {"idx": 1, "variable": "o", "class": "order"}
              ],
              "relationship": [
                {"from": 1, "to": 0, "type": ["order_customer"], "min_hops": 1, "max_hops": 1}
              ]
            }
          ],
          "pattern_logic": "and"
        },
        "output": {
          "fields": [
            {"as": "customer_id", "variable": "c", "field": "id"},
            {"as": "level", "variable": "c", "field": "level"},
            {"as": "order_id", "variable": "o", "field": "id"},
            {"as": "amount", "variable": "o", "field": "amount"},
            {"as": "discount", "variable": "o", "field": "discount"}
          ],
          "to_user": false,
          "save_table": "/temp01"
        }
      },
      {
        "graph": {
          "patterns": [
            {"objects": [{"idx": 0, "class": "/temp01", "variable": "t"}]}
          ],
          "pattern_logic": "and"
        },
        "output": {
          "to_user": true,
          "fields": [
            {"as": "level", "variable": "t", "field": "level"},
            {"as": "order_count", "variable": "t", "field": "order_id", "function": "count"},
            {"as": "total_amount", "variable": "t", "field": "amount", "function": "sum"},
            {"as": "discount_ratio", "expr": "sum(t.discount) / sum(t.amount) * 100"}
          ],
          "group_by": {
            "fields": [{"variable": "t", "field": "level"}],
            "having": [{"variable": "t", "field": "customer_id", "function": "count", "distinct": true, "operator": ">", "value": 5}]
          },
          "sort": {"fields": [{"field": "total_amount", "order": "desc"}]},
          "limit": {"offset": 0, "count": 100}
        }
      }
    ]
  }
}
```

#### Example 2: Vector retrieval and two-step output

```json
{
  "problem": "Query published documents related to security auditing, and return attachments containing access control instructions",
  "answer": {
    "steps": [
      {
        "graph": {
          "patterns": [
            {
              "objects": [
                {
                  "idx": 0,
                  "variable": "d",
                  "class": "document",
                  "conditions": {
                    "properties": {
                      "field": "status",
                      "operator": "=",
                      "value": "published"
                    },
                    "vector": {
                      "properties": {
                        "operator": "logic",
                        "and": [
                          {
                            "field": "attachments",
                            "query": "security audit specification"
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          ],
          "pattern_logic": "and"
        },
        "output": {
          "fields": [
            {"as": "doc_id", "variable": "d", "field": "id"},
            {"as": "title", "variable": "d", "field": "title"},
            {"as": "doc_files", "variable": "d", "field": "attachments"}
          ],
          "to_user": false,
          "save_table": "/temp_doc"
        }
      },
      {
        "graph": {
          "patterns": [
            {"objects": [{"idx": 0, "class": "/temp_doc", "variable": "t"}]}
          ],
          "pattern_logic": "and"
        },
        "output": {
          "to_user": true,
          "fields": [
            {"as": "doc_id", "variable": "t", "field": "doc_id"},
            {"as": "title", "variable": "t", "field": "title"},
            {"as": "matched_files", "variable": "t", "field": "doc_files", "query": "access control instructions"}
          ]
        }
      }
    ]
  }
}
```

### Result

`execute-dsl` prints the response. `data[0].answer` holds the rows of the step with `to_user: true`, and `data[0].mqls` holds the statements that ran. When the query fails, `error` explains why and the script exits non-zero. If the result contains a vector field, its value is an array of objects containing resource download URLs and text summaries: `[{"path": "<download_url>", "text": "..."}]`.

## Analysis agents (MCP)

Ontomato serves its analysis agents as an MCP server:

- URL: `<envUrl>/mcp/analysis-agents`
- Transport: Streamable HTTP
- Authentication: none

Add this server to your agent's MCP configuration. Its tools:

| Tool | Use |
| --- | --- |
| `list_analysis_agents` | List enabled analysis agents |
| `run_analysis` | Start an analysis with `agentId` and `question`; returns a task |
| `get_analysis_task` | Poll a task by `taskId` for status and the report |
| `get_analysis_report_pdf` | Get a PDF download URL for the latest run's report of a task, by `taskId` |

The tool result does not carry the PDF itself. `get_analysis_report_pdf` returns a `downloadUrl`; download it with no authentication header:

```bash
curl -o report.pdf "<downloadUrl>"
```

Only report tasks that already have report text can be downloaded; conversation tasks have no report.
