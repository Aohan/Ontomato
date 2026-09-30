---
name: echarts
description: Self-contained ECharts chart rendering, supporting bar charts, line charts, pie charts, hierarchical charts, advanced charts, and the full series of chart types. Automatically completes data analysis and chart configuration selection internally.
type: executable
category: visualization
title: ECharts chart rendering
tags:
  - visualization
  - echarts
  - chart
timeout: 15000
outputType: html
version: 2.0.0
entries:
  - scripts/index.mjs
---
## ECharts chart rendering

Render data as an ECharts chart. This skill receives a complete visualization configuration and performs rendering to generate HTML.

## Input Parameters

When calling this skill, the following configuration parameters must be provided:

| Parameter        | Required | Description                                 |
| ----------- | ---- | ------------------------------------ |
| data        | Yes  | Data array, each row is an object             |
| chartType   | Yes  | Chart type, see the supported list below             |
| xField      | Yes  | Category/dimension field name, chosen from the data fields    |
| yField      | Yes  | Numeric field name, chosen from the data fields         |
| title       | Yes  | Chart title, concisely and accurately describing the data content       |
| seriesField | No   | Series grouping field, used for multi-series charts         |
| sortBy      | No   | Sort field: xField (by dimension), yField (by value), or none |
| sortOrder   | No   | Sort order: asc (ascending) or desc (descending) |
| topN        | No   | Limit the displayed count, used when the data volume is large         |
| excludeCategoryValues | No | Array of category original values to exactly exclude from `xField`, keeping string or number types |

Supported chart types: `bar`, `line`, `pie`, `scatter`, `area`, `radar`, `heatmap`, `funnel`, `sankey`, `treemap`, `sunburst`, `gauge`.

## Analysis Methodology

The following is the methodology for generating the visualization configuration, for reference when the LLM analyzes.

### 1. Field Type Recognition

Recognizing data field types is the basis for choosing xField and yField.

#### Numeric Field Characteristics

- JavaScript type is `number`
- Common field name keywords: headcount, amount, quantity, proportion, percentage, rate, value, count, amount, value, rate, sum, avg, total
- Field values can undergo mathematical operations (addition/subtraction/multiplication/division, size comparison)
- Examples: current staff headcount, sales amount, GDP, growth rate

#### Categorical Field Characteristics

- JavaScript type is `string`
- Common field name keywords: unit, name, category, type, department, college, region, province, city, name, category, type, dept, region
- Field values are discrete labels, not continuous numeric values
- Examples: faculty affiliation unit, product category, province name

#### Time Field Characteristics

- Common field name keywords: date, time, year, month, day, quarter, week, date, time, year, month, quarter
- Field value formats: YYYY-MM-DD, YYYY-MM, MM, Nth quarter
- Examples: hire date, statistics month, year

### 2. Chart Type Selection

Select the chart type based on data characteristics and user intent:

| User intent   | Data characteristics                            | Recommended chart         | Description                        |
| ---------- | ----------------------------------- | ---------------- | --------------------------- |
| Comparison analysis   | one categorical field + one numeric field         | bar              | bar chart, category comparison            |
| Trend analysis   | one time field + one numeric field         | line/area        | line/area chart, showing change trend |
| Proportion analysis   | one categorical field + one numeric field, categories ≤8 | pie              | pie chart, showing proportion distribution          |
| Proportion analysis   | one categorical field + one numeric field, categories >8 | bar              | bar chart is clearer when categories are too many    |
| Multi-dimension comparison | multiple numeric fields                        | radar            | radar chart, multi-dimension comparison          |
| Process conversion   | process stage data                        | funnel           | funnel chart, showing conversion rate          |
| Flow relation   | source/target/value fields            | sankey           | sankey chart, showing flow            |
| Hierarchical proportion   | hierarchical structure data                        | treemap/sunburst | treemap/sunburst chart             |

### 3. Field Selection Rules

**xField selection rules:**

- Comparison analysis: select a categorical field (such as unit, category, name)
- Trend analysis: select a time field (such as date, month, year)
- Proportion analysis: select a categorical field
- **Must use field names that actually exist in the data; do not guess or use generic names**

**yField selection rules:**

- Must select a numeric field
- Select the core numeric metric the user cares about
- If there are multiple numeric fields, select the one mentioned in the question or the most important one
- **Must use field names that actually exist in the data; do not guess or use generic names**

**Common field naming conventions (for recognizing field semantics):**

| Field type | Common naming                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Numeric field | headcount, amount, quantity, proportion, percentage, rate, value, count, amount, value, rate, sum, avg, total, GDP, revenue, expenditure |
| Categorical field | unit, name, category, type, department, college, region, province, city, name, category, type, dept, region, product, project |
| Time field | date, time, year, month, day, quarter, week, date, time, year, month, quarter, statistics month, year                   |
| Hierarchical field | name, label, category, stage, children (tree/hierarchical data)                                              |
| Flow field | source, target, value, nodes, links (sankey chart data)                                                    |

