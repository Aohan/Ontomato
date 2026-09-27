---
name: trend-forecaster
description: 业务指标趋势预测技能。用于预测业务指标（如销售额、用户数、收入等）的未来走势。当用户需要基于历史数据预测未来趋势、进行业务规划或做决策支持时使用此技能。支持多种预测模型，包括ARIMA、Prophet、指数平滑和线性回归。
---

# Trend Forecaster

业务指标趋势预测技能，基于历史数据预测未来走势。

## 适用场景

- 销售预测：预测未来销售额、订单量
- 用户增长：预测新增用户、活跃用户数
- 收入预测：预测月度/季度收入
- 业务规划：为业务决策提供数据支持
- KPI预警：监控指标异常趋势

## 支持的模型

| 模型 | 说明 | 适用场景 |
|------|------|----------|
| `arima` | 自回归差分移动平均模型 | 常规时间序列，有季节性 |
| `prophet` | Facebook Prophet模型 | 有强季节性、节假日效应 |
| `exp_smoothing` | 指数平滑模型 | 短期预测，数据平滑 |
| `linear_regression` | 线性回归 | 简单趋势预测 |

## 输入格式

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

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 预测模型：`arima`, `prophet`, `exp_smoothing`, `linear_regression` |
| `data` | array | 是 | 历史数据，数组元素需包含 `date` 和 `value` 字段 |
| `periods` | int | 是 | 预测周期数 |
| `confidence` | float | 否 | 置信度，0-1之间，默认0.95 |
| `seasonality` | string | 否 | 季节性模式：`auto`, `daily`, `weekly`, `monthly`, `quarterly` |

## 输出格式

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

### 输出字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | 是否成功 |
| `predictions` | array | 预测结果数组 |
| `confidence_interval.lower` | array | 置信区间下限 |
| `confidence_interval.upper` | array | 置信区间上限 |
| `metrics.mae` | float | 平均绝对误差 |
| `metrics.rmse` | float | 均方根误差 |
| `metrics.mape` | string | 平均绝对百分比误差 |
| `model` | string | 使用的模型 |
| `training_period` | string | 训练数据时间范围 |
| `forecast_period` | string | 预测时间范围 |

## 使用示例

### 命令行调用

```bash
# 方式1：直接传JSON字符串
python scripts/forecaster.py -d '{"model": "prophet", "data": [{"date": "2024-01-01", "value": 1000}, {"date": "2024-02-01", "value": 1150}, {"date": "2024-03-01", "value": 1080}], "periods": 3, "confidence": 0.95, "seasonality": "monthly"}'

# 方式2：从JSON文件读取
python scripts/forecaster.py -f input.json
```

### 参数说明

| 参数 | 简写 | 必填 | 说明 |
|------|------|------|------|
| `--data` | `-d` | 是 | JSON 字符串输入 |
| `--file` | `-f` | 是 | JSON 文件路径 |

## 错误处理

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `INVALID_MODEL` | 不支持的模型 | 检查model参数是否正确 |
| `INVALID_DATA` | 数据格式错误 | 确保data包含date和value字段 |
| `INSUFFICIENT_DATA` | 数据不足 | 至少需要3个数据点 |
| `MODEL_ERROR` | 模型执行错误 | 检查数据是否满足模型要求 |
| `DATE_PARSE_ERROR` | 日期解析错误 | 使用标准日期格式YYYY-MM-DD |

## 数据要求

- **最小数据量**：至少需要3个历史数据点
- **日期格式**：支持 `YYYY-MM-DD`, `YYYY-MM`, `YYYY-MM-DD HH:MM:SS`
- **数值要求**：value必须为数值类型，不能为空或NaN
- **数据频率**：支持日、周、月、季度数据

## 依赖安装

```bash
pip install pandas numpy statsmodels prophet scikit-learn
```

## 注意事项

1. Prophet模型需要较长的训练时间，数据量大时可能需要更久
2. ARIMA模型对数据平稳性有要求，非平稳数据会自动差分
3. 线性回归适合有明显线性趋势的数据
4. 指数平滑适合短期预测，对噪声敏感