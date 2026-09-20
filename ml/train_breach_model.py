"""Train a versioned ContractorLink Random Forest breach-risk model."""
from pathlib import Path
import json
import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "ml" / "data" / "hybrid_breach_training.csv"
MODELS = ROOT / "ml" / "models"; MODELS.mkdir(exist_ok=True)
FEATURES = ["priority", "category", "assignment_group", "location", "contact_type", "impact", "urgency", "reassignment_count", "reopen_count", "sla_target_minutes"]

if __name__ == "__main__":
    data = pd.read_csv(DATA); x = data[FEATURES]; y = data["breached"]
    # Source logs use textual labels such as "3 - Moderate"; classify by meaning, not inferred dtype.
    categorical = ["priority", "category", "assignment_group", "location", "contact_type", "impact", "urgency"]
    numeric = ["reassignment_count", "reopen_count", "sla_target_minutes"]
    prep = ColumnTransformer([("categorical", Pipeline([("impute", SimpleImputer(strategy="most_frequent")), ("encode", OneHotEncoder(handle_unknown="ignore"))]), categorical), ("numeric", Pipeline([("impute", SimpleImputer(strategy="median"))]), numeric)])
    model = Pipeline([("prep", prep), ("forest", RandomForestClassifier(n_estimators=400, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1))])
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=.2, stratify=y, random_state=42)
    model.fit(x_train, y_train); probabilities = model.predict_proba(x_test)[:, 1]
    metrics = {"model_version": "v1", "training_rows": int(len(data)), "breach_rate": float(y.mean()), "roc_auc": float(roc_auc_score(y_test, probabilities)), "classification_report": classification_report(y_test, model.predict(x_test), output_dict=True), "features": FEATURES}
    joblib.dump(model, MODELS / "breach_risk_v1.joblib")
    (MODELS / "breach_risk_v1_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({"model": "breach_risk_v1.joblib", "roc_auc": metrics["roc_auc"]}, indent=2))
