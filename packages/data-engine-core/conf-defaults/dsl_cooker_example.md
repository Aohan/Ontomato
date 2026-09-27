以下示例仅演示查询规划和 DSL 写法，类名、字段、关系与取值均为示意。实际查询必须以本次输入的数据集定义和业务知识为准，不得将示例中的定义或业务条件套用到其他数据集。
> 示例中的分析过程对应正文简述；JSON 代码块写入工作区 DSL 文件后通过 `submitDsl` 提交，不在正文重复输出。

## 业务知识（仅示例中使用）

1. 查询专任教师时默认条件为： 编制类别='事业编' 且 人员分类='专任教师岗位'。
2. 师资归属单位必须使用`sz_g`字段，并且排除 `sz_g` 为空的记录。
3. `/univ_demo/mgn_duty` 筛选当前行政职务必须增加筛选条件 `last_flag = "是"` 。
4. `/univ_demo/tech_duty` 筛选现任最高专业技术职务必须增加筛选条件 `last_flag = "是"`。
5. 提取指定主题的摄影作品（vector）时，需要使用向量检索，即`query`字段。
6. 提取论文时**禁止**使用向量检索，请使用`keywords like xxx`筛选指定主题论文。

## 示例 1：星状图 —— 多关系围绕同一教职工

### 1. 问题、ABC 步骤与图结构说明

**问题描述**

> 问题：统计当前在职的获得过人才工程荣誉奖励的人员、并按`专业技术职务级别`统计人数。

> 这里“专业技术职务级别”对应 `/univ_demo/tech_duty` 表中的字段 `duty_level`。

**A_Step：path 表**

| 起始对象                | 关系                    | 目标对象                   |
| ------------------- | --------------------- | ---------------------- |
| `/univ_demo/person` | `person_to_szxxsb`    | `/univ_demo/szxxsb`    |
| `/univ_demo/person` | `person_to_tech_duty` | `/univ_demo/tech_duty` |

> 解释：
>
> * 星状中心是 `/univ_demo/person`；
> * 分别通过工号等关系边连接到人才工程荣誉记录 `/univ_demo/szxxsb` 和专业技术职务记录 `/univ_demo/tech_duty`。

**B_Step：nodes 表**

| 对象类                    | 筛选条件                       | 提取字段         | 条件来源       | 提取原因                               |
| ---------------------- | -------------------------- | ------------ | ---------- | ---------------------------------- |
| `/univ_demo/person`    | `status` = '在职' | `account`    | 业务知识 | 用工号识别教职工并做去重计数                     |
| `/univ_demo/szxxsb`    | 无特定条件（只需存在关联记录）            | —            | 问题要求      | 用于判断是否“获得过人才工程荣誉奖励”                |
| `/univ_demo/tech_duty` | `last_flag = "是"`          | `duty_level` | 业务知识 + 问题 | 只统计“现任最高专业技术职务”，并按 `duty_level` 分组 |

* **C_Step**：在“满足在职范围的教职工 + 至少一条人才工程荣誉记录 + 现任最高专业技术职务记录”的明细表上，将 `duty_level` 作为分组字段进行`group_by`，对教职工工号 `account` 做 `count distinct` 去重计数，得到“按专业技术职务级别统计的教职工人数”。

### 2. 文件交付内容示例（分析过程只在正文简述）

1. 分析与架构规划
*   **读取 ABC**：A 步骤定义了以 `person` 为中心，连接 `szxxsb` 和 `tech_duty` 的星状图。B 步骤有筛选条件。C 步骤明确要求按 `duty_level` **分组(group_by)** 并对 `account` **去重计数(count distinct)**。
*   **逻辑推导与 DSL 规划**：
    *   Step 数量判定：检测到 C 步骤包含 **聚合(count)** 和 **分组(group_by)**，根据 DSL 规则，**必须规划为 2 Steps**。
    *   临时表字段预埋：为了在 Step 2 实现 C 步骤的逻辑，Step 1 必须先把“分组键” `duty_level` 和“计算键” `account` 作为普通字段输出到临时表。

