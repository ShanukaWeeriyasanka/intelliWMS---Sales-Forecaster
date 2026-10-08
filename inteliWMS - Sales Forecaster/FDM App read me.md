# PROMPT FOR AI CODING AGENT: Build Amazon Demand Forecasting System (Stages 9 & 10)

## Context & Project Objective
You are tasked with building a production-grade, end-to-end web prediction system for our SLIIT Data Mining Mini Project (IT3051 - Group KND_10: Amazon Product Demand Forecasting)[cite: 20, 22]. 

This deliverable fulfills:
- **Stage 9: Backend Development** (FastAPI service loading the serialized model and preprocessing pipeline, input validation, feature vector alignment, and real-time prediction).
- **Stage 10: Frontend Development & User Experience** (A responsive, user-friendly UI collecting SKU attributes, displaying 7-day forecasts, and calculating inventory replenishment decisions)[cite: 20, 25, 33].

---

## Workspace Assets Available
The following two files are already placed in the project root directory:
1. `best_xgboost_demand_model.pkl`: A serialized `xgboost.sklearn.XGBRegressor` tuned on 128,565 training records (`max_depth: 3`, `learning_rate: 0.06`, `reg_alpha: 1.0`, `reg_lambda: 1.0`) achieving test RMSE `1.6926` and $R^2$ `0.5352`[cite: 8, 15, 36, 37].
2. `model_metadata.json`: Contains the exact schema of 31 training features, allowed categories, allowed sizes, default numeric medians, and evaluation metrics.

---

## Required Project Structure
Create the following files in the project workspace:
```text
amazon_demand_system/
├── best_xgboost_demand_model.pkl      # (Already present)
├── model_metadata.json                # (Already present)
├── requirements.txt                   # Dependency list
├── app.py                             # FastAPI backend service
├── test_api.py                        # Automated sanity test script
└── static/
    └── index.html                     # Modern Tailwind CSS frontend