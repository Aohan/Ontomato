import pandas as pd
from typing import Dict, List, Any


class DataValidator:
    @staticmethod
    def validate_input(data: Dict[str, Any]) -> Dict[str, Any]:
        errors = []
        
        if "model" not in data:
            errors.append("Missing required parameter: model")
        elif data["model"] not in ["arima", "prophet", "exp_smoothing", "linear_regression"]:
            errors.append(f"Invalid model: {data['model']}. Supported: arima, prophet, exp_smoothing, linear_regression")
        
        if "data" not in data:
            errors.append("Missing required parameter: data")
        else:
            data_errors = DataValidator._validate_data_array(data["data"])
            errors.extend(data_errors)
        
        if "periods" not in data:
            errors.append("Missing required parameter: periods")
        elif not isinstance(data["periods"], int) or data["periods"] <= 0:
            errors.append("periods must be a positive integer")
        
        if "confidence" in data:
            if not isinstance(data["confidence"], (int, float)) or not (0 < data["confidence"] <= 1):
                errors.append("confidence must be between 0 and 1")
        
        if "seasonality" in data:
            if data["seasonality"] not in ["auto", "daily", "weekly", "monthly", "quarterly"]:
                errors.append("Invalid seasonality. Supported: auto, daily, weekly, monthly, quarterly")
        
        if errors:
            return {"valid": False, "errors": errors}
        
        return {"valid": True, "errors": []}
    
    @staticmethod
    def _validate_data_array(data: List[Dict]) -> List[str]:
        errors = []
        
        if not isinstance(data, list):
            errors.append("data must be an array")
            return errors
        
        if len(data) < 3:
            errors.append("INSUFFICIENT_DATA: At least 3 data points required")
            return errors
        
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                errors.append(f"Data item {i} must be an object")
                continue
            
            if "date" not in item:
                errors.append(f"Data item {i} missing required field: date")
            
            if "value" not in item:
                errors.append(f"Data item {i} missing required field: value")
            elif not isinstance(item["value"], (int, float)):
                errors.append(f"Data item {i} value must be a number")
            elif pd.isna(item["value"]):
                errors.append(f"Data item {i} value cannot be NaN")
        
        return errors
    
    @staticmethod
    def parse_dates(data: List[Dict]) -> pd.DataFrame:
        df = pd.DataFrame(data)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)
        return df
    
    @staticmethod
    def infer_frequency(df: pd.DataFrame) -> str:
        if len(df) < 2:
            return "D"
        
        diffs = df["date"].diff().dropna()
        if len(diffs) == 0:
            return "D"
        
        median_diff = diffs.median()
        days = median_diff.days
        
        if days <= 1:
            return "D"
        elif days <= 7:
            return "W"
        elif days <= 31:
            return "M"
        elif days <= 93:
            return "Q"
        else:
            return "Y"