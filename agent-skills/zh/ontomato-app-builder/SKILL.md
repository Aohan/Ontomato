---
name: ontomato-app-builder
description: 基于 Ontomato 构建数据应用：把生产环境的 ontomap（语义层定义）导入测试环境，参照生产数据和业务知识造测试数据，在测试环境生成并调试 MetricView（查询接口）与 Action（写操作接口），再基于这些接口开发页面应用。在搭建测试环境、准备测试数据、编写或调试 MetricView / Action、开发调用它们的页面时使用。
---

# Ontomato 应用构建

基于 Ontomato 开发数据应用：页面上的查询都调用 MetricView，写操作都调用 Action；你先在测试环境把这些接口做出来、测通，再写页面。本目录可单独拷走安装。`ontomato.mjs` 从脚本所在目录读取 `application.yml`。

## 两套环境

- **测试环境**：`envUrl` 指向的 Ontomato 部署。本技能在这里导入定义和测试数据、生成和调试 MetricView / Action，页面也调用这里的接口。
- **生产环境**：另一套 Ontomato，只读。测试环境的后端通过环境变量 `BACKEND_PRODUCTION_ENV_URL`（生产环境**后端**地址，如 `http://prod-host:18087`）访问生产环境；生产环境也是开源版时不需要登录，`BACKEND_PRODUCTION_ENV_USER`、`BACKEND_PRODUCTION_ENV_PASSWORD` 留空。本技能的 `import-schema` 和 `prod-*` 命令都经测试环境后端转到生产环境，脚本本身不直连生产环境。生产环境需与测试环境同版本。

**`import-schema` 会清空测试环境当前域的数据**：删除并重建当前域的命名空间和全部类，用生产环境的类与关系定义整份替换当前域的 ontomap。只对专用的测试部署执行，不要指向有业务数据的部署。

## 前置条件

- 测试环境已部署，后端已配置 `BACKEND_PRODUCTION_ENV_URL` 并重启。
- 已知测试环境前端地址，例如 `http://host:3000`。
- Node.js 18 或更高版本。脚本只用 Node 内置模块。

脚本的所有请求都经测试环境前端转发：`<envUrl>/api/data-query/<后端路径>`。

## 配置 application.yml

```yaml
# Frontend URL of Ontomato, with no path suffix
envUrl: http://host:3000
```

## 命令

