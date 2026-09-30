---
name: ontomato-app-builder
description: Build data applications on Ontomato. Import the production ontomap into a test environment, create test data modeled on production data and business knowledge, generate and debug MetricViews (query interfaces) and Actions (write interfaces) in the test environment, then build pages on top of them. Use when setting up a test environment, preparing test data, writing or debugging a MetricView or Action, or building a page that calls them.
---

# Ontomato app builder

Build data applications on Ontomato. Every query on a page calls a MetricView and every write calls an Action. You first build and test these interfaces in the test environment, then write the pages. Copy this directory and install it on its own. `ontomato.mjs` reads `application.yml` from the directory that contains the script.

## Two environments

- **Test environment**: the Ontomato deployment at `envUrl`. This skill imports definitions and test data there, generates and debugs MetricViews and Actions there, and pages call its interfaces.
- **Production environment**: another Ontomato deployment, read only. The test environment's backend reaches it through the environment variable `BACKEND_PRODUCTION_ENV_URL` (the production **backend** URL, such as `http://prod-host:18087`). An open-source production deployment needs no login, so leave `BACKEND_PRODUCTION_ENV_USER` and `BACKEND_PRODUCTION_ENV_PASSWORD` empty. `import-schema` and the `prod-*` commands go through the test backend to production; the script never calls production directly. Production must run the same Ontomato version as the test environment.

**`import-schema` wipes data in the current test domain.** It drops and recreates the current domain's namespace and all its classes and replaces the domain's whole ontomap with the production class and relationship definitions. Run it only against a dedicated test deployment, never against a deployment with business data.

## Prerequisites

- The test environment is deployed, and its backend has `BACKEND_PRODUCTION_ENV_URL` set and has been restarted.
- You have the test environment's frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every script call goes through the test environment's frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, with no path suffix:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

## Commands

