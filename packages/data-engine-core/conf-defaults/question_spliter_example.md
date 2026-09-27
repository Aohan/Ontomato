### 示例1：单子查询（明细查询）
**原问题**：查询拍照过泰国题材的摄影作品的教职工，返回他们的姓名、所属院系、当前行政职务、当前任职学会、任职职务和“泰国题材”的摄影作品。

**关键判断**：
- 单子查询即可完成：所有信息可通过`person`为中心连通获取。
- 向量字段处理：`photo_works`字段需使用向量检索（符合业务知识第3条）。
- 时间状态：行政职务需过滤`last_flag='是'`。

```json
{
  "question": "查询拍照过泰国题材的摄影作品的教职工，返回他们的姓名、所属院系、当前行政职务、当前任职学会、任职职务和“泰国题材”的摄影作品",
  "subQueries": [
    {
      "subQuestion": "查询拍照过泰国题材的摄影作品的教职工，返回他们的姓名、所属院系、当前行政职务、当前任职学会、任职职务和“泰国题材”的摄影作品",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "教职工人事所属组织机构关系",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工担任的当前行政职务",
            "target": "/univ_demo/mgn_duty"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工担任的学会职务履历变化",
            "target": "/univ_demo/szxxsb_xh"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "摄影作品向量匹配泰国",
            "select": "name, photo_works(query“泰国”)",
            "filter_source": "原问题中：拍照过泰国题材的摄影作品的教职工",
            "select_reason": "问题要求返回教职工名称和泰国题材摄影作品"
          },
          {
            "node": "/univ_demo/org",
            "filters": "",
            "select": "name",
            "filter_source": "",
            "select_reason": "问题要求返回所属院系名称"
          },
          {
            "node": "/univ_demo/mgn_duty",
            "filters": "是否现行政职务 = 是",
            "select": "title",
            "filter_source": "原问题要查当前行政职务",
            "select_reason": "问题要求返回行政职务"
          },
          {
            "node": "/univ_demo/szxxsb_xh",
            "filters": "聘期结束时间(pq_jssj) 是 空 或 聘期结束时间(pq_jssj) 大于 当前时间",
            "select": "xm_name, wcrpm",
            "filter_source": "当前任职学会等价逻辑是：没有“聘期结束时间”或“聘期结束时间”大于当前时间",
            "select_reason": "问题要求返回任职学会、任职职务"
          }
        ]
      },
      "C_Step": "",
      "classes": ["/univ_demo/person", "/univ_demo/org", "/univ_demo/mgn_duty", "/univ_demo/szxxsb_xh"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": false,
      "DSL_C_Step_function": false,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": ""
}
```

### 示例2：比例计算（必须拆分+后算）
**原问题**：计算各个人事单位中，博士学位教职工和全部教职工的人数以及博士所占的比例。

**关键判断**：
- 必须拆分：涉及不同筛选条件的聚合（博士 vs 全部），单个ABC无法处理条件聚合。
- 需要后算：比例计算属于跨结果运算，必须通过finalCalculation完成。

```json
{
  "question": "计算各个人事单位中，博士学位教职工和全部教职工的人数以及博士所占的比例。",
  "subQueries": [
    {
      "subQuestion": "统计各个人事单位的博士学位教职工人数",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "教职工人事所属组织机构关系",
            "target": "/univ_demo/org"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "degree_level = '博士'",
            "select": "account, org.name",
            "filter_source": "原问题要求统计博士学位教职工",
            "select_reason": "account用于计数，org.name用于分组"
          },
          {
            "node": "/univ_demo/org",
            "filters": "无",
            "select": "name",
            "filter_source": "无",
            "select_reason": "单位名称作为分组维度和展示字段"
          }
        ]
      },
      "C_Step": "按人事单位分组，对account去重计数，得到各单位博士人数",
      "classes": ["/univ_demo/person", "/univ_demo/org"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    },
    {
      "subQuestion": "统计各个人事单位的全部教职工人数",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "教职工人事所属组织机构关系",
            "target": "/univ_demo/org"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "无",
            "select": "account, org.name",
            "filter_source": "原问题要求统计全部教职工",
            "select_reason": "account用于计数，org.name用于分组"
          },
          {
            "node": "/univ_demo/org",
            "filters": "无",
            "select": "name",
            "filter_source": "无",
            "select_reason": "单位名称作为分组维度和展示字段"
          }
        ]
      },
      "C_Step": "按人事单位分组，对account去重计数，得到各单位总人数",
      "classes": ["/univ_demo/person", "/univ_demo/org"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": "将两个子查询结果按单位关联，计算博士比例 = 博士人数 / 总人数"
}
```

### 示例3：统计+明细同时要（必须拆分）
**原问题**：查询计算机学院中，2020年以来入职的、获得过"国家级或省部级青年人才计划"荣誉的、不满45岁的教职工，他们指导的研究生，在A类或B类的期刊或会议上发表的"人工智能"相关的论文数量，同时列出论文的详细信息、作者和指导老师的详细信息、以及荣誉。

**关键判断**：
- 必须拆分：问题同时要求"论文数量"（统计）和"论文详细信息"（明细），一个ABC只能输出一种表形态。
- 两个子查询共享相同子图路径，但C_Step不同。

