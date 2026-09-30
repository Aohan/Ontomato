import json
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple
from datetime import datetime, timedelta

try:
    from statsmodels.tsa.arima.model import ARIMA
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    STATSMODELS_AVAILABLE = True
except ImportError:
    STATSMODELS_AVAILABLE = False
    ARIMA = None
    ExponentialSmoothing = None

try:
    from prophet import Prophet

    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False
    Prophet = None

from validator import DataValidator


class TrendForecaster:
    def __init__(self):
        self.validator = DataValidator()
        self.model = None
        self.df = None
        self.freq = None

    def predict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        validation = self.validator.validate_input(data)

        if not validation["valid"]:
            return {
                "success": False,
                "error": validation["errors"][0],
                "errors": validation["errors"],
            }

        try:
            model_name = data.get("model", "prophet")
            periods = data.get("periods", 1)
            confidence = data.get("confidence", 0.95)
            seasonality = data.get("seasonality", "auto")

            df = self.validator.parse_dates(data["data"])
            self.df = df
            self.freq = self.validator.infer_frequency(df)

            train_size = int(len(df) * 0.8)
            train_df = df.iloc[:train_size]
            test_df = df.iloc[train_size:]

            if model_name == "arima":
                result = self._arima_forecast(train_df, test_df, periods, confidence)
            elif model_name == "prophet":
                result = self._prophet_forecast(
                    train_df, test_df, periods, confidence, seasonality
                )
            elif model_name == "exp_smoothing":
                result = self._exp_smoothing_forecast(
                    train_df, test_df, periods, confidence
                )
            elif model_name == "linear_regression":
                result = self._linear_regression_forecast(
                    train_df, test_df, periods, confidence
                )
            else:
                return {"success": False, "error": f"Unsupported model: {model_name}"}

            result["training_period"] = (
                f"{df['date'].min().strftime('%Y-%m-%d')} to {df['date'].max().strftime('%Y-%m-%d')}"
            )

            last_date = df["date"].max()
            if self.freq == "D":
                forecast_dates = pd.date_range(
                    last_date + timedelta(days=1), periods=periods, freq="D"
                )
            elif self.freq == "W":
                forecast_dates = pd.date_range(
                    last_date + timedelta(weeks=1), periods=periods, freq="W"
                )
            elif self.freq == "M":
                forecast_dates = pd.date_range(
                    last_date + timedelta(days=32), periods=periods, freq="ME"
                )
            elif self.freq == "Q":
                forecast_dates = pd.date_range(
                    last_date + timedelta(days=93), periods=periods, freq="QE"
                )
            else:
                forecast_dates = pd.date_range(
                    last_date + timedelta(days=365), periods=periods, freq="YE"
                )

            result["forecast_period"] = (
                f"{forecast_dates[0].strftime('%Y-%m-%d')} to {forecast_dates[-1].strftime('%Y-%m-%d')}"
            )
            result["success"] = True

            return result

        except Exception as e:
            return {"success": False, "error": f"MODEL_ERROR: {str(e)}"}

    def _arima_forecast(
        self,
        train_df: pd.DataFrame,
        test_df: pd.DataFrame,
        periods: int,
        confidence: float,
    ) -> Dict[str, Any]:
        if not STATSMODELS_AVAILABLE:
            raise Exception(
                "statsmodels is not installed. Install with: pip install statsmodels"
            )

        try:
            y = train_df["value"].values

            model = ARIMA(y, order=(1, 1, 1))
            fitted = model.fit()

            forecast = fitted.forecast(steps=periods)

            se = np.std(train_df["value"].values) * np.sqrt(
                np.arange(1, periods + 1) / len(train_df)
            )
            z = 1.96 if confidence == 0.95 else 2.576

            lower = forecast - z * se
            upper = forecast + z * se

            predictions = [
                {
                    "date": (
                        train_df["date"].max() + timedelta(days=30 * (i + 1))
                    ).strftime("%Y-%m-%d"),
                    "value": round(float(v), 2),
                }
                for i, v in enumerate(forecast)
            ]

            metrics = self._calculate_metrics(
                test_df["value"].values, forecast[: len(test_df)]
            )

            return {
                "predictions": predictions,
                "confidence_interval": {
                    "lower": [round(float(v), 2) for v in lower],
                    "upper": [round(float(v), 2) for v in upper],
                },
                "metrics": metrics,
                "model": "arima",
            }
        except Exception as e:
            raise Exception(f"ARIMA forecast failed: {str(e)}")

    def _prophet_forecast(
        self,
        train_df: pd.DataFrame,
        test_df: pd.DataFrame,
        periods: int,
        confidence: float,
        seasonality: str,
    ) -> Dict[str, Any]:
        if not PROPHET_AVAILABLE:
            raise Exception(
                "Prophet is not installed. Install with: pip install prophet"
            )

        try:
            prophet_df = train_df.rename(columns={"date": "ds", "value": "y"})

            freq_map = {
                "daily": "D",
                "weekly": "W",
                "monthly": "MS",
                "quarterly": "QS",
                "auto": self.freq,
            }
            freq = freq_map.get(seasonality, "MS")

            model = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=True,
                daily_seasonality=False,
            )
            model.fit(prophet_df)

            future = model.make_future_dataframe(periods=periods, freq=freq)
            forecast = model.predict(future)

            last_train_date = train_df["date"].max()
            future_forecast = forecast[forecast["ds"] > last_train_date].head(periods)

            predictions = [
                {
                    "date": row["ds"].strftime("%Y-%m-%d"),
                    "value": round(float(row["yhat"]), 2),
                }
                for _, row in future_forecast.iterrows()
            ]

            lower_col = f"yhat_lower" if confidence == 0.95 else "yhat_lower"
            upper_col = f"yhat_upper" if confidence == 0.95 else "yhat_upper"

            metrics = self._calculate_metrics(
                test_df["value"].values, future_forecast["yhat"].values[: len(test_df)]
            )

            return {
                "predictions": predictions,
                "confidence_interval": {
                    "lower": [
                        round(float(v), 2) for v in future_forecast[lower_col].values
                    ],
                    "upper": [
                        round(float(v), 2) for v in future_forecast[upper_col].values
                    ],
                },
                "metrics": metrics,
                "model": "prophet",
            }
        except Exception as e:
            raise Exception(f"Prophet forecast failed: {str(e)}")

    def _exp_smoothing_forecast(
        self,
        train_df: pd.DataFrame,
        test_df: pd.DataFrame,
        periods: int,
        confidence: float,
    ) -> Dict[str, Any]:
        if not STATSMODELS_AVAILABLE:
            raise Exception(
                "statsmodels is not installed. Install with: pip install statsmodels"
            )

        try:
            y = train_df["value"].values

            seasonal_periods = (
                12 if self.freq == "M" else (4 if self.freq == "Q" else 1)
            )

            if seasonal_periods > 1:
                model = ExponentialSmoothing(
                    y,
                    seasonal_periods=seasonal_periods,
                    trend="add",
                    seasonal="add",
                    damped_trend=True,
                )
            else:
                model = ExponentialSmoothing(y, trend="add", damped_trend=True)

            fitted = model.fit()
            forecast = fitted.forecast(periods)

            se = np.std(train_df["value"].values) * np.sqrt(
                np.arange(1, periods + 1) / len(train_df)
            )
            z = 1.96 if confidence == 0.95 else 2.576

            lower = forecast - z * se
            upper = forecast + z * se

            predictions = [
                {
                    "date": (
                        train_df["date"].max() + timedelta(days=30 * (i + 1))
                    ).strftime("%Y-%m-%d"),
                    "value": round(float(v), 2),
                }
                for i, v in enumerate(forecast)
            ]

            metrics = self._calculate_metrics(
                test_df["value"].values, forecast[: len(test_df)]
            )

            return {
                "predictions": predictions,
                "confidence_interval": {
                    "lower": [round(float(v), 2) for v in lower],
                    "upper": [round(float(v), 2) for v in upper],
                },
                "metrics": metrics,
                "model": "exp_smoothing",
            }
        except Exception as e:
            raise Exception(f"Exponential Smoothing forecast failed: {str(e)}")

    def _linear_regression_forecast(
        self,
        train_df: pd.DataFrame,
        test_df: pd.DataFrame,
        periods: int,
        confidence: float,
    ) -> Dict[str, Any]:
        try:
            train_df = train_df.copy()
            train_df["t"] = range(len(train_df))

            X_train = train_df[["t"]].values
            y_train = train_df["value"].values

            slope = (y_train[-1] - y_train[0]) / len(y_train)
            intercept = y_train[0]

            future_t = np.arange(len(train_df), len(train_df) + periods)
            forecast = intercept + slope * future_t

            residuals = y_train - (intercept + slope * train_df["t"].values)
            se = np.std(residuals) * np.sqrt(
                1 / len(y_train)
                + (future_t - np.mean(train_df["t"].values)) ** 2
                / np.sum((train_df["t"].values - np.mean(train_df["t"].values)) ** 2)
            )
            z = 1.96 if confidence == 0.95 else 2.576

            lower = forecast - z * se
            upper = forecast + z * se

            predictions = [
                {
                    "date": (
                        train_df["date"].max() + timedelta(days=30 * (i + 1))
                    ).strftime("%Y-%m-%d"),
                    "value": round(float(v), 2),
                }
                for i, v in enumerate(forecast)
            ]

            test_t = np.arange(len(train_df), len(train_df) + len(test_df))
            expected_test = intercept + slope * test_t
            metrics = self._calculate_metrics(test_df["value"].values, expected_test)

            return {
                "predictions": predictions,
                "confidence_interval": {
                    "lower": [round(float(v), 2) for v in lower],
                    "upper": [round(float(v), 2) for v in upper],
                },
                "metrics": metrics,
                "model": "linear_regression",
            }
        except Exception as e:
            raise Exception(f"Linear Regression forecast failed: {str(e)}")

    def _calculate_metrics(
        self, actual: np.ndarray, predicted: np.ndarray
    ) -> Dict[str, Any]:
        if len(actual) == 0:
            return {"mae": 0, "rmse": 0, "mape": "0%"}

        actual = np.array(actual)
        predicted = np.array(predicted)[: len(actual)]

        mae = np.mean(np.abs(actual - predicted))
        rmse = np.sqrt(np.mean((actual - predicted) ** 2))

        mask = actual != 0
        if np.any(mask):
            mape = (
                np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100
            )
        else:
            mape = 0

        return {
            "mae": round(float(mae), 2),
            "rmse": round(float(rmse), 2),
            "mape": f"{round(float(mape), 1)}%",
        }


