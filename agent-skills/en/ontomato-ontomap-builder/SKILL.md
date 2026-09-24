---
name: ontomato-ontomap-builder
description: Build an ontomap for one datasource, import it into Ontomato, and query that data in natural language. Use when connecting MySQL, PostgreSQL, Oracle, SQL Server, DB2, Dameng, GaussDB, or DuckDB, writing or replacing the ontomap, or asking a natural-language question.
---

# Ontomap builder

Build an ontomap for one business database, import it into Ontomato, and check it with natural-language questions. Copy this directory and install it on its own. `ontomato.mjs` reads `application.yml` from the directory that contains the script.

Ontomato uses one datasource at a time. Pointing it at another source replaces the previous one.

## Prerequisites

- Ontomato is already deployed.
- You have the frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every call goes through the frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure application.yml

```yaml
# Frontend URL of Ontomato, with no path suffix
envUrl: http://host:3000
```

## Workflow

1. Fill in `application.yml`.
2. `node ontomato.mjs use-datasource <type> @payload.json`
3. Inspect the business tables and rows with your own database tools. This skill does not query that database.
4. Write the ontomap from that structure.
5. `node ontomato.mjs set-ontomap @ontomap.json`
6. `node ontomato.mjs get-ontomap` and compare it with the file you wrote.
7. `node ontomato.mjs ask "..."` with a few simple questions that touch the main tables and relationships. If an answer is missing or wrong, go back and fill in `desc` and relationships, then set the ontomap again.

## Commands

Run `node ontomato.mjs <command>` from this directory, or pass the script path. JSON may be an argument or `@file`.

```
node ontomato.mjs use-datasource <type> '<json>'
node ontomato.mjs use-datasource <type> @payload.json
node ontomato.mjs get-ontomap
node ontomato.mjs set-ontomap '<json>'
node ontomato.mjs set-ontomap @ontomap.json
node ontomato.mjs ask "How many people are there?"
node ontomato.mjs ask --lang zh "共有多少人？"
```

`type` is `mysql`, `postgresql`, `oracle`, `sqlserver`, `db2`, `dameng`, `gaussdb`, or `duckdb`.

`ask` sends `Accept-Language`. The default is `en`.

A JSON body of `{success, message, data}` with `success: false` is printed and the process exits non-zero. A non-2xx response prints the HTTP status and the response body, then exits non-zero.

## Datasource payloads

Do not put regional JDBC parameters such as `serverTimezone=Asia/Shanghai` in the URL. Passwords below are placeholders.

### mysql

`POST /api/data-query/businessConfig/useMysqlDataAdapter`

```json
{
  "mysqlUrl": "jdbc:mysql://db.example:3306/my_database?useUnicode=true&characterEncoding=utf8&useSSL=false",
  "mysqlUser": "app",
  "mysqlPassword": "change-me"
}
```

### postgresql

`POST /api/data-query/businessConfig/usePostgreDataAdapter`

```json
{
  "pgsqlUrl": "jdbc:postgresql://db.example:5432/my_database?currentSchema=public",
  "pgsqlUser": "app",
  "pgsqlPassword": "change-me"
}
```

### oracle

`POST /api/data-query/businessConfig/useOracleDataAdapter`

```json
{
  "oracleUrl": "jdbc:oracle:thin:@db.example:1521:orcl",
  "oracleUser": "app",
  "oraclePassword": "change-me"
}
```

### sqlserver

`POST /api/data-query/businessConfig/useSqlServerDataAdapter`

```json
{
  "sqlServerUrl": "jdbc:sqlserver://db.example:1433;databaseName=my_database",
  "sqlServerUser": "app",
  "sqlServerPassword": "change-me"
}
```

### db2

`POST /api/data-query/businessConfig/useDb2DataAdapter`

```json
{
  "db2Url": "jdbc:db2://db.example:50000/my_database",
  "db2User": "app",
  "db2Password": "change-me"
}
```

### dameng

`POST /api/data-query/businessConfig/useDmDataAdapter`

```json
{
  "dmUrl": "jdbc:dm://db.example:5236/my_database",
  "dmUser": "app",
  "dmPassword": "change-me"
}
```

### gaussdb

`POST /api/data-query/businessConfig/useGaussDBDataAdapter`

```json
{
  "gaussDBUrl": "jdbc:opengauss://db.example:5432/my_database",
  "gaussDBUser": "app",
  "gaussDBPassword": "change-me"
}
```

### duckdb

`POST /api/data-query/businessConfig/useDuckDBDataAdapter`

```json
{
  "duckdbUrl": "jdbc:duckdb:/data/warehouse.duckdb"
}
```

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
| `type` | One of `varchar`, `text`, `int`, `long`, `double`, `date`, `timestamp`. Adapters pick the SQL type and the comparison form from this value. |
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