在本目录执行 `node ontomato.mjs [--lang <语言>] <命令>`，或传入脚本路径。JSON 可以是参数，也可以是 `@文件`。`--lang` 放在 `Accept-Language` 请求头里，决定生成内容和报错的语言，默认 `en`，中文用 `--lang zh`。

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <类名> [<类名> ...]
node ontomato.mjs relationships <类名> [<类名> ...]
node ontomato.mjs import-schema
node ontomato.mjs prod-distinct-values <类名> <属性名> [--like <模式>] [--limit <条数>]
node ontomato.mjs prod-query @query.json
node ontomato.mjs prod-knowledge [--max <条数>] <问题>
node ontomato.mjs import-test-data testData.json
node ontomato.mjs distinct-values <类名> <属性名> [--like <模式>] [--limit <条数>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs --lang zh metric-view generate [--save] <接口描述>
node ontomato.mjs --lang zh metric-view execute <id> [<参数 JSON|@文件>]
node ontomato.mjs metric-view find <类名> [<问题>]
node ontomato.mjs metric-view get <id>
node ontomato.mjs --lang zh metric-view save @metricView.json
node ontomato.mjs metric-view delete <id>
node ontomato.mjs --lang zh action generate|execute|find|get|save|delete ...
node ontomato.mjs --lang zh ask "上个月一共有多少订单？"
```

| 命令 | 后端接口 | 作用环境 | 返回 |
| --- | --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | 测试 | 整个数据集的业务描述 |
| `classes` | `GET /admin/getAllClassNames` | 测试 | 对象类名列表 |
| `schema` | `POST /admin/getSchemaByClassName` | 测试 | 每个类的描述，以及每个启用属性的名称、类型、是否主键和描述 |
| `relationships` | `POST /admin/getRelationshipByClassNames` | 测试 | 以这些类为起点或终点的关系：源类、关系类型、目标类、描述 |
| `import-schema` | `GET /testEnv/importSchema` | 生产 → 测试 | 用生产环境的类与关系定义重建测试环境当前域（见上方警告） |
| `prod-distinct-values` | `POST /productionEnv/queryDistinctAttrValue` | 生产 | `varchar` 或 `text` 属性去重后的取值 |
| `prod-query` | `POST /productionEnv/queryData` | 生产 | DSL 执行结果 JSON |
| `prod-knowledge` | `POST /productionEnv/queryBusinessKnowledge` | 生产 | 与问题语义相关的业务知识 |
| `import-test-data` | `POST /testEnv/importData` | 测试 | 上传测试数据文件并写入 |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | 测试 | 同 `prod-distinct-values` |
| `execute-dsl` | `POST /dsl/executeV1` | 测试 | DSL 执行结果 JSON |
| `metric-view ...` / `action ...` | `/metricView/*`、`/action/*` | 测试 | 见下文 |
| `ask` | `POST /abcHarness` | 测试 | 流式事件，最后是数据 |

- `import-schema` 之后，`dataset-desc`、`classes`、`schema`、`relationships` 读到的就是生产环境的定义。
- `distinct-values` / `prod-distinct-values`：`--like` 过滤取值，不带 `%` 时按 `%模式%` 匹配；不传 `--limit` 时最多显示 100 条。写 `=` 或 `in` 条件前，先用它确认库里实际存的值。
- 非 2xx 响应会打印状态码和响应体并以非零退出；JSON 响应 `success: false` 时打印 message 并以非零退出。

## 工作流

1. `import-schema`，把生产环境的定义导入测试环境。
2. `dataset-desc`、`classes`、`schema`、`relationships` 了解数据集；`prod-knowledge` 查与应用相关的业务知识；`prod-distinct-values` 和 `prod-query`（加 `limit`，避免返回过多）看生产环境的真实数据长什么样。
3. 按下面的格式写测试数据文件，`import-test-data` 导入；用 `distinct-values`、`execute-dsl` 检查导入结果。
4. 用 `metric-view generate` / `action generate` 以自然语言生成页面需要的接口，`execute` 调试；看懂结构后直接改 `get` 拿到的定义再 `save`，通常比反复自然语言生成快。
5. 做一轮完整测试前重新 `import-test-data`，免得上一轮 Action 改过的数据干扰检查。
6. 基于测过的 MetricView / Action 开发页面，页面调用方式见[页面调用接口](#页面调用接口)。

## 测试数据

测试数据应多样、典型，能覆盖应用要测的各种情况，但数量不宜多。文件格式：

```json
{
  "objDatas": [
    {
      "className": "/namespace/class1",
      "rows": [
        {"id": "c1", "attr1": "华东", "attr2": 3.5}
      ]
    }
  ],
  "relDatas": [
    {"relationName": "关系类型", "sourceObjId": "源对象主键值", "targetObjId": "目标对象主键值"}
  ]
}
```

后端导入前逐项校验，任何一处不符就整体拒绝并说明原因：

- `className` 必须是测试环境已有的类，写法与 `classes` 返回的一致。
- 每行只能包含该类**启用**的属性（`schema` 列出的那些）。
- 每行必须有非空的主键值。主键是 `schema` 里标为主键的属性；类没有主键属性时，`import-schema` 会把第一个启用属性设为主键。
- 主键值在整个文件内不能重复，跨类也不行。
- `relationName` 必须是已有的关系类型；`sourceObjId` 必须是该关系源类在本文件中的某行主键值，`targetObjId` 是目标类在本文件中的某行主键值。

导入时，文件里出现的每个类先清空原有对象再写入；没出现的类不动。

## MetricView 与 Action

MetricView 是只读的查询接口，Action 是写操作接口，两者的命令和结构相同，下面以 MetricView 为例（`action` 换掉 `metric-view` 即可）。

- `generate [--save] <接口描述>`：用自然语言描述要一个什么逻辑的接口，打印生成的定义；带 `--save` 时生成成功后直接保存。
- `execute <id> [<参数>]`：调用接口。参数是一个 JSON 对象，键是定义中 `function.parameters[].name`；没有参数的接口可以省略。MetricView 返回数据行；Action 返回执行结果（`result`、`spendTime`），执行出错时以非零退出并打印原因。
- `find <类名> [<问题>]`：查与某个类相关的已发布接口；带问题时按语义取最相关的 10 个。返回每个接口的 `id`、`name`、`logic`、`parameters`、`returnDef`。
- `get <id>`：取完整定义。
- `save <定义>`：保存定义，请求体就是 `get` 打印的 JSON；带 `id` 时更新该接口（`id` 须已存在），不带时新建。系统内置的接口不能改。
- `delete <id>`：删除。

定义的核心是 `function`：`logic` 用自然语言写接口做什么，`parameters` 是入参（`name`、`type`、`description`、`sample`），`code` 是实际执行的程序，`returnDef` 描述返回结构。

## 页面调用接口

页面经测试环境前端调用接口，与脚本走同一路径：

```
POST <envUrl>/api/data-query/metricView/execute
POST <envUrl>/api/data-query/action/execute
Content-Type: application/json
Accept-Language: zh

{"id": "<MetricView 或 Action 的 id>", "param": {"param1": "xxx", "param2": 12.3}}
```

响应是 `{"success": true, "data": ...}`，失败时 `{"success": false, "message": "..."}`。

## 自然语言问数

`ask` 把问题交给 Ontomato，由它自己规划并执行查询，适合临时看数，不适合作为页面接口。它常常要几分钟，把命令超时设得足够覆盖整次运行。

## DSL 规则

`prod-query` 与 `execute-dsl` 使用同一套 DSL，分别在生产环境和测试环境执行。

类名和属性名按 `classes`、`schema` 返回的原样使用；`schema` 和 `distinct-values` 需要精确名称。DSL 里的类名也接受带前导 `/`。关系的 `type` 取 `relationships` 返回的关系类型，`from` / `to` 分别指向源类和目标类。

```text
1. 每个问题用一个 JSON 对象表示，包含两个属性：problem（问题文本）和 answer（查询计划）。

2. problem属性的值是提问的问题

3. answer 是包含 steps 数组的对象。按顺序执行这些步骤；只有一步查询时，steps 仍然是只含一个步骤对象的数组。

4. 每个单步查询，由graph 和 output 对象组成，graph描述查询规则，output描述查询的输出结果。

5. graph查询规则，包括patterns的list结构和pattern_logic

	5.1 patterns的list结构描述查询条件，pattern_logic表示多个patterns间的and或者or的逻辑关系

	5.2 patterns是一个list结构，描述多个查询条件，每个查询条件由objects、relationship组成。

		5.2.1 objects是list结构，表示类对象的查询条件，每个类的查询条件是一个object的json结构，由idx、variable、class、conditions组成

		5.2.2 idx是objects list内的顺序id，每个类的查询条件顺序id不可重复

		5.2.3 variable是存储这个类查询结果的变量名

		5.2.4 class是指从哪个类中查询符合条件的对象

		5.2.5 conditions表示查询条件，由properties组成。如果没有条件conditions可省略，有properties时conditions不可省略。

			5.2.5.1 properties表示类属性的查询条件，可以由多个属性条件或单个属性条件组成。当是单属性条件时，由field、operator、value组成，field表示属性名，operator表示逻辑运算符，包括“=”、“!=”、“>”、“>=”、“<”、“<=”、“between”、“like”、“in”、“is”、“is not”，value表示逻辑运算的值，当operator是between时value是一个二元数组，当operator是in时value是一个多元数组，当operator是is或is not时value是null。当由多个属性组成时，由 "operator": "logic"字段表示，且 多个属性由 "and"/"or"/"not" 字段的list结构表示，list结构内就是多个单属性条件。

		5.2.6  relationship表示objects之间必须满足某种关系，是个list结构，`relationships` 没有返回的关系不允许使用，list中每个元素描述了

		- 两个object之间的关系要求，每个关系要求由from、to、type、min_hops、max_hops组成
		- from必须是`relationships` 返回的关系起点的类的idx值，to必须是`relationships` 返回的关系终点的类的idx值
		- type是个list结构，指两类对象间的关系名称列表，["*"]通配符表示所有关系
		- min_hops表示至少存在几跳关系，目前只能设为1
		- max_hops表示最大查询几跳关系，-1表示不限制
		- relationship的list是空时，relationship这项可以省略。

	5.3 pattern_logic表示patterns的list元素内每个条件间的逻辑关系，可以设为 and或者or

6. output输出结果描述，由to_user、fields、save_table、sort、limit、group_by组成

	6.1 to_user的值，true表示这个step的查询结果直接输出给用户，false表示存到临时表作为下一个step的参数

	6.2 save_table表示存储的临时表名，要以`/`开头，第二个字符为字母，后面字符没有要求，长度不超过64个字符. 当to_user为false时起作用，to_user为true时，不需要这项，

	在DSL中，临时表只能作为同一个DSL对象单次执行中的中间结果引用。产生临时表的step和引用该临时表的step必须放在同一个DSL对象的steps中，并通过一次 `execute-dsl` 或 `prod-query` 调用整体执行。严禁先用一次调用“保存”临时表，再在另一个DSL或另一次调用中引用它。

	6.3 fields表示输出的字段列表，list结构，每个字段由variable、field或expr二选一、as、function（不是必须）、distinct（不是必须）组成， variable表示取objects中哪个对象的variable，field表示取variable对象中的哪个属性，as表示输出转为的别名，distinct值为true表示对字段去重(**而且distinct只能作用在临时表的output中**)
   
		6.3.1 如果字段不需要分组汇聚操作时，可直接输出

		6.3.2 如果字段需要分组汇聚操作时，需要按如下逻辑定义汇聚操作
   
		- 当有function字段时说明需要对这个属性字段进行聚合计算，聚合计算支持avg取平均,count计数,min取最小,max取最大,sum求加和，其聚合整个结果集

		- 当有function聚合计算时,需要和查询分不同的step，也就是要求function聚合计算只能作用于临时表的字段

		6.3.3 **多个数字类型字段做四则运算，只能出现在临时表的output中，不能出现在第一个step中**如果需要多个数字类型字段做四则运算时，只由expr和as属性组成，expr表示四则运算的数学表达式，as表示输出转为的别名

	6.4 sort表示输出排序，由fields的list结构组成，每个field由variable，field和order组成，即使只有一个field也不能省略fields的list结构.variable表示参与排序的类查询对象结果，field表示类查询对象结果的属性字段，order表示升降序，asc表示升序，desc表示降序.当sort中的field是计算结果，不属于类的属性时，variable可以省略

	6.5 limit表示从什么位置开始，最多取多少条数据，由offset和count组成，offset表示从什么位置开始，count表示最多取多少条数据.

	6.6 group_by表示分组统计，由fields和having组成.

    - fields是list结构，每个field由variable，field组成，variable表示被分组的对象变量，field表示类查询对象结果的属性字段
    - having是个list结构，表示对group_by后的筛选操作，list中每个筛选条件由variable、field、function、distinct（非必需）、operator和value，variable表示参与筛选的类查询对象结果，field表示类查询对象结果的属性字段，function表示对类查询对象结果的属性字段的计算，只能用avg取平均,count计数,min取最小,max取最大,sum求加和，***禁止使用其它聚合函数***。distinct表示是否对field属性做去重操作，它的值对应true/false。聚合函数作用于分组后数据，operator表示逻辑运算符，包括“=”、“!=”、“>”、“>=”、“<”、“<=”,value表示逻辑运算的值

	6.7 group_by,sort,limit可以在同一个step内实现.
```

### 示例

```json
{
  "problem": "统计华东地区客户各等级的订单数和订单金额，只保留客户数超过 5 个的等级",
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
                        {"field": "region", "operator": "=", "value": "华东"},
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

### 结果

`execute-dsl` 和 `prod-query` 打印响应。`data[0].answer` 是 `to_user: true` 那一步的数据行，`data[0].mqls` 是实际执行的语句。查询失败时，`error` 说明原因，脚本以非零退出。