Run `node ontomato.mjs [--lang <tag>] <command>` from this directory, or pass the script path. JSON may be an argument or `@file`. `--lang` goes into the `Accept-Language` header and sets the language of generated content and error messages; it defaults to `en`.

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <class> [<class> ...]
node ontomato.mjs relationships <class> [<class> ...]
node ontomato.mjs import-schema
node ontomato.mjs prod-distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs prod-query @query.json
node ontomato.mjs prod-knowledge [--max <n>] <question>
node ontomato.mjs import-test-data testData.json
node ontomato.mjs vector-upload <class> <attribute> <object-id> --text <text|@file>
node ontomato.mjs vector-upload <class> <attribute> <object-id> --file <path> --text <description|@file>
node ontomato.mjs vector-delete <class> <attribute> <object-id> <path>
node ontomato.mjs distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs metric-view generate [--save] <description>
node ontomato.mjs metric-view execute <id> [<param json|@file>]
node ontomato.mjs metric-view find <class> [<question>]
node ontomato.mjs metric-view get <id>
node ontomato.mjs metric-view save @metricView.json
node ontomato.mjs metric-view delete <id>
node ontomato.mjs action generate|execute|find|get|save|delete ...
node ontomato.mjs ask "How many orders were placed last month?"
```

| Command | Backend call | Environment | Returns |
| --- | --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | test | Business description of the whole dataset |
| `classes` | `GET /admin/getAllClassNames` | test | Class names |
| `schema` | `POST /admin/getSchemaByClassName` | test | Per class: description, then each enabled attribute's name, type, primary-key flag and description |
| `relationships` | `POST /admin/getRelationshipByClassNames` | test | Relationships that start or end at the classes: source class, relationship type, target class, description |
| `import-schema` | `GET /testEnv/importSchema` | production → test | Rebuilds the current test domain from the production class and relationship definitions (see the warning above) |
| `prod-distinct-values` | `POST /productionEnv/queryDistinctAttrValue` | production | Distinct values of a `varchar` or `text` attribute |
| `prod-query` | `POST /productionEnv/queryData` | production | DSL result JSON |
| `prod-knowledge` | `POST /productionEnv/queryBusinessKnowledge` | production | Business knowledge related to the question |
| `import-test-data` | `POST /testEnv/importData` | test | Uploads a test data file and writes it |
| `vector-upload` | `POST /vectorResource/upload` | test | Uploads text or attachment resource and binds to object attribute |
| `vector-delete` | `POST /vectorResource/delete` | test | Deletes specified vector resource of an object |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | test | Same as `prod-distinct-values` |
| `execute-dsl` | `POST /dsl/executeV1` | test | DSL result JSON |
| `metric-view ...` / `action ...` | `/metricView/*`, `/action/*` | test | See below |
| `ask` | `POST /abcHarness` | test | Streamed events, then the data |

- After `import-schema`, `dataset-desc`, `classes`, `schema` and `relationships` return the production definitions.
- `distinct-values` / `prod-distinct-values`: `--like` filters values; without `%` the pattern is wrapped as `%pattern%`. Without `--limit` at most 100 values are shown. Use them to find the exact stored value before writing an `=` or `in` condition.
- `schema` may include `vector` attribute type, representing files or text resources attached to an object, maintained by vector upload interfaces, not supporting equality or range comparisons, only semantic retrieval via DSL vector conditions.
- A non-2xx response prints the status and body and exits non-zero. A JSON body with `success: false` prints its message and exits non-zero.

## Workflow

1. `import-schema` to bring the production definitions into the test environment.
2. `dataset-desc`, `classes`, `schema` and `relationships` to learn the dataset; `prod-knowledge` for business knowledge the application depends on; `prod-distinct-values` and `prod-query` (with a `limit`, to keep results small) to see what real production data looks like.
3. Write a test data file in the format below (leave `vector` attributes empty in the file) and load it with `import-test-data`; then upload vector resources for specific objects via `vector-upload`; check the result with `distinct-values` and `execute-dsl`.
4. Generate the interfaces the pages need with `metric-view generate` / `action generate`, and debug them with `execute`. Once you understand the structure, editing the definition from `get` and running `save` is usually faster than generating again from natural language.
5. Run `import-test-data` again before each full test pass, so data changed by Actions in the previous pass does not confuse your checks (re-importing test data clears vector resources of classes present in the file, requiring re-upload).
6. Build the pages on the tested MetricViews and Actions; see [Calling interfaces from a page](#calling-interfaces-from-a-page).

## Test data

Test data should be varied and typical enough to cover the cases the application must handle, but small. File format:

```json
{
  "objDatas": [
    {
      "className": "/namespace/class1",
      "rows": [
        {"id": "c1", "attr1": "East", "attr2": 3.5}
      ]
    }
  ],
  "relDatas": [
    {"relationName": "relationship type", "sourceObjId": "source primary key value", "targetObjId": "target primary key value"}
  ]
}
```

The backend checks everything before importing and rejects the whole file, with the reason, on the first violation:

- `className` must be an existing class in the test environment, written as `classes` returns it.
- A row may contain only the class's **enabled** attributes (the ones `schema` lists).
- Every row must have a non-empty primary key value. The primary key is the attribute `schema` marks as primary key; when a class has none, `import-schema` makes its first enabled attribute the primary key.
- Primary key values must be unique across the whole file, across classes as well.
- `relationName` must be an existing relationship type. `sourceObjId` must be the primary key value of a row of the relationship's source class in this file, and `targetObjId` of a row of its target class.
- A row containing a `vector` attribute must leave it empty or omit it (providing a value will cause the entire file to be rejected); after importing test data, use `vector-upload` to attach vector resources to specific objects. The target object must already exist (otherwise upload fails without creating file or record); an attached file must not be empty.
- On import, every class that appears in the file is emptied along with its associated vector resources and then written; classes not in the file are left alone.
- Vector write and storage are supported only on PostgreSQL and DuckDB (Enterprise edition also supports M3); performing vector write operations on MySQL, Oracle, SQL Server, Db2, GaussDB, or DM will explicitly report an unsupported error.
- Production environments do not expose vector upload or delete interfaces; vector links returned by `prod-query` point directly to the production environment, while test environment vector resources must be prepared by testers using the above interfaces.

## MetricViews and Actions

A MetricView is a read-only query interface and an Action is a write interface. Their commands and structure are the same; the examples use MetricView (replace `metric-view` with `action`).

- `generate [--save] <description>`: describe in natural language what the interface should do; prints the generated definition. With `--save` it is saved once generated.
- `execute <id> [<params>]`: calls the interface. Params are a JSON object keyed by `function.parameters[].name`; omit them for an interface without parameters. A MetricView returns rows. An Action returns its execution result (`result`, `spendTime`); when it fails, the script prints the reason and exits non-zero.
- `find <class> [<question>]`: published interfaces related to a class; with a question, the 10 most relevant by meaning. Each entry has `id`, `name`, `logic`, `parameters` and `returnDef`.
- `get <id>`: the full definition.
- `save <definition>`: saves a definition; the body is the JSON `get` prints. With an `id` it updates that interface (the `id` must exist); without one it creates a new interface. Built-in system interfaces cannot be changed.
- `delete <id>`: deletes the interface.

The core of a definition is `function`: `logic` says in natural language what the interface does, `parameters` are its inputs (`name`, `type`, `description`, `sample`), `code` is the program that runs, and `returnDef` describes the returned structure.

## Calling interfaces from a page

A page calls the interfaces through the test environment's frontend, the same path the script uses:

```
POST <envUrl>/api/data-query/metricView/execute
POST <envUrl>/api/data-query/action/execute
Content-Type: application/json
Accept-Language: en

{"id": "<MetricView or Action id>", "param": {"param1": "xxx", "param2": 12.3}}
```

The response is `{"success": true, "data": ...}`, or `{"success": false, "message": "..."}` on failure.

If a page needs to upload or delete vector resources of an object, call via frontend forwarding:

- Upload resource (multipart/form-data):
  `POST <envUrl>/api/data-query/vectorResource/upload`
  Form fields: `content` (required, description text used for vector generation), `className`, `attrName`, `objectId`; if attaching a file, pass `file` (must not be empty) and specify extension in `suffix` (alphanumeric only, 1-16 chars; defaults to txt when no file attached). The target object must already exist in the test environment (otherwise upload fails without saving file or record). On success returns `{"success": true, "data": {"id": "...", "path": "<index_name>/<id>.<suffix>", "content": "...", "className": "...", "attrName": "...", "objectId": "..."}}`, where `data` is the saved resource record and `data.path` is the relative path `<index_name>/<id>.<suffix>` to be passed as `path` when deleting.
- Delete resource (application/json):
  `POST <envUrl>/api/data-query/vectorResource/delete`
  Request JSON body: `{"className": "...", "attrName": "...", "objectId": "...", "path": "<data.path from upload>"}`. On success returns `{"success": true}`.
- Resource download and display:
  Vector fields returned by query interfaces (MetricView or DSL) are formatted as `[{"path": "<full_download_url>", "text": "..."}]`, where `path` is automatically constructed by the backend as an accessible URL prefixed with the system's `cardBaseUrl` configuration (`<cardBaseUrl>/vectorResource/resource/<path>`).

## Natural-language questions

`ask` hands a question to Ontomato, which plans and runs the queries itself. Use it to look at data ad hoc, not as a page interface. It often takes several minutes; set the command timeout long enough for the whole run.

## DSL rules

`prod-query` and `execute-dsl` take the same DSL; one runs it in production, the other in the test environment.

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

	In DSL, a temporary table can only be referenced as an intermediate result within a single execution of the same DSL object. The step that produces the temporary table and the step that references the temporary table must be placed in the steps of the same DSL object and executed as a whole through one `execute-dsl` or `prod-query` call. It is strictly forbidden to first "save" a temporary table with one call and then reference it in another DSL or another call.

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

`execute-dsl` and `prod-query` print the response. `data[0].answer` holds the rows of the step with `to_user: true`, and `data[0].mqls` holds the statements that ran. When the query fails, `error` explains why and the script exits non-zero. If the result contains a vector field, its value is an array of objects containing resource download URLs and text summaries: `[{"path": "<download_url>", "text": "..."}]`.