if __name__ == "__main__":
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description="Trend Forecaster CLI", formatter_class=argparse.RawDescriptionHelpFormatter, 
                                     epilog="""
Examples:
  python forecaster.py -d '{"model": "linear_regression", "data": [{"date": "2024-01-01", "value": 100}], "periods": 6}'
  python forecaster.py -f input.json

Input JSON format:
{
  "model": "prophet|arima|exp_smoothing|linear_regression",
  "data": [{"date": "YYYY-MM-DD", "value": number}],
  "periods": number,
  "confidence": 0.95,
  "seasonality": "auto|daily|weekly|monthly|quarterly"
}
""")
    parser.add_argument("--data", "-d", type=str, help="JSON string with input data")
    parser.add_argument("--file", "-f", type=str, help="Path to JSON file with input data")
    
    args = parser.parse_args()
    
    if not args.data and not args.file:
        parser.print_help()
        print("\nError: Please provide input data using -d or -f option")
        sys.exit(1)
    
    if args.file:
        try:
            with open(args.file, "r") as f:
                input_data = json.load(f)
        except FileNotFoundError:
            print(f"Error: File not found: {args.file}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in file: {e}")
            sys.exit(1)
    else:
        try:
            input_data = json.loads(args.data)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON: {e}")
            sys.exit(1)

    forecaster = TrendForecaster()
    result = forecaster.predict(input_data)
    print(json.dumps(result, indent=2, ensure_ascii=False))
