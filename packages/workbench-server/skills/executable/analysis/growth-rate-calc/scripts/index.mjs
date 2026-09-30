export async function execute(input) {
  const { data, query = "" } = input;

  if (!data || data.length === 0) {
    return {
      json: { success: false, error: "Data is empty", results: [] },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  const fields = Object.keys(data[0] || {});
  let { timeField, valueField } = input;
  timeField ||= inferTimeField(fields, data);
  valueField ||= inferValueField(fields, data, timeField, query);

  if (!timeField || !valueField) {
    return {
      json: {
        success: false,
        error: "Missing required parameters: timeField, valueField",
        results: [],
        missingParams: { timeField, valueField },
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  if (!fields.includes(timeField)) {
    return {
      json: {
        success: false,
        error: `Time field "${timeField}" does not exist in data`,
        results: [],
        availableFields: fields,
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  if (!fields.includes(valueField)) {
    return {
      json: {
        success: false,
        error: `Value field "${valueField}" does not exist in data`,
        results: [],
        availableFields: fields,
      },
      meta: { skillId: "growth-rate-calc" },
    };
  }

  console.log(
    `[growth-rate-calc] timeField=${timeField}, valueField=${valueField}, rows=${data.length}`
  );

  const sortedData = [...data].sort((a, b) => {
    const aTime = String(a[timeField] || "");
    const bTime = String(b[timeField] || "");
    return aTime.localeCompare(bTime);
  });

  const results = sortedData.map((current, index) => {
    const currentValue = Number(current[valueField]) || 0;
    const period = String(current[timeField] || `Period ${index + 1}`);

    let momGrowth = null;
    if (index > 0) {
      const prevValue = Number(sortedData[index - 1][valueField]) || 0;
      if (prevValue !== 0) {
        momGrowth = (currentValue - prevValue) / prevValue;
        momGrowth = Math.round(momGrowth * 10000) / 100;
      }
    }

    let yoyGrowth = null;
    if (index >= 12) {
      const lastYearValue = Number(sortedData[index - 12][valueField]) || 0;
      if (lastYearValue !== 0) {
        yoyGrowth = (currentValue - lastYearValue) / lastYearValue;
        yoyGrowth = Math.round(yoyGrowth * 10000) / 100;
      }
    }

    return { period, value: currentValue, momGrowth, yoyGrowth };
  });

  const values = sortedData.map((d) => Number(d[valueField]) || 0);
  const totalGrowth =
    values.length > 1 && values[0] !== 0
      ? Math.round(((values[values.length - 1] - values[0]) / values[0]) * 10000) / 100
      : null;

  return {
    json: {
      success: true,
      timeField,
      valueField,
      results,
      summary: {
        totalPeriods: sortedData.length,
        totalGrowth,
        avgValue: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
        maxValue: Math.max(...values),
        minValue: Math.min(...values),
      },
    },
    meta: {
      skillId: "growth-rate-calc",
      timeField,
      valueField,
      resultCount: results.length,
    },
  };
}

function inferTimeField(fields, data) {
  const namedField = fields.find((field) =>
    /(^|_)(time|date|year|month|day|quarter|period|week)(_|$)|time|date|year|quarter|month|week/i.test(field)
  );
  if (namedField) return namedField;

  return fields.find((field) =>
    data
      .slice(0, 5)
      .some((row) => typeof row[field] === "string" && Number.isNaN(Number(row[field])))
  );
}

function inferValueField(fields, data, timeField, query) {
  const numericFields = fields.filter(
    (field) =>
      field !== timeField &&
      data
        .slice(0, 5)
        .some(
          (row) => row[field] !== null && row[field] !== "" && Number.isFinite(Number(row[field]))
        )
  );
  const normalizedQuery = String(query).toLowerCase();
  return (
    numericFields.find((field) => normalizedQuery.includes(field.toLowerCase())) ||
    numericFields.find((field) =>
      /sales amount|revenue|amount|quantity|headcount|count|value|amount|sales|revenue|gdp/i.test(field)
    ) ||
    numericFields[0]
  );
}