```json
{
  "question": "查询计算机学院中，2020年以来入职的、获得过“国家级或省部级青年人才计划”荣誉的、不满45岁的教职工，他们指导的研究生，在A类或B类的期刊或会议上发表的“人工智能”相关的论文数量，同时列出论文的详细信息、作者和指导老师的详细信息、以及荣誉",
  "subQueries": [
    {
      "subQuestion": "查询满足条件的教职工、研究生、论文及相关荣誉的明细信息",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "教职工人事所属组织机构关系",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工人才工程荣誉奖励业绩成果记录",
            "target": "/univ_demo/szxxsb"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工指导研究生",
            "target": "/univ_demo/student_master"
          },
          {
            "source": "/univ_demo/student_master",
            "relation": "拥有论文",
            "target": "/univ_demo/paper"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "lx_date >= '2020-01-01' AND age < 45",
            "select": "name",
            "filter_source": "原问题中：“2020年以来入职的”和“不满45岁的”",
            "select_reason": "返回指导老师姓名"
          },
          {
            "node": "/univ_demo/org",
            "filters": "name = '计算机学院'",
            "select": "",
            "filter_source": "原问题中：“计算机学院中”",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/szxxsb",
            "filters": "gccrc in ('国家级人才A类','国家级人才B类','国家级人才C类','省部级人才') AND xm_name like '%青年人才%'",
            "select": "xm_name",
            "filter_source": "原问题中：“获得过“国家级或省部级青年人才计划”荣誉的”",
            "select_reason": "返回教师荣誉"
          },
          {
            "node": "/univ_demo/student_master",
            "filters": "",
            "select": "name",
            "filter_source": "",
            "select_reason": "返回论文作者姓名"
          },
          {
            "node": "/univ_demo/paper",
            "filters": "level in ('A类','B类') AND type in ('期刊','会议') AND keywords like '%人工智能%'",
            "select": "title,abstract,journals,level,type,paper_file",
            "filter_source": "原问题中：“在A类或B类的期刊或会议上发表的“人工智能”相关的论文”",
            "select_reason": "返回论文相关信息"
          }
        ]
      },
      "C_Step": "",
      "classes": ["/univ_demo/person", "/univ_demo/org", "/univ_demo/szxxsb", "/univ_demo/student_master", "/univ_demo/paper"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": false,
      "DSL_C_Step_function": false,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    },
    {
      "subQuestion": "统计满足条件的论文数量",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "教职工人事所属组织机构关系",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工人才工程荣誉奖励业绩成果记录",
            "target": "/univ_demo/szxxsb"
          },
          {
            "source": "/univ_demo/person",
            "relation": "教职工指导研究生",
            "target": "/univ_demo/student_master"
          },
          {
            "source": "/univ_demo/student_master",
            "relation": "拥有论文",
            "target": "/univ_demo/paper"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/paper",
            "filters": "level in ('A类','B类') AND type in ('期刊','会议') AND keywords like '%人工智能%'",
            "select": "title",
            "filter_source": "原问题中：“在A类或B类的期刊或会议上发表的“人工智能”相关的论文”",
            "select_reason": "title字段用于计数"
          },
          {
            "node": "/univ_demo/person",
            "filters": "lx_date >= '2020-01-01' AND age < 45",
            "select": "",
            "filter_source": "原问题中：“2020年以来入职的”和“不满45岁的”",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/org",
            "filters": "name = '计算机学院'",
            "select": "",
            "filter_source": "原问题中：“计算机学院中”",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/szxxsb",
            "filters": "gccrc in ('国家级人才A类','国家级人才B类','国家级人才C类','省部级人才') AND xm_name like '%青年人才%'",
            "select": "",
            "filter_source": "原问题中：“获得过“国家级或省部级青年人才计划”荣誉的”",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/student_master",
            "filters": "",
            "select": "",
            "filter_source": "",
            "select_reason": ""
          }
        ]
      },
      "C_Step": "统计论文数量count(title)",
      "classes": ["/univ_demo/person", "/univ_demo/org", "/univ_demo/szxxsb", "/univ_demo/student_master", "/univ_demo/paper"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": false,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": ""
}
```

### 示例4：单类的计数与占比（必须拆分并后算）
**原问题**：按性别统计在职教职工人数与占比。

**关键判断**：
- 必须拆分+后算：虽然按性别分组统计可单子查询完成，但"占比"需要与总人数计算比例，涉及跨结果运算。
- 实际需要两个子查询：一个按性别分组统计，一个统计总人数。

```json
{
  "question": "按性别统计在职教职工人数与占比",
  "subQueries": [
    {
      "subQuestion": "按性别分组统计各性别人数",
      "subgraph": {
        "path": [],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "status = '在职'",
            "select": "account, sex",
            "filter_source": "原问题要求统计在职教职工",
            "select_reason": "account用于计数，sex用于分组"
          }
        ]
      },
      "C_Step": "按性别分组，对account去重计数",
      "classes": ["/univ_demo/person"],
      "DSL_relationship": false,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    },
    {
      "subQuestion": "统计全部在职教职工人数",
      "subgraph": {
        "path": [],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "status = '在职'",
            "select": "account",
            "filter_source": "原问题要求统计在职教职工",
            "select_reason": "account用于计数"
          }
        ]
      },
      "C_Step": "统计account去重计数",
      "classes": ["/univ_demo/person"],
      "DSL_relationship": false,
      "DSL_C_Step_group_by": false,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": "将子查询1的各性别人数分别除以子查询2的总人数，得到各性别占比"
}
```