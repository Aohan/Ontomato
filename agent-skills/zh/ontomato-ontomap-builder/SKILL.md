---
name: ontomato-ontomap-builder
description: 为一个数据源建立 ontomap（语义层定义），导入 Ontomato，并用自然语言查询数据。在接入本部署支持的数据库、编写或替换 ontomap、或用自然语言提问时使用。
---

# ontomap（语义层定义）

为一个业务库建立 ontomap，导入 Ontomato，并用自然语言问题核对。本目录可单独拷走安装。`ontomato.mjs` 从脚本所在目录读取 `application.yml`。

Ontomato 同时只能使用一个数据源。改指到另一个数据源会替换当前数据源。

## 前置条件

- Ontomato 已经部署。
- 有前端地址，例如 `http://host:3000`。
- Node.js 18 或更新版本。脚本只用 Node 内置模块。

所有请求都经前端转发：`<envUrl>/api/data-query/<后端路径>`。

## 配置 application.yml

```yaml
# Frontend URL of Ontomato, with no path suffix
envUrl: http://host:3000
```

## 工作流

1. 填写 `application.yml`。
2. `node ontomato.mjs list-datasources`，看本部署支持哪些数据库类型、每种要哪些连接字段。
3. `node ontomato.mjs use-datasource <type> @payload.json`
4. 用你自己的数据库工具查看业务库的表和数据。本技能不查询该库。
5. 按该结构编写 ontomap。
6. `node ontomato.mjs set-ontomap @ontomap.json`
7. `node ontomato.mjs get-ontomap`，与所写文件核对。
8. 用几个能覆盖主要表和关系的简单问题执行 `node ontomato.mjs ask "..."`。答不出或答错时，回头补 `desc` 和关系，再重新 set。

## 命令

在本目录执行 `node ontomato.mjs <command>`，或传入脚本路径。JSON 可以是参数，也可以是 `@文件`。

```
node ontomato.mjs list-datasources
node ontomato.mjs use-datasource <type> '<json>'
node ontomato.mjs use-datasource <type> @payload.json
node ontomato.mjs get-ontomap
node ontomato.mjs set-ontomap '<json>'
node ontomato.mjs set-ontomap @ontomap.json
node ontomato.mjs ask "How many people are there?"
node ontomato.mjs ask --lang zh "共有多少人？"
```

`type` 取 `list-datasources` 列出的类型之一。

`ask` 会发送 `Accept-Language`。默认是 `en`。要中文回答时传入 `--lang zh`。

响应体为 `{success, message, data}` 且 `success: false` 时，脚本打印 `message` 并以非零状态退出。HTTP 非 2xx 时打印状态码和响应体，并以非零状态退出。

## 连接数据源

1. `node ontomato.mjs list-datasources` — `GET /api/data-query/businessConfig/dataAdapters`。打印本部署实际安装的数据适配器。每项有 `type`、`label`、`sql`、`fields`（该类型需要的连接字段）和 `examples`（每个字段的示例值）。
2. `node ontomato.mjs use-datasource <type> '{"url":"jdbc:postgresql://db.example:5432/my_database?currentSchema=public","user":"app","password":"change-me"}'` — `POST /api/data-query/businessConfig/useDataAdapter`。脚本把 `type` 合并进 JSON 后提交。按该类型 `fields` 列出的字段提交，一般是 `url`、`user`、`password`。

实际可用的类型取决于部署安装了哪些适配器，以 `list-datasources` 为准。

## 各数据库连接要点

JDBC URL 不要带 `serverTimezone=Asia/Shanghai` 这类地区化参数。

| 类型 | 要点 |
| --- | --- |
| mysql | 可带 `useUnicode=true&characterEncoding=utf8&useSSL=false` 这类参数，例如 `jdbc:mysql://db.example:3306/my_database?useUnicode=true&characterEncoding=utf8&useSSL=false`。 |
| postgresql | 用 `currentSchema` 在 URL 里指定 schema，例如 `jdbc:postgresql://db.example:5432/my_database?currentSchema=public`。 |
| oracle | thin 写法，例如 `jdbc:oracle:thin:@db.example:1521:orcl`。 |
| sqlserver | 用 `databaseName` 在 URL 里选库，例如 `jdbc:sqlserver://db.example:1433;databaseName=my_database`。 |
| db2 | 例如 `jdbc:db2://db.example:50000/my_database`。 |
| gaussdb | 协议头是 `jdbc:opengauss://`，例如 `jdbc:opengauss://db.example:5432/my_database`。 |
| duckdb | 地址是后端能访问到的文件路径，例如 `jdbc:duckdb:/data/warehouse.duckdb`；只要 `url`。 |

