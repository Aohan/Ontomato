---
name: growth-rate-calc
description: Compute year-over-year and month-over-month growth rates for data, suitable for time series data analysis.
type: executable
category: analysis
title: Year-over-year and month-over-month calculation
tags:
  - year-over-year
  - month-over-month
  - growth rate
  - calculation
useCases:
  - year-over-year growth analysis
  - month-over-month growth analysis
  - trend calculation
timeout: 5000
outputType: json
version: 1.0.0
entries:
  - scripts/index.mjs
---
## Year-over-year and month-over-month calculation skill

Compute the year-over-year and month-over-month growth rates of data.

## Applicable Scenarios

- User questions contain keywords such as "year-over-year", "month-over-month", "growth rate", "comparison", "change"
- Growth analysis of time series data
- Need to analyze data change trends

## Input Parameters

When calling this skill, the following parameters may be provided:

| Parameter  | Required | Description                                       |
| ---------- | ---- | ------------------------------------------ |
| data       | Yes  | Data array, each row is an object           |
| timeField  | No   | Time field name; when not provided, the skill recognizes it by field characteristics |
| valueField | No   | Value field name; when not provided, recognized by combining the question and field characteristics |

## Field Recognition Rules

### Time Field Recognition

**Characteristics:**

- JavaScript type is `string`
- Field name contains keywords: time, date, month, year, quarter, week, date, time, month, year, quarter, period
- Field value formats: YYYY-MM-DD, YYYY-MM, MM, Nth quarter, YYYY

**Selection priority:**

1. Fields clearly containing "time", "date"
2. Fields containing "month", "year", "quarter"
3. Fields whose values can be sorted in time order

**Examples:**

- Data: [{statistics month: "2024-01", sales amount: 100}, ...] → timeField: "statistics month"
- Data: [{year: "2024", GDP: 12}, ...] → timeField: "year"
- Data: [{date: "2024-01-01", value: 50}, ...] → timeField: "date"

### Value Field Recognition

**Characteristics:**

- JavaScript type is `number`
- Field name contains keywords: value, quantity, amount, sales amount, revenue, amount, count, value, amount, sales, revenue, GDP, headcount
- Field values can undergo mathematical operations

**Selection priority:**

1. Fields clearly containing "sales amount", "amount", "revenue"
2. Fields containing "value", "quantity", "headcount"
3. The value metric explicitly mentioned in the user question

**Examples:**

- User asks "sales amount growth rate" → valueField: "sales amount"
- User asks "GDP year-over-year change" → valueField: "GDP"
- User asks "headcount month-over-month" → valueField: "current staff headcount"

## Calculation Rules

### Month-over-month calculation

**Definition**: compared to the previous period

**Formula**:
$$Month-over-month\ growth\ rate = \frac{current\ value - previous\ value}{previous\ value} \times 100\%$$

**Rules:**

- The first period has no month-over-month value (returns null)
- Returns null when the previous value is 0 (to avoid infinity)
- Results keep two decimal places

### Year-over-year calculation

**Definition**: compared to the same period last year

**Formula**:
$$Year-over-year\ growth\ rate = \frac{current\ value - same\ period\ last\ year\ value}{same\ period\ last\ year\ value} \times 100\%$$

**Rules:**

- Year-over-year returns null when data has fewer than 12 periods
- Returns null when the same-period-last-year value is 0
- Results keep two decimal places

### Sorting Rules

- Data must be sorted by timeField in ascending order before calculation
- Sorting uses string localeCompare

## Output Format

```json
{
  "success": true,
  "timeField": "statistics month",
  "valueField": "sales amount",
  "results": [
    {
      "period": "2024-01",
      "value": 100,
      "momGrowth": null,
      "yoyGrowth": null
    },
    {
      "period": "2024-02",
      "value": 120,
      "momGrowth": 20.0,
      "yoyGrowth": null
    }
  ],
  "summary": {
    "totalPeriods": 24,
    "totalGrowth": 50.0,
    "avgValue": 110,
    "maxValue": 150,
    "minValue": 80
  }
}
```

## Configuration Examples

### Example 1: sales amount month-over-month analysis

User question: compute the sales amount month-over-month growth rate
Data: [{month: "2024-01", sales amount: 100}, {month: "2024-02", sales amount: 120}, ...]

Recommended configuration:

```json
{
  "timeField": "month",
  "valueField": "sales amount"
}
```

### Example 2: GDP year-over-year analysis

User question: analyze the GDP year-over-year change
Data: [{year: "2023", GDP: 10000}, {year: "2024", GDP: 12000}]

Recommended configuration:

```json
{
  "timeField": "year",
  "valueField": "GDP"
}
```

### Example 3: headcount growth analysis

User question: faculty/staff headcount growth situation
Data: [{statistics date: "2024-01", current staff headcount: 50}, ...]

Recommended configuration:

```json
{
  "timeField": "statistics date",
  "valueField": "current staff headcount"
}
```
