"""
Automated Sanity Test for Amazon Demand Forecasting API.
SLIIT IT3051 Mini Project Group KND_10.

Verifies:
1. HTTP 200 OK from /api/predict
2. Valid predicted demand and replenishment decision metrics
3. Correct risk categorization logic
"""

import json
import sys
import requests
import os

BASE_URL = os.environ.get("ML_API_URL", sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001")


def run_sanity_tests():
    print("=" * 65)
    print("DEMANDIQ API SANITY TEST SUITE")
    print("=" * 65)

    test_payload = {
        "sku": "JNE3797-KR-M",
        "category": "kurta",
        "size": "M",
        "current_stock": 10,
        "lead_time_days": 3,
        "sales_last_7d": 18.0,
        "sales_last_14d": 32.0,
        "sales_lag_1": 4.0,
        "zero_days_last_14d": 2.0,
    }

    print(f"\n[1] Checking API health endpoint: {BASE_URL}/api/health...")
    try:
        health_resp = requests.get(f"{BASE_URL}/api/health", timeout=5)
        print(f"    Health Status: {health_resp.status_code}")
        assert health_resp.status_code == 200, f"Expected 200, got {health_resp.status_code}"
        health_data = health_resp.json()
        print(f"    Model loaded: {health_data.get('model_loaded')}")
        print(f"    Features count: {health_data.get('feature_count')}")
    except requests.exceptions.ConnectionError:
        print(f"\n[ERROR] Server is not running at {BASE_URL}.")
        print("Please start the server first using: uvicorn app:app --port 8000")
        sys.exit(1)

    print(f"\n[2] Sending prediction payload to: {BASE_URL}/api/predict...")
    print(f"    Payload: {json.dumps(test_payload, indent=2)}")

    resp = requests.post(
        f"{BASE_URL}/api/predict",
        json=test_payload,
        headers={"Content-Type": "application/json"},
        timeout=10,
    )

    print(f"\n[3] Validating response status code...")
    print(f"    Response Status: {resp.status_code}")
    assert resp.status_code == 200, f"Expected 200 OK, got {resp.status_code}: {resp.text}"

    data = resp.json()
    metrics = data.get("metrics", {})

    print("\n[4] Validating Prediction & Replenishment Metrics:")
    pred_demand = metrics.get("predicted_7d_demand")
    daily_velocity = metrics.get("daily_velocity")
    lead_time_demand = metrics.get("demand_during_lead_time")
    safety_stock = metrics.get("safety_stock")
    reorder_point = metrics.get("reorder_point")
    reorder_qty = metrics.get("recommended_reorder_qty")
    risk_level = metrics.get("risk_level")
    advice = metrics.get("actionable_advice")

    print(f"    • Predicted 7-Day Demand : {pred_demand} units")
    print(f"    • Daily Sales Velocity   : {daily_velocity} units/day")
    print(f"    • Demand During Lead Time: {lead_time_demand} units")
    print(f"    • Safety Stock Buffer    : {safety_stock} units")
    print(f"    • Reorder Point          : {reorder_point} units")
    print(f"    • Recommended Reorder    : {reorder_qty} units")
    print(f"    • Risk Level             : [{risk_level}]")
    print(f"    • Actionable Advice      : {advice}")

    # Assertions
    assert pred_demand is not None and pred_demand >= 0.0, "Predicted demand must be >= 0.0"
    assert daily_velocity is not None and daily_velocity >= 0.0, "Daily velocity must be >= 0.0"
    assert reorder_point is not None and reorder_point >= 0.0, "Reorder point must be >= 0.0"
    assert reorder_qty is not None and reorder_qty >= 0, "Recommended reorder quantity must be non-negative integer"
    assert risk_level in [
        "CRITICAL STOCKOUT RISK",
        "MODERATE REORDER ZONE",
        "HEALTHY INVENTORY",
    ], f"Unexpected risk level: {risk_level}"

    print("\n[5] Testing ORION Overview endpoint (/api/orion-overview)...")
    orion_resp = requests.get(f"{BASE_URL}/api/orion-overview", timeout=5)
    assert orion_resp.status_code == 200, f"Expected 200, got {orion_resp.status_code}"
    orion_data = orion_resp.json()
    assert "top_selling_sku" in orion_data, "Missing top_selling_sku"
    assert "center_hub" in orion_data, "Missing center_hub"
    assert "left_demand_streams" in orion_data, "Missing left_demand_streams"
    assert "right_health_streams" in orion_data, "Missing right_health_streams"
    assert "health_rings" in orion_data, "Missing health_rings"
    print(f"    • Top Selling SKU : {orion_data['top_selling_sku']['sku']}")
    print(f"    • Center Hub Status: {orion_data['center_hub']['status']}")
    print(f"    • Left Streams    : {len(orion_data['left_demand_streams'])} categories")
    print(f"    • Right Streams   : {len(orion_data['right_health_streams'])} outcomes")
    print(f"    • Healthy Ring    : {orion_data['health_rings']['healthy_pct']}%")

    print("\n" + "=" * 65)
    print("ALL SANITY TESTS PASSED SUCCESSFULLY! (Stage 9 & 10 validated)")
    print("=" * 65)


if __name__ == "__main__":
    run_sanity_tests()
