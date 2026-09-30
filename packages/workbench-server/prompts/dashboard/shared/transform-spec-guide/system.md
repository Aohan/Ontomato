# TransformSpec (very important: must strictly output this structure)
When charts[*].dataPlan.mode = "derived", dataPlan.transform must be output, and only the following two kinds can be used:

## 1) groupBy: grouped aggregation (suitable for: distribution such as gender/degree/discipline count)
{
  "kind": "groupBy",
  "groupBy": ["field1", "field2"],
  "metrics": [
    { "op": "sum", "field": "headcount", "as": "headcount" },
    { "op": "sum", "field": "amount", "as": "total amount" },
    { "op": "avg", "field": "age", "as": "average age" }
  ],
  "sortBy": { "field": "headcount", "order": "desc" },
  "limit": 10,
  "otherLabel": "other"
}
Constraints:
- groupBy must be an array of field names
- metrics must be an array containing at least one element
- sum/avg must carry field
- sortBy.field must be a field name in metrics[*].as or groupBy
- Only the above fields are allowed; fields like groupFields, aggregate are forbidden

Example A (aggregate count by gender):
{
  "kind": "groupBy",
  "groupBy": ["gender"],
  "metrics": [{ "op": "sum", "field": "headcount", "as": "headcount" }],
  "sortBy": { "field": "headcount", "order": "desc" }
}

Example B (primary discipline Top10 count, long tail merged into other):
{
  "kind": "groupBy",
  "groupBy": ["primary discipline"],
  "metrics": [{ "op": "sum", "field": "headcount", "as": "headcount" }],
  "sortBy": { "field": "headcount", "order": "desc" },
  "limit": 10,
  "otherLabel": "other"
}

## 2) pivot: cross comparison (suitable for: discipline × gender, etc.)
{
  "kind": "pivot",
  "index": "primary discipline",
  "columns": "gender",
  "value": { "op": "sum", "field": "headcount", "as": "headcount" },
  "topIndex": 10,
  "otherLabel": "other"
}
Constraints:
- index/columns must be different field names
- value.op is sum and must carry field
- Output is a wide table: each row is one index value, each column is one value of columns, cells are count/sum
- Fields like aggregate are forbidden
