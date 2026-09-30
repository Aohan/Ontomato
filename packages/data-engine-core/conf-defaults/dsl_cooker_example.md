These examples illustrate query planning and DSL construction. Their classes, fields, relationships and values are illustrative. For an actual query, use the dataset definitions and business knowledge supplied in the current input; do not import example definitions or business filters into another dataset.
> Summarize the example analysis briefly in the response; write the JSON code block to a workspace DSL file and submit it through `submitDsl`, without repeating it in the response.

## Business Knowledge (used only in the examples)

1. When querying full-time teachers, the default conditions are: establishment type = 'Government-affiliated' and staff category = 'Full-time teaching position'.
2. The faculty affiliation organization must use the `sz_g` field, and records where `sz_g` is empty must be excluded.
3. When filtering the current administrative duty in `/univ_demo/mgn_duty`, you must add the filter condition `last_flag = "Yes"`.
4. When filtering the current highest professional technical position in `/univ_demo/tech_duty`, you must add the filter condition `last_flag = "Yes"`.
5. When extracting photography works (vector) of a specified theme, vector retrieval must be used, that is, the `query` field.
6. When extracting papers, vector retrieval is **forbidden**; use `keywords like xxx` to filter papers of a specified theme.

## Example 1: Star Graph -- Multiple Relationships Around the Same Faculty Member

### 1. Problem, ABC Steps and Graph Structure Description

**Problem Description**

> Question: Count the currently active people who have received talent program honors or awards, and count the number of people by `professional technical position level`.

> Here "professional technical position level" corresponds to the field `duty_level` in the `/univ_demo/tech_duty` table.

**A_Step: path table**

| Source object                | Relationship                    | Target object                   |
| ------------------- | --------------------- | ---------------------- |
| `/univ_demo/person` | `person_to_szxxsb`    | `/univ_demo/szxxsb`    |
| `/univ_demo/person` | `person_to_tech_duty` | `/univ_demo/tech_duty` |

> Explanation:
>
> * The center of the star is `/univ_demo/person`;
> * It is connected via relationship edges such as the staff ID to the talent program honor records `/univ_demo/szxxsb` and the professional technical position records `/univ_demo/tech_duty`.

**B_Step: nodes table**

| Object class                    | Filter conditions                       | Extracted fields         | Condition source       | Extraction reason                               |
| ---------------------- | -------------------------- | ------------ | ---------- | ---------------------------------- |
| `/univ_demo/person`    | `status` = 'Active' | `account`    | Business knowledge | Identify faculty and staff by staff ID and perform deduplicated counting                     |
| `/univ_demo/szxxsb`    | No specific conditions (a related record only needs to exist)            | —            | Question requirement      | Used to determine whether the person "has received talent program honors or awards"                |
| `/univ_demo/tech_duty` | `last_flag = "Yes"`          | `duty_level` | Business knowledge + question | Only count the "current highest professional technical position", grouped by `duty_level` |

* **C_Step**: On the detail table of "faculty and staff within the active scope + at least one talent program honor record + current highest professional technical position record", use `duty_level` as the grouping field to perform `group_by`, and perform a `count distinct` on the staff ID `account` of faculty and staff, obtaining "the number of faculty and staff counted by professional technical position level".

### 2. Example of File Delivery Content (the analysis process is only briefly described in the main text)

1. Analysis and architecture planning
*   **Read ABC**: Step A defines a star graph centered on `person`, connecting `szxxsb` and `tech_duty`. Step B has filter conditions. Step C explicitly requires grouping by `duty_level` (**group_by**) and counting distinct `account` values (**count distinct**).
*   **Logic derivation and DSL planning**:
    *   Step count determination: Step C is detected to contain **aggregation (count)** and **grouping (group_by)**; according to the DSL rules, **it must be planned as 2 Steps**.
    *   Temporary table field pre-embedding: to implement the logic of Step C in Step 2, Step 1 must first output the "grouping key" `duty_level` and the "calculation key" `account` to the temporary table as ordinary fields.

2. Perform structured translation
*   **Step 1 (data extraction layer)**:
    *   Graph: Translate the two paths of Step A into `relationship`.
    *   Conditions: Strictly following Step B, add `status = 'Active'` on the `person` object and `last_flag = "Yes"` on the `tech_duty` object.
    *   Output: According to the plan, output `person.account` and `tech_duty.duty_level` to the temporary table.
