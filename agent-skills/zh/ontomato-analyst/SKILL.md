---
name: ontomato-analyst
description: 通过 Ontomato 查询和分析业务数据。在读取 ontomap（语义层定义）的数据集描述、对象类、属性和关系，探查属性取值，执行 DSL 查询，用自然语言问数，或调用 Ontomato 分析智能体做深度分析时使用。
---

# Ontomato 数据分析

基于 Ontomato 的 ontomap（语义层定义）查询和分析数据。本目录可单独拷走安装。`ontomato.mjs` 从脚本所在目录读取 `application.yml`。

取数有三种方式，自主程度从高到低：

- **DSL**：读 ontomap，写 DSL 查询，用 `execute-dsl` 执行，返回数据行。
- **自然语言**：`ask` 把问题交给 Ontomato，由它自己规划并执行查询。
- **分析智能体**：一个 MCP 服务，做多维度分析并产出报告。在你的 MCP 客户端里配置它；本 skill 不调用它。

## 前置条件

- Ontomato 已部署，并已导入 ontomap。
- 已知前端地址，例如 `http://host:3000`。
- Node.js 18 或更高版本。脚本只用 Node 内置模块。

脚本的所有请求都经前端转发：`<envUrl>/api/data-query/<后端路径>`。

## 配置 application.yml

```yaml
# Frontend URL of Ontomato, with no path suffix
envUrl: http://host:3000
```

## 命令

在本目录执行 `node ontomato.mjs <命令>`，或传入脚本路径。JSON 可以是参数，也可以是 `@文件`。

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <类名> [<类名> ...]
node ontomato.mjs relationships <类名> [<类名> ...]
node ontomato.mjs distinct-values <类名> <属性名> [--like <模式>] [--limit <条数>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs ask --lang zh "上个月一共有多少订单？"
```

| 命令 | 后端接口 | 返回 |
| --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | 整个数据集的业务描述 |
| `classes` | `GET /admin/getAllClassNames` | 对象类名列表 |
| `schema` | `POST /admin/getSchemaByClassName` | 每个类的描述，以及每个启用属性的名称、类型、是否主键和描述 |
| `relationships` | `POST /admin/getRelationshipByClassNames` | 以这些类为起点或终点的关系：源类、关系类型、目标类、描述 |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | `varchar` 或 `text` 属性去重后的取值 |
| `execute-dsl` | `POST /dsl/executeV1` | DSL 执行结果 JSON |
| `ask` | `POST /abcHarness` | 流式事件，最后是数据 |

`distinct-values`：`--like` 过滤取值，不带 `%` 时按 `%模式%` 匹配；不传 `--limit` 时最多显示 100 条。写 `=` 或 `in` 条件前，先用它确认库里实际存的值。

非 2xx 响应会打印状态码和响应体并以非零退出；JSON 响应 `success: false` 时打印 message 并以非零退出。

## 查询流程

1. `dataset-desc` 和 `classes`，了解数据集覆盖哪些内容。
2. 对问题涉及的类执行 `schema`，用 `relationships` 看它们怎么关联。
3. 用 `distinct-values` 确认过滤值。
4. 按下面的规则写 DSL，执行 `execute-dsl`。
5. 结果为空或不对时，检查类名和属性名、过滤值、关系方向，再重新执行。

不想自己规划的问题，用 `ask`。它常常要几分钟，把命令超时设得足够覆盖整次运行。

## DSL 规则

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

	在DSL中，临时表只能作为同一个DSL对象单次执行中的中间结果引用。产生临时表的step和引用该临时表的step必须放在同一个DSL对象的steps中，并通过一次 `execute-dsl` 调用整体执行。严禁先用一次 `execute-dsl` 调用“保存”临时表，再在另一个DSL或另一次 `execute-dsl` 调用中引用它。

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

`execute-dsl` 打印响应。`data[0].answer` 是 `to_user: true` 那一步的数据行，`data[0].mqls` 是实际执行的语句。查询失败时，`error` 说明原因，脚本以非零退出。

## 分析智能体（MCP）

Ontomato 以 MCP 服务的形式提供分析智能体：

- 地址：`<envUrl>/mcp/analysis-agents`
- 传输方式：Streamable HTTP
- 认证：不需要

把这个服务加进你的 Agent 的 MCP 配置。它的工具：

| 工具 | 用途 |
| --- | --- |
| `list_analysis_agents` | 列出已启用的分析智能体 |
| `run_analysis` | 用 `agentId` 和 `question` 发起分析，返回任务 |
| `get_analysis_task` | 按 `taskId` 轮询任务状态和报告 |
| `get_analysis_report_pdf` | 按 `taskId` 取最新一次运行报告的 PDF 下载链接 |

报告 PDF 不在工具结果里返回。`get_analysis_report_pdf` 给出 `downloadUrl`，下载不带认证头：

```bash
curl -o report.pdf "<downloadUrl>"
```

只有报告任务、且已有报告正文时才能下载；常规会话任务没有报告。
