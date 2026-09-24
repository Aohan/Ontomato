### Example 1: Single sub-query (detail query)
**Original question**: Query the faculty and staff who have taken Thailand-themed photography works, and return their names, their departments, current administrative duties, current societies they serve, positions held, and their "Thailand-themed" photography works.

**Key judgments**:
- A single sub-query is sufficient: all information can be obtained through connectivity centered on `person`.
- Vector field handling: the `photo_works` field requires vector retrieval (consistent with item 3 of the business knowledge).
- Time status: the administrative duty must be filtered by `last_flag='Yes'`.

```json
{
  "question": "Query the faculty and staff who have taken Thailand-themed photography works, and return their names, their departments, current administrative duties, current societies they serve, positions held, and their \"Thailand-themed\" photography works",
  "subQueries": [
    {
      "subQuestion": "Query the faculty and staff who have taken Thailand-themed photography works, and return their names, their departments, current administrative duties, current societies they serve, positions held, and their \"Thailand-themed\" photography works",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "HR organization relation of faculty and staff",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "Current administrative duty of faculty and staff",
            "target": "/univ_demo/mgn_duty"
          },
          {
            "source": "/univ_demo/person",
            "relation": "History of changes in society positions held by faculty and staff",
            "target": "/univ_demo/szxxsb_xh"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "Photography works vector match Thailand",
            "select": "name, photo_works(query \"Thailand\")",
            "filter_source": "From the original question: faculty and staff who have taken Thailand-themed photography works",
            "select_reason": "The question requires returning the names of faculty and staff and their Thailand-themed photography works"
          },
          {
            "node": "/univ_demo/org",
            "filters": "",
            "select": "name",
            "filter_source": "",
            "select_reason": "The question requires returning the name of the department"
          },
          {
            "node": "/univ_demo/mgn_duty",
            "filters": "Whether it is the current administrative duty = Yes",
            "select": "title",
            "filter_source": "The original question asks for the current administrative duty",
            "select_reason": "The question requires returning the administrative duty"
          },
          {
            "node": "/univ_demo/szxxsb_xh",
            "filters": "Term end time (pq_jssj) is empty or Term end time (pq_jssj) is greater than the current time",
            "select": "xm_name, wcrpm",
            "filter_source": "The equivalent logic for the current society served is: there is no \"Term end time\" or \"Term end time\" is greater than the current time",
            "select_reason": "The question requires returning the current society served and the position held"
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

### Example 2: Proportion calculation (must split + post-calculation)
**Original question**: Calculate, for each HR unit, the number of faculty and staff with a doctoral degree, the total number of faculty and staff, and the proportion of doctoral degree holders.

**Key judgments**:
- Must split: it involves aggregation over different filter conditions (doctoral degree vs. all), and a single ABC cannot handle conditional aggregation.
- Post-calculation is required: the proportion calculation is a cross-result operation and must be completed through finalCalculation.

```json
{
  "question": "Calculate, for each HR unit, the number of faculty and staff with a doctoral degree, the total number of faculty and staff, and the proportion of doctoral degree holders.",
  "subQueries": [
    {
      "subQuestion": "Count the number of faculty and staff with a doctoral degree in each HR unit",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "HR organization relation of faculty and staff",
            "target": "/univ_demo/org"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "degree_level = 'Doctoral degree'",
            "select": "account, org.name",
            "filter_source": "The original question requires counting faculty and staff with a doctoral degree",
            "select_reason": "account is used for counting, org.name for grouping"
          },
          {
            "node": "/univ_demo/org",
            "filters": "None",
            "select": "name",
            "filter_source": "None",
            "select_reason": "The organization name serves as the grouping dimension and display field"
          }
        ]
      },
      "C_Step": "Group by HR unit and count distinct account to get the number of people with a doctoral degree in each unit",
      "classes": ["/univ_demo/person", "/univ_demo/org"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    },
    {
      "subQuestion": "Count the total number of faculty and staff in each HR unit",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "HR organization relation of faculty and staff",
            "target": "/univ_demo/org"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "None",
            "select": "account, org.name",
            "filter_source": "The original question requires counting all faculty and staff",
            "select_reason": "account is used for counting, org.name for grouping"
          },
          {
            "node": "/univ_demo/org",
            "filters": "None",
            "select": "name",
            "filter_source": "None",
            "select_reason": "The organization name serves as the grouping dimension and display field"
          }
        ]
      },
      "C_Step": "Group by HR unit and count distinct account to get the total number of people in each unit",
      "classes": ["/univ_demo/person", "/univ_demo/org"],
      "DSL_relationship": true,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": "Join the results of the two sub-queries by unit and calculate the proportion of doctoral degree holders = number of people with a doctoral degree / total number of people"
}
```

### Example 3: Statistics and details required at the same time (must split)
**Original question**: Query the faculty and staff of the School of Computer Science who joined in 2020 or later, who have received a "national-level or provincial/ministerial-level young talent program" honor, and who are under 45 years old, the graduate students they supervise, the number of "Artificial Intelligence"-related papers published in journals or conferences of level A or B, and list the paper details, the details of the authors and supervising teachers, and the honors.

**Key judgments**:
- Must split: the question requires both the "number of papers" (statistics) and the "paper details" (details), while one ABC can only output one table form.
- The two sub-queries share the same subgraph path, but their C_Step differs.

```json
{
  "question": "Query the faculty and staff of the School of Computer Science who joined in 2020 or later, who have received a \"national-level or provincial/ministerial-level young talent program\" honor, and who are under 45 years old, the graduate students they supervise, the number of \"Artificial Intelligence\"-related papers published in journals or conferences of level A or B, and list the paper details, the details of the authors and supervising teachers, and the honors",
  "subQueries": [
    {
      "subQuestion": "Query the detailed information of the qualifying faculty and staff, graduate students, papers and related honors",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "HR organization relation of faculty and staff",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "Records of talent program honors, awards and achievements of faculty and staff",
            "target": "/univ_demo/szxxsb"
          },
          {
            "source": "/univ_demo/person",
            "relation": "Faculty and staff supervising graduate students",
            "target": "/univ_demo/student_master"
          },
          {
            "source": "/univ_demo/student_master",
            "relation": "Owns paper",
            "target": "/univ_demo/paper"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "lx_date >= '2020-01-01' AND age < 45",
            "select": "name",
            "filter_source": "From the original question: \"joined in 2020 or later\" and \"under 45 years old\"",
            "select_reason": "Return the name of the supervising teacher"
          },
          {
            "node": "/univ_demo/org",
            "filters": "name = 'School of Computer Science'",
            "select": "",
            "filter_source": "From the original question: \"of the School of Computer Science\"",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/szxxsb",
            "filters": "gccrc in ('National-level talent A','National-level talent B','National-level talent C','Provincial/ministerial-level talent') AND xm_name like '%Young Talent%'",
            "select": "xm_name",
            "filter_source": "From the original question: \"has received a \"national-level or provincial/ministerial-level young talent program\" honor\"",
            "select_reason": "Return the honors of the teacher"
          },
          {
            "node": "/univ_demo/student_master",
            "filters": "",
            "select": "name",
            "filter_source": "",
            "select_reason": "Return the name of the paper author"
          },
          {
            "node": "/univ_demo/paper",
            "filters": "level in ('A','B') AND type in ('Journal','Conference') AND keywords like '%Artificial Intelligence%'",
            "select": "title,abstract,journals,level,type,paper_file",
            "filter_source": "From the original question: \"papers related to \"Artificial Intelligence\" published in journals or conferences of level A or B\"",
            "select_reason": "Return paper-related information"
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
      "subQuestion": "Count the number of qualifying papers",
      "subgraph": {
        "path": [
          {
            "source": "/univ_demo/person",
            "relation": "HR organization relation of faculty and staff",
            "target": "/univ_demo/org"
          },
          {
            "source": "/univ_demo/person",
            "relation": "Records of talent program honors, awards and achievements of faculty and staff",
            "target": "/univ_demo/szxxsb"
          },
          {
            "source": "/univ_demo/person",
            "relation": "Faculty and staff supervising graduate students",
            "target": "/univ_demo/student_master"
          },
          {
            "source": "/univ_demo/student_master",
            "relation": "Owns paper",
            "target": "/univ_demo/paper"
          }
        ],
        "nodes": [
          {
            "node": "/univ_demo/paper",
            "filters": "level in ('A','B') AND type in ('Journal','Conference') AND keywords like '%Artificial Intelligence%'",
            "select": "title",
            "filter_source": "From the original question: \"papers related to \"Artificial Intelligence\" published in journals or conferences of level A or B\"",
            "select_reason": "The title field is used for counting"
          },
          {
            "node": "/univ_demo/person",
            "filters": "lx_date >= '2020-01-01' AND age < 45",
            "select": "",
            "filter_source": "From the original question: \"joined in 2020 or later\" and \"under 45 years old\"",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/org",
            "filters": "name = 'School of Computer Science'",
            "select": "",
            "filter_source": "From the original question: \"of the School of Computer Science\"",
            "select_reason": ""
          },
          {
            "node": "/univ_demo/szxxsb",
            "filters": "gccrc in ('National-level talent A','National-level talent B','National-level talent C','Provincial/ministerial-level talent') AND xm_name like '%Young Talent%'",
            "select": "",
            "filter_source": "From the original question: \"has received a \"national-level or provincial/ministerial-level young talent program\" honor\"",
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
      "C_Step": "Count the number of papers count(title)",
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

### Example 4: Counts and proportions on a single class (split + post-calculation required)
**Original question**: Count the number and proportion of active faculty and staff by gender.

**Key judgments**:
- Must split + post-calculation: although the group statistics by gender can be done in a single sub-query, the "proportion" needs to be computed as a ratio to the total number of people, which is a cross-result operation.
- In fact two sub-queries are needed: one for group statistics by gender, and one for counting the total number of people.

```json
{
  "question": "Count the number and proportion of active faculty and staff by gender",
  "subQueries": [
    {
      "subQuestion": "Count the number of people of each gender, grouped by gender",
      "subgraph": {
        "path": [],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "status = 'Active'",
            "select": "account, sex",
            "filter_source": "The original question requires counting active faculty and staff",
            "select_reason": "account is used for counting, sex for grouping"
          }
        ]
      },
      "C_Step": "Group by gender and count distinct account",
      "classes": ["/univ_demo/person"],
      "DSL_relationship": false,
      "DSL_C_Step_group_by": true,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    },
    {
      "subQuestion": "Count the total number of active faculty and staff",
      "subgraph": {
        "path": [],
        "nodes": [
          {
            "node": "/univ_demo/person",
            "filters": "status = 'Active'",
            "select": "account",
            "filter_source": "The original question requires counting active faculty and staff",
            "select_reason": "account is used for counting"
          }
        ]
      },
      "C_Step": "Count distinct account",
      "classes": ["/univ_demo/person"],
      "DSL_relationship": false,
      "DSL_C_Step_group_by": false,
      "DSL_C_Step_function": true,
      "DSL_C_Step_four_basic_math": false,
      "DSL_C_Step_sort": false
    }
  ],
  "finalCalculation": "Divide the number of people of each gender in sub-query 1 by the total number of people in sub-query 2 to get the proportion of each gender"
}
```