*   **Step 2 (calculation expression layer)**:
    *   Input: Reference the temporary table of Step 1.
    *   Output: In response to Step C, put `duty_level` into `group_by`; in `fields`, add `function: "count"` and `distinct: true` to the `account` field.

3. Self-check
*   Reject hallucination**: Confirm that classes such as `person`, `tech_duty`, `szxxsb` and fields such as `status`, `last_flag` all exist in the dataset.
*   Instruction following**: The DSL fully covers the path, filter, grouping and aggregation requirements of ABC, with nothing omitted.
*   Syntax logic:
    *   Group By check: The output of Step 2 contains both the ordinary field `tech_duty_level` and the aggregate field `person_account (count distinct)`, and `group_by` is configured correctly.
    *   Step isolation: The aggregation operation `function` is correctly isolated in Step 2.

```json
{
    "problem": "Count the people who have currently received talent program honors or awards, and count the number of people by `professional technical position level`.",
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
                        "and": [{"field": "status", "operator": "=", "value": "Active"}]
                      }
                    }
                  },
                  {"idx": 1, "variable": "honor", "class": "/univ_demo/szxxsb"},
                  {
                    "idx": 2,
                    "variable": "tech_duty",
                    "class": "/univ_demo/tech_duty",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "last_flag", "operator": "=", "value": "Yes"}]}
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

## Example 2: Vector Retrieval -- Complex Filtering and Multi-dimensional Attribute Extraction

### 1. Problem, ABC Steps and Graph Structure Description

**Problem Description**

> Question: Query the faculty and staff who have taken Thailand-themed photography works, and return their names, their departments, current administrative duties, current societies they serve, positions held, and their "Thailand-themed" photography works.

**A_Step: path table**

| Source object | Relationship | Target object |
| :--- | :--- | :--- |
| `/univ_demo/person` | `person_to_org` | `/univ_demo/org` |
| `/univ_demo/person` | `person_to_mgn_duty` | `/univ_demo/mgn_duty` |
| `/univ_demo/person` | `person_to_szxxsb_xh` | `/univ_demo/szxxsb_xh` |

> Explanation:
>
>   * The central node is `/univ_demo/person` (faculty and staff);
>   * It connects outward to the department organization (`org`), the administrative duty (`mgn_duty`) and the society position records (`szxxsb_xh`);
>   * Note: `person_to_szxxsb_xh` is the relationship connecting faculty and staff with their society position records.

**B_Step: nodes table**

| Object class | Filter conditions | Extracted fields | Condition source | Extraction reason |
| :--- | :--- | :--- | :--- | :--- |
| `/univ_demo/person` | `photo_works` vector match "Thailand" | `name`, `photo_works` | Question ("have taken Thailand-themed") | Need to return the names and the works matching the question |
| `/univ_demo/org` | No additional conditions | `name` | Question requirement | Return the "department" |
| `/univ_demo/mgn_duty` | `last_flag = "Yes"` | `title` | Business knowledge + question | Must be the "current" administrative duty |
| `/univ_demo/szxxsb_xh` | `pq_jssj` is null OR `pq_jssj` > current time (2025-11-30 07:33:17) | `xm_name`, `wcrpm` | Business logic (current position) | Define "current society served" and return the society name and position |

  * **C_Step**: No aggregation calculation is needed. On the filtered connected subgraph, directly extract the above fields and display them flattened by faculty and staff dimension.


### 2. Example of File Delivery Content (the analysis process is only briefly described in the main text)

1. Analysis and architecture planning
*   **Read ABC**: Step A defines a graph in which `person` is connected to multiple classes. Step B requires extracting multiple fields, including the **vector** type field `photo_works`. Step C is empty; this is a detail query.
*   **Logic derivation and DSL planning**:
    *   Step count determination: Although Step C is empty, Step B requires outputting a `vector` field. According to the DSL rules, **the output of a vector field must use 2 Steps** (Step 1 extracts the objects, Step 2 retrieves the vector file with the `query` parameter). Therefore, it must be planned as 2 Steps.
    *   Temporary table field pre-embedding: Step 1 needs to output all the fields ultimately required, including `person.name`, `org.name`, `mgn_duty.title` and `person.photo_works`, etc.

2. Perform structured translation
*   **Step 1 (data extraction layer)**:
    *   Graph & Conditions: Map the paths of Step A and the filter conditions of Step B (including the `vector` filter of `person`, the `last_flag` filter of `mgn_duty`, and the `OR` logic of `szxxsb_xh`) one by one.
    *   Output: Output all fields that need to be output (including `photo_works`) to the temporary table as-is.
*   **Step 2 (calculation expression layer)**:
    *   Input: Reference the temporary table of Step 1.
    *   Output:
        *   Output all ordinary fields.
        *   **Vector output**: For the `photo_works` field, strictly according to the DSL rules, attach the `query: "Thailand"` parameter on output to ensure that the photography works returned match the theme.

3. Self-check
*   Reject hallucination**: Confirm that all classes, relationships and fields exist.
*   Instruction following: All filter conditions in ABC, including the `vector` filter and the `OR` logic, are reflected in the DSL.
*   Syntax logic:
    *   **Vector rule check**: Confirm that the 2 Steps rule for vector output is followed, and that the `photo_works` field in Step 2 carries the `query` parameter.
    *   **Step isolation**: Responsibilities are clear; Step 1 handles the graph query and Step 2 handles formatting and vector file retrieval.

```json
{
    "problem": "Query the faculty and staff who have taken Thailand-themed photography works, and return their names, their departments, current administrative duties, current societies they serve, positions held, and their \"Thailand-themed\" photography works",
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
                        "properties": {"operator": "logic", "and": [{"field": "photo_works", "query": "Thailand"}]}
                      }
                    }
                  },
                  {"idx": 1, "variable": "org", "class": "/univ_demo/org"},
                  {
                    "idx": 2,
                    "variable": "mgn_duty",
                    "class": "/univ_demo/mgn_duty",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "last_flag", "operator": "=", "value": "Yes"}]}
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
              {"variable": "temp01", "field": "person_name", "as": "Name"},
              {"variable": "temp01", "field": "dept_name", "as": "Department"},
              {"variable": "temp01", "field": "admin_title", "as": "Current Administrative Duty"},
              {"variable": "temp01", "field": "society_name", "as": "Current Society Served"},
              {"variable": "temp01", "field": "society_position", "as": "Position Held"},
              {"variable": "temp01", "field": "photo_works", "query": "Thailand", "as": "Photography Works"}
            ]
          }
        }
      ]
    }
}
```


## Example 3: Tree Graph -- Multi-hop Paths and Text Filtering

### 1. Problem, ABC Steps and Graph Structure Description

**Problem Description**

> Question: Query the faculty and staff of the School of Computer Science who joined in 2020 or later, who have received a "national-level or provincial/ministerial-level young talent program" honor, and who are under 45 years old, the detailed information of the "Artificial Intelligence"-related papers published in journals or conferences of level A or B by the graduate students they supervise

**A_Step: path table**

| Path ID | Source object | Relationship | Target object |
| ---- | ---- | ---- | ---- |
| P1 | /univ_demo/person | HR organization relation of faculty and staff | /univ_demo/org |
| P2 | /univ_demo/person | Records of talent program honors, awards and achievements of faculty and staff | /univ_demo/szxxsb |
| P3 | /univ_demo/person | Faculty and staff supervising graduate students | /univ_demo/student_master |
| P4 | /univ_demo/student_master | Owns paper | /univ_demo/paper |

**B_Step: nodes table**

| Object class | Filter conditions | Extracted fields | Condition source | Extraction reason |
| ---- | ---- | ---- | ---- | ---- |
| /univ_demo/person | lx_date >= '2020-01-01 00:00:00' AND age < 45 AND staff_type = 'Full-time teaching position' AND person_sort = 'Government-affiliated' | name, account, sz_g | In the original question: "joined in 2020 or later", "under 45 years old", "full-time teaching" | The question requires returning the faculty and staff name, staff ID and affiliation organization |
| /univ_demo/org | name = 'School of Computer Science' | name | In the original question: "of the School of Computer Science" | The question requires returning the department name |
| /univ_demo/szxxsb | gccrc IN ('National-level talent A', 'National-level talent B', 'National-level talent C', 'Provincial/ministerial-level talent') AND xm_name LIKE '%Young Talent Program%' | xm_name, gccrc | In the original question: "who have received a "national-level or provincial/ministerial-level young talent program" honor" | The question requires returning the honor information |
| /univ_demo/student_master |  | name, account |  | The question requires returning the graduate student name and student ID |
| /univ_demo/paper | level IN ('A', 'B') AND type IN ('Journal', 'Conference') AND keywords LIKE '%Artificial Intelligence%' | title, abstract, journals, level, type, paper_file | In the original question: "the "Artificial Intelligence"-related papers published in journals or conferences of level A or B" | The question requires returning the paper details |

### 2. Example of File Delivery Content (the analysis process is only briefly described in the main text)

1. Analysis and architecture planning
*   **Read ABC**: Step A defines a long chain `person -> student -> paper`. Step B contains a large number of filter conditions. Step C is empty; this is a detail query.
*   **Logic derivation and DSL planning**:
    *   Step count determination: This is a typical detail query; at first glance it seems to need only 1 Step. However, the final output requires **display aliases that contain spaces** (e.g. `Faculty Name`). According to the supplement to your DSL rules: "the alias `as` of an output field in the first step **must start with an English letter and contain only English letters, digits and underscores thereafter (`[A-Za-z][A-Za-z0-9_]*`)**". Therefore, to output display aliases that contain spaces, **you must plan 2 Steps**: Step 1 outputs with valid aliases to a temporary table, Step 2 outputs from the temporary table and renames them to the display aliases.
    *   Temporary table field pre-embedding: Step 1 must output all fields that ultimately need to be displayed, using compliant English aliases.

2. Perform structured translation
*   **Step 1 (data extraction layer)**:
    *   Graph & Conditions: Fully translate the long chain of Step A and all the filter conditions of Step B (such as `lx_date`, `age`, `gccrc`, `keywords`, etc.).
    *   Output: Output all fields to the temporary table with English aliases (such as `teacher_name`, `student_name`, `paper_title`).
*   **Step 2 (calculation expression layer)**:
    *   Input: Reference the temporary table of Step 1.
    *   Output: Output all fields in the temporary table as-is, but replace all `as` attributes with the display aliases required by the user.

3. Self-check
*   Reject hallucination: Confirm that all classes and relationships on the long chain are correct.
*   Instruction following: Every filter condition in ABC is reflected in Step 1.
*   Syntax logic:
    *   Alias rule check: Confirm that Step 1 uses English aliases and that Step 2 renames them to display aliases containing spaces, which complies with the DSL rules.
    *   Text retrieval check: Confirm that the `keywords` field uses the `like` operator rather than the `vector` `query`, which complies with the business knowledge requirements.
```json
{
    "problem": "Query the faculty and staff of the School of Computer Science who joined in 2020 or later, who have received a \"national-level or provincial/ministerial-level young talent program\" honor, and who are under 45 years old, the detailed information of the \"Artificial Intelligence\"-related papers published in journals or conferences of level A or B by the graduate students they supervise",
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
                          {"field": "staff_type", "operator": "=", "value": "Full-time teaching position"},
                          {"field": "person_sort", "operator": "=", "value": "Government-affiliated"}
                        ]
                      }
                    }
                  },
                  {
                    "idx": 1,
                    "variable": "org",
                    "class": "/univ_demo/org",
                    "conditions": {
                      "properties": {"operator": "logic", "and": [{"field": "name", "operator": "=", "value": "School of Computer Science"}]}
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
                          {"field": "gccrc", "operator": "in", "value": ["National-level talent A", "National-level talent B", "National-level talent C", "Provincial/ministerial-level talent"]},
                          {"field": "xm_name", "operator": "like", "value": "%Young Talent Program%"}
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
                          {"field": "level", "operator": "in", "value": ["A", "B"]},
                          {"field": "type", "operator": "in", "value": ["Journal", "Conference"]},
                          {"field": "keywords", "operator": "like", "value": "%Artificial Intelligence%"}
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
              {"variable": "temp01", "field": "teacher_name", "as": "Faculty Name"},
              {"variable": "temp01", "field": "teacher_account", "as": "Faculty ID"},
              {"variable": "temp01", "field": "org_name", "as": "Department"},
              {"variable": "temp01", "field": "honor_name", "as": "Honor Name"},
              {"variable": "temp01", "field": "honor_level", "as": "Honor Level"},
              {"variable": "temp01", "field": "student_name", "as": "Graduate Student Name"},
              {"variable": "temp01", "field": "student_account", "as": "Student ID"},
              {"variable": "temp01", "field": "paper_title", "as": "Paper Title"},
              {"variable": "temp01", "field": "paper_abstract", "as": "Paper Abstract"},
              {"variable": "temp01", "field": "paper_journals", "as": "Journal/Conference Name"},
              {"variable": "temp01", "field": "paper_level", "as": "Paper Level"},
              {"variable": "temp01", "field": "paper_type", "as": "Paper Type"},
              {"variable": "temp01", "field": "paper_file", "as": "Paper File"}
            ]
          }
        }
      ]
    }
}
```

**The above examples are for demonstration only; when actually executing, please refer to the `input information`**
