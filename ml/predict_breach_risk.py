"""Return ticket breach-risk probabilities from one request or a long-running worker."""
from pathlib import Path
import json
import sys
import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FEATURES = [
    "priority", "category", "assignment_group", "location", "contact_type",
    "impact", "urgency", "reassignment_count", "reopen_count", "sla_target_minutes",
]
model = joblib.load(ROOT / "ml" / "models" / "breach_risk_v1.joblib")


def predict(payload):
    row = {name: payload.get(name) for name in FEATURES}
    probability = float(model.predict_proba(pd.DataFrame([row]))[0, 1])
    return {"model_version": "v1", "breach_risk": round(probability, 4)}


if "--serve" in sys.argv:
    # Keep the trained model in memory so each ticket is scored without Python startup time.
    print(json.dumps({"type": "ready"}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = predict(request.get("features") or {})
            print(json.dumps({"id": request.get("id"), **result}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id"), "error": str(error)}), flush=True)
else:
    print(json.dumps(predict(json.load(sys.stdin))))