2. 执行结构化翻译
*   **Step 1 (数据提取层)**：
    *   Graph：将 A 步骤的两条路径翻译为 `relationship`。
    *   Conditions：严格按照 B 步骤，在 `person` 对象上添加 `status = '在职'`，在 `tech_duty` 对象上添加 `last_flag = "是"`。
    *   Output：根据规划，将 `person.account` 和 `tech_duty.duty_level` 输出到临时表。
*   **Step 2 (计算表达层)**：
    *   Input：引用 Step 1 的临时表。
    *   Output：响应 C 步骤，将 `duty_level` 填入 `group_by`；在 `fields` 中对 `account` 字段添加 `function: "count"` 和 `distinct: true`。

3. 自检
*   拒绝幻觉**：确认 `person`, `tech_duty`, `szxxsb` 等类和 `status`, `last_flag` 等字段均在数据集中存在。
*   指令遵循**：DSL 完整覆盖了 ABC 的路径、筛选、分组和聚合要求，没有遗漏。
*   语法逻辑：
    *   Group By 检查：Step 2 的 output 中同时存在普通字段 `tech_duty_level` 和聚合字段 `person_account (count distinct)`，`group_by` 已正确配置。
    *   Step 隔离：聚合操作 `function` 被正确地隔离在 Step 2 中。

```json
{
    "problem": "统计当前获得过人才工程荣誉奖励的人员、并按`专业技术职务级别`统计人数。",
    "answer": {
      "steps": [
        {
          "graph": {
            "patterns": [
              {
                "objects": [
                  {
                    "idx": 0,
                    "variable": "person",
                    "class": "/univ_demo/person",
                    "conditions": {
                      "properties": {
                        "operator": "logic",
                        "and": [{"field": "status", "operator": "=", "value": "在职"}]
                      }
                    }
                  },
                  {"idx": 1, "variable": "honor", "class": "/univ_demo/szxxsb"},
                  {
                    "idx": 2,
                    "variable": "tech_duty",
                    "class": "/univ_demo/tech_duty",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "last_flag", "operator": "=", "value": "是"}]}
                    }
                  }
                ],
                "relationship": [
                  {"from": 0, "to": 1, "type": ["person_to_szxxsb"], "min_hops": 1, "max_hops": 1},
                  {"from": 0, "to": 2, "type": ["person_to_tech_duty"], "min_hops": 1, "max_hops": 1}
                ]
              }
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": false,
            "save_table": "/temp01_star_example",
            "fields": [
              {"variable": "person", "field": "account", "as": "person_account"},
              {"variable": "tech_duty", "field": "duty_level", "as": "tech_duty_level"}
            ]
          }
        },
        {
          "graph": {
            "patterns": [
              {"objects": [{"class": "/temp01_star_example", "variable": "temp01"}]}
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": true,
            "fields": [
              {"variable": "temp01", "field": "tech_duty_level", "as": "tech_duty_level"},
              {"variable": "temp01", "field": "person_account", "function": "count", "distinct": true, "as": "person_count"}
            ],
            "group_by": {"fields": [{"variable": "temp01", "field": "tech_duty_level"}]}
          }
        }
      ]
    }
}
```

## 示例 2：向量检索 —— 复杂筛选与多维属性提取

### 1. 问题、ABC 步骤与图结构说明

**问题描述**

> 问题：查询拍照过泰国题材的摄影作品的教职工，返回他们的姓名、所属院系、当前行政职务、当前任职学会、任职职务和“泰国题材”的摄影作品。

**A_Step：path 表**

| 起始对象 | 关系 | 目标对象 |
| :--- | :--- | :--- |
| `/univ_demo/person` | `person_to_org` | `/univ_demo/org` |
| `/univ_demo/person` | `person_to_mgn_duty` | `/univ_demo/mgn_duty` |
| `/univ_demo/person` | `person_to_szxxsb_xh` | `/univ_demo/szxxsb_xh` |

