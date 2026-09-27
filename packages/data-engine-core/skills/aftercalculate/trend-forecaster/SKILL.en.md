---
name: trend-forecaster
description: Business metric trend forecasting skill. Used to forecast the future trajectory of business metrics (such as sales, user count, revenue, etc.). Use this skill when the user needs to forecast future trends based on historical data, carry out business planning, or support decision-making. Supports multiple forecasting models, including ARIMA, Prophet, exponential smoothing, and linear regression.
---

# Trend Forecaster

Business metric trend forecasting skill that forecasts future trends based on historical data.

## Applicable scenarios

- Sales forecasting: forecast future sales and order volume
- User growth: forecast new users and active users
- Revenue forecasting: forecast monthly/quarterly revenue
- Business planning: provide data support for business decisions
- KPI alerting: monitor abnormal metric trends

## Supported models

| Model | Description | Applicable scenarios |
|------|------|----------|
| `arima` | Autoregressive integrated moving average model | Regular time series with seasonality |
| `prophet` | Facebook Prophet model | Strong seasonality and holiday effects |
| `exp_smoothing` | Exponential smoothing model | Short-term forecasting, smooth data |
| `linear_regression` | Linear regression | Simple trend forecasting |

## Input format

```json
{
  "model": "prophet",
  "data": [
    {"date": "2024-01-01", "value": 100},
    {"date": "2024-02-01", "value": 120},
    {"date": "2024-03-01", "value": 115}
  ],
  "periods": 6,
  "confidence": 0.95,
  "seasonality": "monthly"
}
```

### Parameter description

| Parameter | Type | Required | Description |
|------|------|------|------|
| `model` | string | Yes | Forecasting model: `arima`, `prophet`, `exp_smoothing`, `linear_regression` |
| `data` | array | Yes | Historical data; each array element must contain the `date` and `value` fields |
| `periods` | int | Yes | Number of forecast periods |
| `confidence` | float | No | Confidence level, between 0 and 1, default 0.95 |
| `seasonality` | string | No | Seasonality mode: `auto`, `daily`, `weekly`, `monthly`, `quarterly` |

## Output format

```json
{
  "success": true,
  "predictions": [
    {"date": "2024-04-01", "value": 130.5},
    {"date": "2024-05-01", "value": 140.2}
  ],
  "confidence_interval": {
    "lower": [125.0, 134.0],
    "upper": [136.0, 146.0]
  },
  "metrics": {
    "mae": 5.2,
    "rmse": 6.8,
    "mape": "4.3%"
  },
  "model": "prophet",
  "training_period": "2024-01-01 to 2024-03-01",
  "forecast_period": "2024-04-01 to 2024-09-01"
}
```

### Output field description

| Field | Type | Description |
|------|------|------|
| `success` | bool | Whether it succeeded |
| `predictions` | array | Array of forecast results |
| `confidence_interval.lower` | array | Lower bound of the confidence interval |
| `confidence_interval.upper` | array | Upper bound of the confidence interval |
| `metrics.mae` | float | Mean absolute error |
| `metrics.rmse` | float | Root mean squared error |
| `metrics.mape` | string | Mean absolute percentage error |
| `model` | string | The model used |
| `training_period` | string | Time range of the training data |
| `forecast_period` | string | Time range of the forecast |

## Usage examples

### Command-line invocation

```bash
# Option 1: pass the JSON string directly
python scripts/forecaster.py -d '{"model": "prophet", "data": [{"date": "2024-01-01", "value": 1000}, {"date": "2024-02-01", "value": 1150}, {"date": "2024-03-01", "value": 1080}], "periods": 3, "confidence": 0.95, "seasonality": "monthly"}'

# Option 2: read from a JSON file
python scripts/forecaster.py -f input.json
```

### Parameter description

| Parameter | Short | Required | Description |
|------|------|------|------|
| `--data` | `-d` | Yes | JSON string input |
| `--file` | `-f` | Yes | JSON file path |

## Error handling

| Error code | Description | Suggested handling |
|--------|------|----------|
| `INVALID_MODEL` | Unsupported model | Check whether the model parameter is correct |
| `INVALID_DATA` | Invalid data format | Make sure data contains the date and value fields |
| `INSUFFICIENT_DATA` | Insufficient data | At least 3 data points are required |
| `MODEL_ERROR` | Model execution error | Check whether the data meets the model requirements |
| `DATE_PARSE_ERROR` | Date parse error | Use the standard date format YYYY-MM-DD |

## Data requirements

- **Minimum data volume**: at least 3 historical data points are required
- **Date format**: supports `YYYY-MM-DD`, `YYYY-MM`, `YYYY-MM-DD HH:MM:SS`
- **Value requirement**: value must be numeric and must not be null or NaN
- **Data frequency**: supports daily, weekly, monthly, and quarterly data

## Dependency installation

```bash
pip install pandas numpy statsmodels prophet scikit-learn
```

## Notes

1. The Prophet model requires a long training time, and may take even longer when the data volume is large
2. The ARIMA model requires stationary data; non-stationary data is automatically differenced
3. Linear regression is suitable for data with an obvious linear trend
4. Exponential smoothing is suitable for short-term forecasting and is sensitive to noise