**title selection rules:**

- Extract the core topic from the user question
- Format: "{core content}{analysis type}"
- Examples:
  - User asks "headcount comparison across units" → title: "Headcount Comparison Across Units"
  - User asks "visualize the distribution data" → title: "{data core content} distribution"
  - User asks "sales amount trend" → title: "Sales Amount Trend"
- Do not include meaningless words: "one", "this", "a bit", "present", "display"

### 4. Data Preprocessing Rules

**Detail and summary row rules:**

- When comparing, ranking, trending, or computing proportions for detail objects such as "each street, each department, each region", only display detail rows at the same granularity as `xField`.
- When data contains both detail rows and summary statistical rows, and the user intent is to compare detail objects, the LLM identifies the summary rows based on data semantics and passes the corresponding `xField` values completely into `excludeCategoryValues`.
- Even if the summary row's `yField` is a valid numeric value, it cannot be mixed with detail categories such as street, department, or region; these values can be used for textual conclusions, but do not enter the chart's category axis.
- `excludeCategoryValues` only does exact matching, and does not use keyword or regex inference. For example: `excludeCategoryValues: ["compliant township count", "non-compliant township count"]`.
- When not passed or an empty array is passed, all data is kept, avoiding accidental filtering of other types of data.
- Filtering must occur before sorting and `topN`, to avoid summary rows occupying detail slots.

**Sorting rules:**

- When the data volume is large (>15 rows), recommend sorting by yField in descending order and taking the top 10 rows
- Settings: sortBy="yField", sortOrder="desc", topN=10
- Purpose: highlight key data and avoid chart crowding

**topN rules:**

- Bar chart: when data volume > 15, recommend setting topN=10 or topN=15
- Pie chart: category count recommended ≤ 8; when exceeded, switch to a bar chart or set topN

**Long text handling:**

- When axis labels are too long (exceeding 8 characters), automatically truncate with an ellipsis
- Purpose: ensure overall chart rendering quality, avoid label overlap or overflow
- The complete content still shows in the tooltip

### 5. Special Chart Data Formats

#### Radar chart (radar)

The data format needs to contain indicators and values:

```json
{
  "indicators": [{ "name": "indicator name", "max": 100 }],
  "values": [{ "name": "series name", "value": [80, 90] }]
}
```

#### Gauge chart (gauge)

Data format:

```json
{ "value": 75, "max": 100, "name": "completion rate" }
```

#### Heatmap (heatmap)

Supports two formats:

1. Structured: `{xAxis: [...], yAxis: [...], data: [[x,y,value]]}`
2. Array: `[{x, y, value}]` - needs to specify xField and yField

#### Funnel chart (funnel)

- xField: stage name field
- yField: numeric field
- Supported field names: name, stage, label, value, count, amount

#### Treemap/sunburst (treemap/sunburst)

Hierarchical structure data:

```json
{
  "children": [
    {"name": "category", "value": 100, "children": [...]}
  ]
}
```

Or array format: `[{name, value, children}]`

#### Sankey chart (sankey)

```json
{
  "nodes": [{ "name": "node name" }],
  "links": [{ "source": "source node", "target": "target node", "value": 100 }]
}
```

### 6. Configuration Examples

#### Example 1: comparison analysis

User question: headcount comparison across units
Data: [{faculty affiliation unit: "School of Computer Science", current staff headcount: 50}, ...]

Recommended configuration:

```json
{
  "chartType": "bar",
  "xField": "faculty affiliation unit",
  "yField": "current staff headcount",
  "title": "Current Staff Headcount Comparison Across Units",
  "sortBy": "yField",
  "sortOrder": "desc",
  "topN": 10
}
```

#### Example 2: trend analysis

User question: monthly sales amount trend
Data: [{month: "2024-01", sales amount: 100000}, {month: "2024-02", sales amount: 120000}, ...]

Recommended configuration:

```json
{
  "chartType": "line",
  "xField": "month",
  "yField": "sales amount",
  "title": "Monthly Sales Amount Trend"
}
```

#### Example 3: proportion analysis

User question: product category proportion
Data: [{product category: "electronics", proportion: 35}, {product category: "clothing", proportion: 25}, ...], 5 rows total

Recommended configuration:

```json
{
  "chartType": "pie",
  "xField": "product category",
  "yField": "proportion",
  "title": "Product Category Proportion Distribution"
}
```

## Output Format

```json
{
  "html": "the complete rendered HTML page",
  "meta": {
    "skillId": "echarts",
    "chartType": "the actually rendered chart type",
    "title": "chart title",
    "dataRows": "rendered data row count",
    "originalRows": "original data row count",
    "excludedCategoryRows": "exactly excluded category data row count",
    "excludedCategoryValues": "actually excluded category values (deduplicated)"
  }
}
```