> 解释：
>
>   * 中心节点为 `/univ_demo/person`（教职工）；
>   * 分别向外连接院系组织（`org`）、行政职务（`mgn_duty`）和学会任职记录（`szxxsb_xh`）；
>   * 注：`person_to_szxxsb_xh` 为连接教职工与学会任职记录的关系。

**B_Step：nodes 表**

| 对象类 | 筛选条件 | 提取字段 | 条件来源 | 提取原因 |
| :--- | :--- | :--- | :--- | :--- |
| `/univ_demo/person` | `photo_works` 向量匹配 "泰国" | `name`, `photo_works` | 问题（“拍照过泰国题材”） | 需返回姓名及符合题意的作品 |
| `/univ_demo/org` | 无额外条件 | `name` | 问题要求 | 返回“所属院系” |
| `/univ_demo/mgn_duty` | `last_flag = "是"` | `title` | 业务知识 + 问题 | 必须是“当前”行政职务 |
| `/univ_demo/szxxsb_xh` | `pq_jssj` 为空 OR `pq_jssj` > 当前时间（2025-11-30 07:33:17） | `xm_name`, `wcrpm` | 业务逻辑（当前任职） | 定义“当前任职学会”并返回学会名与职务 |

  * **C_Step**：无需聚合计算。在筛选出的连通子图上，直接提取上述字段，按教职工维度平铺展示即可。


### 2. 文件交付内容示例（分析过程只在正文简述）

1. 分析与架构规划
*   **读取 ABC**：A 步骤定义了 `person` 连接多个类的图。B 步骤要求提取多个字段，其中包括 `photo_works` 这个 **vector（向量）** 类型字段。C 步骤为空，是明细查询。
*   **逻辑推导与 DSL 规划**：
    *   Step 数量判定：虽然 C 步骤为空，但 B 步骤要求输出 `vector` 字段。根据 DSL 规则，**向量字段的输出必须使用 2 Steps**（Step 1 提取对象，Step 2 带 `query` 参数获取向量文件）。因此，必须规划为 2 Steps。
    *   临时表字段预埋：Step 1 需要输出所有最终需要的字段，包括 `person.name`, `org.name`, `mgn_duty.title` 以及 `person.photo_works` 等。

2. 执行结构化翻译
*   **Step 1 (数据提取层)**：
    *   Graph & Conditions：将 A 步骤的路径和 B 步骤的筛选条件（包括 `person` 的 `vector` 筛选，`mgn_duty` 的 `last_flag` 筛选，以及 `szxxsb_xh` 的 `OR` 逻辑）一一映射。
    *   Output：将所有需要输出的字段（包括 `photo_works`）原样输出到临时表。
*   **Step 2 (计算表达层)**：
    *   Input：引用 Step 1 的临时表。
    *   Output：
        *   输出所有普通字段。
        *   **Vector 输出**：对 `photo_works` 字段，严格按照 DSL 规则，在输出时附加 `query: "泰国"` 参数，以确保返回的是与主题匹配的摄影作品。

3. 自检
*   拒绝幻觉**：确认所有类、关系、字段都存在。
*   指令遵循：ABC 中的所有筛选条件，包括 `vector` 筛选和 `OR` 逻辑，都已在 DSL 中体现。
*   语法逻辑：
    *   **Vector 规则检查**：确认遵循了向量输出的 2 Steps 规则，并且 Step 2 的 `photo_works` 字段带有 `query` 参数。
    *   **Step 隔离**：职责清晰，Step 1 负责图查询，Step 2 负责格式化和向量文件获取。

