"""
IntelliWMS Agent System Integration Client.

Provides both direct in-memory prediction and HTTP API client helpers
so that IntelliWMS Inventory Specialist Agent or Coordinator Agent can easily
consume 7-day demand forecasts and replenishment recommendations.
"""

from typing import Any, Dict, Optional
import httpx

import sys
from pathlib import Path

_ML_MODEL_DIR = Path(__file__).resolve().parent
if str(_ML_MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_MODEL_DIR))

try:
    from app import (
        DemandPredictionRequest,
        compute_prediction_and_inventory,
        load_assets,
        app_state,
    )
    DIRECT_IMPORT_AVAILABLE = True
except ImportError:
    try:
        from ML_MODEL.app import (
            DemandPredictionRequest,
            compute_prediction_and_inventory,
            load_assets,
            app_state,
        )
        DIRECT_IMPORT_AVAILABLE = True
    except ImportError:
        DIRECT_IMPORT_AVAILABLE = False



def predict_sku_demand(
    sku: str,
    category: str,
    size: str,
    current_stock: int,
    lead_time_days: int = 3,
    sales_last_7d: float = 14.0,
    sales_last_14d: float = 28.0,
    sales_lag_1: float = 2.0,
    zero_days_last_14d: float = 3.0,
    api_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Unified function for IntelliWMS agents to get demand forecast and replenishment advice.
    If api_url is provided, calls the HTTP API.
    Otherwise, computes directly in-process for low latency if the model is loaded.
    """
    payload = {
        "sku": sku,
        "category": category,
        "size": size,
        "current_stock": current_stock,
        "lead_time_days": lead_time_days,
        "sales_last_7d": sales_last_7d,
        "sales_last_14d": sales_last_14d,
        "sales_lag_1": sales_lag_1,
        "zero_days_last_14d": zero_days_last_14d,
    }

    if api_url:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{api_url.rstrip('/')}/api/predict", json=payload)
            resp.raise_for_status()
            return resp.json()

    if DIRECT_IMPORT_AVAILABLE:
        if app_state["model"] is None:
            load_assets()
        req = DemandPredictionRequest(**payload)
        return compute_prediction_and_inventory(req)

    # Fallback to default local endpoint
    with httpx.Client(timeout=5.0) as client:
        resp = client.post("http://127.0.0.1:8000/api/predict", json=payload)
        resp.raise_for_status()
        return resp.json()
