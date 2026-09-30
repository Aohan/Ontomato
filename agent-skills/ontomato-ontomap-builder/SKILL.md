---
name: ontomato-ontomap-builder
description: Build an ontomap for one datasource, import it into Ontomato, and query that data in natural language. Use when connecting a database supported by this deployment, writing or replacing the ontomap, or asking a natural-language question.
---

# Ontomap builder

Build an ontomap for one business database, import it into Ontomato, and check it with natural-language questions. Copy this directory and install it on its own. `ontomato.mjs` reads `application.yml` from the directory that contains the script.

Ontomato uses one datasource at a time. Pointing it at another source replaces the previous one.

## Prerequisites

- Ontomato is already deployed.
- You have the frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every call goes through the frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, with no path suffix:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

## Workflow

1. Fill in `application.yml`.
2. `node ontomato.mjs list-datasources` to see which database types this deployment supports and which connection fields each type needs.
3. `node ontomato.mjs use-datasource <type> @payload.json`
4. Inspect the business tables and rows with your own database tools. This skill does not query that database.
5. Write the ontomap from that structure.
6. `node ontomato.mjs set-ontomap @ontomap.json`
7. `node ontomato.mjs get-ontomap` and compare it with the file you wrote.
8. `node ontomato.mjs ask "..."` with a few simple questions that touch the main tables and relationships. If an answer is missing or wrong, go back and fill in `desc` and relationships, then set the ontomap again.

## Commands

Run `node ontomato.mjs <command>` from this directory, or pass the script path. JSON may be an argument or `@file`.

```
node ontomato.mjs list-datasources
node ontomato.mjs use-datasource <type> '<json>'
node ontomato.mjs use-datasource <type> @payload.json
node ontomato.mjs get-ontomap
node ontomato.mjs set-ontomap '<json>'
node ontomato.mjs set-ontomap @ontomap.json
node ontomato.mjs ask "How many people are there?"
node ontomato.mjs ask --lang en "How many people are there?"
```

`type` is one of the types `list-datasources` prints.

`ask` sends `Accept-Language`. The default is `en`.

A JSON body of `{success, message, data}` with `success: false` is printed and the process exits non-zero. A non-2xx response prints the HTTP status and the response body, then exits non-zero.

## Connect a datasource

1. `node ontomato.mjs list-datasources` — `GET /api/data-query/businessConfig/dataAdapters`. Prints the adapters installed in this deployment. Each entry has `type`, `label`, `sql`, `fields` (the connection fields the type needs) and `examples` (a sample value per field).
2. `node ontomato.mjs use-datasource <type> '{"url":"jdbc:postgresql://db.example:5432/my_database?currentSchema=public","user":"app","password":"change-me"}'` — `POST /api/data-query/businessConfig/useDataAdapter`. The script merges `type` into the JSON and posts it. Send the fields listed in that type's `fields`; usually `url`, `user`, `password`.

Which types are actually available depends on the deployment. `list-datasources` is authoritative.

## Connection notes per database

Do not put regional JDBC parameters such as `serverTimezone=Asia/Shanghai` in the URL.

| Type | Notes |
| --- | --- |
| mysql | Accepts URL parameters such as `useUnicode=true&characterEncoding=utf8&useSSL=false`, e.g. `jdbc:mysql://db.example:3306/my_database?useUnicode=true&characterEncoding=utf8&useSSL=false`. |
| postgresql | Select the schema in the URL with `currentSchema`, e.g. `jdbc:postgresql://db.example:5432/my_database?currentSchema=public`. |
| oracle | Thin style, e.g. `jdbc:oracle:thin:@db.example:1521:orcl`. |
| sqlserver | Select the database in the URL with `databaseName`, e.g. `jdbc:sqlserver://db.example:1433;databaseName=my_database`. |
| db2 | e.g. `jdbc:db2://db.example:50000/my_database`. |
| gaussdb | Scheme `jdbc:opengauss://`, e.g. `jdbc:opengauss://db.example:5432/my_database`. |
| duckdb | The URL is a file path the backend can access, e.g. `jdbc:duckdb:/data/warehouse.duckdb`; `fields` is `url` only. |

## Ontomap

`get-ontomap` is `GET /api/data-query/admin/getSchema`. `set-ontomap` is `POST /api/data-query/admin/setSchema`. The body is the ontomap object itself.

`set-ontomap` replaces the whole ontomap of the domain. It does not merge with the previous one.