```json
{
    "problem": "查询拍照过泰国题材的摄影作品的教职工，返回他们的姓名、所属院系、当前行政职务、当前任职学会、任职职务和“泰国题材”的摄影作品",
    "answer": {
      "steps": [
        {
          "graph": {
            "patterns": [
              {
                "objects": [
                  {
                    "idx": 0,
                    "variable": "person",
                    "class": "/univ_demo/person",
                    "conditions": {
                      "vector": {
                        "properties": {"operator": "logic", "and": [{"field": "photo_works", "query": "泰国"}]}
                      }
                    }
                  },
                  {"idx": 1, "variable": "org", "class": "/univ_demo/org"},
                  {
                    "idx": 2,
                    "variable": "mgn_duty",
                    "class": "/univ_demo/mgn_duty",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "last_flag", "operator": "=", "value": "是"}]}
                    }
                  },
                  {
                    "idx": 3,
                    "variable": "society",
                    "class": "/univ_demo/szxxsb_xh",
                    "conditions": {
                      "properties": {
                        "operator": "logic",
                        "or": [{"field": "pq_jssj", "operator": "is", "value": null}, {"field": "pq_jssj", "operator": ">", "value": "2025-11-30 07:33:17"}]
                      }
                    }
                  }
                ],
                "relationship": [
                  {"from": 0, "to": 1, "type": ["person_to_org"], "min_hops": 1, "max_hops": 1},
                  {"from": 0, "to": 2, "type": ["person_to_mgn_duty"], "min_hops": 1, "max_hops": 1},
                  {"from": 0, "to": 3, "type": ["person_to_szxxsb_xh"], "min_hops": 1, "max_hops": 1}
                ]
              }
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": false,
            "save_table": "/temp01_photo_thailand",
            "fields": [
              {"variable": "person", "field": "name", "as": "person_name"},
              {"variable": "person", "field": "photo_works", "as": "photo_works"},
              {"variable": "org", "field": "name", "as": "dept_name"},
              {"variable": "mgn_duty", "field": "title", "as": "admin_title"},
              {"variable": "society", "field": "xm_name", "as": "society_name"},
              {"variable": "society", "field": "wcrpm", "as": "society_position"}
            ]
          }
        },
        {
          "graph": {
            "patterns": [
              {"objects": [{"idx": 0, "class": "/temp01_photo_thailand", "variable": "temp01"}]}
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": true,
            "fields": [
              {"variable": "temp01", "field": "person_name", "as": "姓名"},
              {"variable": "temp01", "field": "dept_name", "as": "所属院系"},
              {"variable": "temp01", "field": "admin_title", "as": "当前行政职务"},
              {"variable": "temp01", "field": "society_name", "as": "当前任职学会"},
              {"variable": "temp01", "field": "society_position", "as": "任职职务"},
              {"variable": "temp01", "field": "photo_works", "query": "泰国", "as": "摄影作品"}
            ]
          }
        }
      ]
    }
}
```


## 示例 3：树状图 -- 多跳路径与文本筛选

### 1. 问题、ABC 步骤与图结构说明

**问题描述**

> 问题：查询计算机学院中，2020年以来入职的、获得过“国家级或省部级青年人才计划”荣誉的、不满45岁的教职工，他们指导的研究生，在A类或B类的期刊或会议上发表的“人工智能”相关的论文的详细信息

**A_Step：path 表**

| 路径ID | 起始对象 | 关系 | 目标对象 |
| ---- | ---- | ---- | ---- |
| P1 | /univ_demo/person | 教职工人事所属组织机构关系 | /univ_demo/org |
| P2 | /univ_demo/person | 教职工人才工程荣誉奖励业绩成果记录 | /univ_demo/szxxsb |
| P3 | /univ_demo/person | 教职工指导研究生 | /univ_demo/student_master |
| P4 | /univ_demo/student_master | 拥有论文 | /univ_demo/paper |

**B_Step：nodes 表**

