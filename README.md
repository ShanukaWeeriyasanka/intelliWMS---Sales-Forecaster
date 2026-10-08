# DemandIQ - Amazon Product Demand Forecasting Platform

Production-ready e-commerce demand forecasting and inventory replenishment engine built for the SLIIT Data Mining Project (IT3051).

## 🚀 Key Features
- **Tuned XGBoost Regressor**: 31-feature model achieving test RMSE 1.6926 and R² 0.5352.
- **FastAPI REST API**: High-performance endpoints (`/predict`, `/api/health`, `/api/procurement-queue`).
- **Interactive Web Dashboard**: Dynamic UI with 7-day projection curves, runway metrics, and PO generation.
- **Defensive QA Validation**: Strict schema validation for unknown SKUs, history depth, and snapshot dates.

## 🛠️ Quickstart

```bash
git clone <YOUR-REPO-LINK>
cd <YOUR-REPO-NAME>

python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload --port 8000