## ontomap

`get-ontomap` 为 `GET /api/data-query/admin/getSchema`。`set-ontomap` 为 `POST /api/data-query/admin/setSchema`。请求体就是 ontomap 对象本身。

`set-ontomap` 整份替换该域的 ontomap，不与原来的合并。

| 字段 | 怎么写 |
| --- | --- |
| `datasetDesc` | 整个数据集的业务说明。它会写入 abcHarness 编程提示词和问题拆分提示词。用模型应使用的语言写清业务含义、单位和枚举取值。 |
| `classList` | 类名列表。星图画法用第一个名字作为根类。 |
| 类的 `name` | SQL 表名。适配器把它原样、不加引号地拼进 `from` 和 `join`，不补 schema 前缀，也不改大小写。ontomap 内部按完整字符串匹配类名；只有保存的名字本身没有 `/` 时，才接受多写一个前导 `/`。写成数据库在这段不加引号的 SQL 里能解析到的标识符。schema 写在 JDBC URL 里，例如 PostgreSQL 的 `currentSchema`。 |
| 类的 `showName` | 显示名。问题拆分的子图用它替换类名来显示。它不是 SQL 表名，也不是提示词里的类描述。 |
| 类的 `desc` | 提示词里的类描述。编程器的类列表和 `getSchemaByClassName` 都会给出它。用业务语言写清含义、单位和枚举取值。 |
| `inStarChart` | `true` 才把该类画进星图。一条关系只有两端的类都是 `true` 才保留。建议填 `true`。 |
| 属性的 `name` | SQL 列名。适配器把它原样、不加引号地拼进去（`alias.column`）。匹配规则与类名相同。 |
| 属性的 `showName` | 随 ontomap 保存，`get-ontomap` 会返回。schema 文本和 SQL 用的是 `name` 和 `desc`。 |
| 属性的 `desc` | 模型读到的字段说明。`getSchemaByClassName` 和问题拆分的 schema 把它放在 “field description” 列。用业务语言写清含义、单位和枚举取值。 |
| `type` | 只能是 `varchar`、`text`、`int`、`long`、`double`、`date`、`timestamp` 之一。适配器按这个值选择 SQL 类型和比较写法。 |
| `bizzKey` | 在 DSL 提问路径上，查询漏选该列时，`true` 会把该列补进结果。`ask` 生成的 SQL 不读这个标志。需要那条路径保留的列写 `true`，其余写 `false`。 |
| `enable` | `true` 才把该列放进 schema 文本和 SQL。`false` 会去掉它。缺省按启用处理。写 `true`。 |
| `primaryKey` | 每个类恰好一个 `true`。schema 文本会标出它，插入和按对象查找把它当作 id 列。 |
| 关系的 key | 关系类型名。join 用这个 key 查找关系，提示词表格里把它称为 relationship type。 |
| `fromClass`、`toClass` | 两端的类 `name`。 |
| `fromField` | `fromClass` 上的列 `name`。 |
| `toField` | `toClass` 上的列 `name`。join 条件是 `fromClass.fromField = toClass.toField`。 |
| 关系的 `desc` | 提示词关系表里的关系说明。写清业务含义。 |

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

## 自然语言提问

`ask` 向 `/api/data-query/abcHarness` 提交 `{question}`。响应是 `text/event-stream`。脚本按流到达的顺序打印每个事件：

- 开头的 `{sessionId, nodeId}` 帧打印为 `session <id>`
- `MESSAGE_TYPE` 的文本
- `DATA_TYPE` 打印问题，再打印数据 JSON
- `error` 帧打到 stderr，然后以非零状态退出

心跳注释不打印。

`ask` 常常要几分钟。调用时把命令超时放长，盖住整次运行。