| 对象类 | 筛选条件 | 提取字段 | 条件来源 | 提取原因 |
| ---- | ---- | ---- | ---- | ---- |
| /univ_demo/person | lx_date >= '2020-01-01 00:00:00' AND age < 45 AND staff_type = '专任教师岗位' AND person_sort = '事业编' | name, account, sz_g | 原问题中：“2020年以来入职的”、“不满45岁的”、“专任教师” | 问题要求返回教职工姓名、工号和所属单位 |
| /univ_demo/org | name = '计算机学院' | name | 原问题中：“计算机学院中” | 问题要求返回所属院系名称 |
| /univ_demo/szxxsb | gccrc IN ('国家级人才A类', '国家级人才B类', '国家级人才C类', '省部级人才') AND xm_name LIKE '%青年人才计划%' | xm_name, gccrc | 原问题中：“获得过“国家级或省部级青年人才计划”荣誉的” | 问题要求返回荣誉信息 |
| /univ_demo/student_master |  | name, account |  | 问题要求返回研究生姓名和学号 |
| /univ_demo/paper | level IN ('A类', 'B类') AND type IN ('期刊', '会议') AND keywords LIKE '%人工智能%' | title, abstract, journals, level, type, paper_file | 原问题中：“在A类或B类的期刊或会议上发表的“人工智能”相关的论文” | 问题要求返回论文详细信息 |

### 2. 文件交付内容示例（分析过程只在正文简述）

1. 分析与架构规划
*   **读取 ABC**：A 步骤定义了一个 `person -> student -> paper` 的长链路。B 步骤包含大量筛选条件。C 步骤为空，是明细查询。
*   **逻辑推导与 DSL 规划**：
    *   Step 数量判定：这是一个典型的明细查询，乍一看似乎只需要 1 个 Step。但是，最终输出要求**中文别名**（如“教职工姓名”）。根据你的 DSL 规则补充：“第一个 step 中输出字段的别名 `as` **以英文字母开头，后续只能包含英文字母、数字和下划线（`[A-Za-z][A-Za-z0-9_]*`）**”。因此，为了实现中文别名输出，**必须规划为 2 Steps**：Step 1 用英文别名输出到临时表，Step 2 再从临时表输出并重命名为中文。
    *   临时表字段预埋：Step 1 必须输出所有最终需要展示的字段，并使用合规的英文别名。

2. 执行结构化翻译
*   **Step 1 (数据提取层)**：
    *   Graph & Conditions：将 A 步骤的长链路和 B 步骤的所有筛选条件（如 `lx_date`, `age`, `gccrc`, `keywords` 等）完整翻译。
    *   Output：将所有字段用英文别名（如 `teacher_name`, `student_name`, `paper_title`）输出到临时表。
*   **Step 2 (计算表达层)**：
    *   Input：引用 Step 1 的临时表。
    *   Output：将临时表中的所有字段原样输出，但 `as` 属性全部替换为用户要求的中文别名。

3. 自检
*   拒绝幻觉：确认长链路上的所有类和关系都正确无误。
*   指令遵循：ABC 中的每一个筛选条件都已在 Step 1 中体现。
*   语法逻辑：
    *   别名规则检查：确认 Step 1 使用了英文别名，Step 2 使用了中文别名，符合 DSL 规则。
    *   文本检索检查：确认对 `keywords` 字段使用的是 `like` 操作符，而不是 `vector` 的 `query`，符合业务知识要求。