| Field | What to write |
| --- | --- |
| `datasetDesc` | Business description of the whole dataset. It is inserted into the abcHarness programmer prompt and the question-splitter prompt. Write the business meaning, units, and enumeration values in the language the model should use. |
| `classList` | Class names. The star-chart cut uses the first name as the root class. |
| class `name` | SQL table name. Adapters paste it unchanged and unquoted into `from` and `join`. They do not add a schema prefix and do not change case. A name matches a class only as an exact string; a leading `/` is accepted only when the stored name has none. Write the identifier the database resolves in that unquoted SQL. Put the schema in the JDBC URL, such as PostgreSQL `currentSchema`. |
| class `showName` | Display label. The question-split subgraph shows this instead of the class name. It is not the SQL name and not the class description in the prompt. |
| class `desc` | Class description in the prompt. The programmer's class list and `getSchemaByClassName` both show it. Write the business meaning, units, and enumeration values. |
| `inStarChart` | `true` includes the class in the star chart. A relationship is kept only when both classes are `true`. Use `true`. |
| attr `name` | SQL column name. Adapters paste it unchanged and unquoted (`alias.column`). Same exact-match rule as the class name. |
| attr `showName` | Saved on the ontomap and returned by `get-ontomap`. The schema text and SQL use `name` and `desc`. |
| attr `desc` | Field description the model reads. `getSchemaByClassName` and the question-splitter schema put it in the "field description" column. Write the business meaning, units, and enumeration values. |
| `type` | One of `varchar`, `text`, `int`, `long`, `double`, `date`, `timestamp`, `vector`. Adapters pick the SQL type and the comparison form from this value. When set to `vector`, it corresponds to a text column in the underlying database storing a JSON array `[{"path":"...","text":"..."}]`, which is maintained by the vector upload interface and should not be hand-written; vector writes are supported only on PostgreSQL and DuckDB (plus M3 on enterprise), while other data sources (MySQL, Oracle, SQL Server, Db2, GaussDB, Dameng) explicitly fail with unsupported; vector attributes cannot be used for equality or range comparisons and can only be semantically queried via DSL vector conditions. |
| `bizzKey` | On the DSL question path, `true` adds this column to the result when the query left it out. The SQL built for `ask` does not read this flag. Use `true` for columns that path should keep, and `false` otherwise. |
| `enable` | `true` includes the column in the schema text and in SQL. `false` omits it. A missing value counts as enabled. Use `true`. |
| `primaryKey` | Exactly one `true` on each class. The schema text marks it, and insert and object lookup use it as the id column. |
| relationship key | Relationship type name. A join looks the relationship up by this key. The prompt table calls it the relationship type. |
| `fromClass`, `toClass` | Class `name` of the two ends. |
| `fromField` | Column `name` on `fromClass`. |
| `toField` | Column `name` on `toClass`. The join is `fromClass.fromField = toClass.toField`. |
| relationship `desc` | Relationship description in the prompt table. Write the business meaning. |

```json
{
  "datasetDesc": "Employees and departments",
  "classList": ["dept", "emp"],
  "classDefs": [
    {
      "name": "dept",
      "showName": "Department",
      "desc": "A department",
      "inStarChart": true,
      "attrs": [
        {
          "name": "id",
          "showName": "ID",
          "desc": "Department id",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": true
        },
        {
          "name": "name",
          "showName": "Name",
          "desc": "Department name",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": false
        }
      ]
    },
    {
      "name": "emp",
      "showName": "Employee",
      "desc": "An employee",
      "inStarChart": true,
      "attrs": [
        {
          "name": "id",
          "showName": "ID",
          "desc": "Employee id",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": true
        },
        {
          "name": "dept_id",
          "showName": "Department",
          "desc": "Department id",
          "type": "varchar",
          "bizzKey": false,
          "enable": true,
          "primaryKey": false
        },
        {
          "name": "age",
          "showName": "Age",
          "desc": "Age in years",
          "type": "int",
          "bizzKey": false,
          "enable": true,
          "primaryKey": false
        }
      ]
    }
  ],
  "relationshipDefs": {
    "emp_dept": {
      "fromClass": "emp",
      "toClass": "dept",
      "desc": "Employee belongs to department",
      "fromField": "dept_id",
      "toField": "id"
    }
  }
}
```

## Natural-language questions

`ask` posts `{question}` to `/api/data-query/abcHarness`. The response is `text/event-stream`. The script prints each event as the stream delivers it:

- the opening `{sessionId, nodeId}` frame as `session <id>`
- `MESSAGE_TYPE` text
- `DATA_TYPE` as the question plus the data JSON
- an `error` frame to stderr, then a non-zero exit

Heartbeat comments are not printed.

`ask` often takes several minutes. Set the command timeout long enough for the whole run.