```json
{
    "problem": "查询计算机学院中，2020年以来入职的、获得过“国家级或省部级青年人才计划”荣誉的、不满45岁的教职工，他们指导的研究生，在A类或B类的期刊或会议上发表的“人工智能”相关的论文的详细信息",
    "answer": {
      "steps": [
        {
          "graph": {
            "patterns": [
              {
                "objects": [
                  {
                    "idx": 0,
                    "variable": "person",
                    "class": "/univ_demo/person",
                    "conditions": {
                      "properties": {
                        "operator": "logic",
                        "and": [
                          {"field": "lx_date", "operator": ">=", "value": "2020-01-01 00:00:00"},
                          {"field": "age", "operator": "<", "value": 45},
                          {"field": "staff_type", "operator": "=", "value": "专任教师岗位"},
                          {"field": "person_sort", "operator": "=", "value": "事业编"}
                        ]
                      }
                    }
                  },
                  {
                    "idx": 1,
                    "variable": "org",
                    "class": "/univ_demo/org",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "name", "operator": "=", "value": "计算机学院"}]}
                    }
                  },
                  {
                    "idx": 2,
                    "variable": "honor",
                    "class": "/univ_demo/szxxsb",
                    "conditions": {
                      "properties": {
                        "operator": "logic",
                        "and": [
                          {"field": "gccrc", "operator": "in", "value": ["国家级人才A类", "国家级人才B类", "国家级人才C类", "省部级人才"]},
                          {"field": "xm_name", "operator": "like", "value": "%青年人才计划%"}
                        ]
                      }
                    }
                  },
                  {"idx": 3, "variable": "student", "class": "/univ_demo/student_master"},
                  {
                    "idx": 4,
                    "variable": "paper",
                    "class": "/univ_demo/paper",
                    "conditions": {
                      "properties": {
                        "operator": "logic",
                        "and": [
                          {"field": "level", "operator": "in", "value": ["A类", "B类"]},
                          {"field": "type", "operator": "in", "value": ["期刊", "会议"]},
                          {"field": "keywords", "operator": "like", "value": "%人工智能%"}
                        ]
                      }
                    }
                  }
                ],
                "relationship": [
                  {"from": 0, "to": 1, "type": ["person_to_org"], "min_hops": 1, "max_hops": 1},
                  {"from": 0, "to": 2, "type": ["person_to_szxxsb"], "min_hops": 1, "max_hops": 1},
                  {"from": 0, "to": 3, "type": ["person_to_master"], "min_hops": 1, "max_hops": 1},
                  {"from": 3, "to": 4, "type": ["own_paper"], "min_hops": 1, "max_hops": 1}
                ]
              }
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": false,
            "save_table": "/temp01_paper_query",
            "fields": [
              {"variable": "person", "field": "name", "as": "teacher_name"},
              {"variable": "person", "field": "account", "as": "teacher_account"},
              {"variable": "org", "field": "name", "as": "org_name"},
              {"variable": "honor", "field": "xm_name", "as": "honor_name"},
              {"variable": "honor", "field": "gccrc", "as": "honor_level"},
              {"variable": "student", "field": "name", "as": "student_name"},
              {"variable": "student", "field": "account", "as": "student_account"},
              {"variable": "paper", "field": "title", "as": "paper_title"},
              {"variable": "paper", "field": "abstract", "as": "paper_abstract"},
              {"variable": "paper", "field": "journals", "as": "paper_journals"},
              {"variable": "paper", "field": "level", "as": "paper_level"},
              {"variable": "paper", "field": "type", "as": "paper_type"},
              {"variable": "paper", "field": "paper_file", "as": "paper_file"}
            ]
          }
        },
        {
          "graph": {
            "patterns": [
              {"objects": [{"class": "/temp01_paper_query", "variable": "temp01"}]}
            ],
            "pattern_logic": "and"
          },
          "output": {
            "to_user": true,
            "fields": [
              {"variable": "temp01", "field": "teacher_name", "as": "教职工姓名"},
              {"variable": "temp01", "field": "teacher_account", "as": "教职工工号"},
              {"variable": "temp01", "field": "org_name", "as": "所属院系"},
              {"variable": "temp01", "field": "honor_name", "as": "荣誉名称"},
              {"variable": "temp01", "field": "honor_level", "as": "荣誉级别"},
              {"variable": "temp01", "field": "student_name", "as": "研究生姓名"},
              {"variable": "temp01", "field": "student_account", "as": "研究生学号"},
              {"variable": "temp01", "field": "paper_title", "as": "论文标题"},
              {"variable": "temp01", "field": "paper_abstract", "as": "论文摘要"},
              {"variable": "temp01", "field": "paper_journals", "as": "期刊/会议名称"},
              {"variable": "temp01", "field": "paper_level", "as": "论文等级"},
              {"variable": "temp01", "field": "paper_type", "as": "论文类型"},
              {"variable": "temp01", "field": "paper_file", "as": "论文文件"}
            ]
          }
        }
      ]
    }
}
```

**以上示例仅为演示内容，实际执行时请参考`输入信息`**
