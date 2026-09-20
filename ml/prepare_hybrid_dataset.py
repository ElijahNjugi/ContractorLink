"""Create a documented hybrid breach-risk training dataset for ContractorLink."""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "backend" / "incident_event_log.csv"
OUT = ROOT / "ml" / "data" / "hybrid_breach_training.csv"
REPORT = ROOT / "ml" / "data" / "provenance.md"

def prepare_external():
    raw = pd.read_csv(RAW, low_memory=False)
    raw["opened_at"] = pd.to_datetime(raw["opened_at"], dayfirst=True, errors="coerce")
    raw = raw.sort_values(["number", "opened_at", "sys_mod_count"])
    first = raw.drop_duplicates("number", keep="first").copy()
    return pd.DataFrame({
        "record_source": "EXTERNAL_SERVICENOW",
        "priority": first["priority"].fillna("Unknown"),
        "category": first["category"].fillna("Unknown"),
        "assignment_group": first["assignment_group"].fillna("Unassigned"),
        "location": first["location"].fillna("Unknown"),
        "contact_type": first["contact_type"].fillna("Unknown"),
        "impact": first["impact"].fillna("Unknown"),
        "urgency": first["urgency"].fillna("Unknown"),
        "reassignment_count": pd.to_numeric(first["reassignment_count"], errors="coerce").fillna(0),
        "reopen_count": pd.to_numeric(first["reopen_count"], errors="coerce").fillna(0),
        "sla_target_minutes": np.select([first["priority"].eq("1 - Critical"), first["priority"].eq("2 - High")], [240, 480], default=1440),
        "breached": (~first["made_sla"].astype(str).str.lower().eq("true")).astype(int),
    })

def simulate_contractorlink(rows=6000, seed=42):
    rng = np.random.default_rng(seed)
    priorities = rng.choice(["Critical", "High", "Normal"], rows, p=[.18, .32, .50])
    departments = rng.choice(["Relocation Operations", "Maintenance", "Field Services", "IT Support", "Delivery"], rows)
    categories = rng.choice(["Relocation", "Maintenance", "Delivery", "Inspection", "Incident Support"], rows)
    target = np.where(priorities == "Critical", 240, np.where(priorities == "High", 480, 1440))
    reassignments = rng.poisson(.45, rows); reopens = rng.poisson(.16, rows)
    risk = .10 + (priorities == "Critical")*.22 + (priorities == "High")*.10 + reassignments*.10 + reopens*.14 + (departments == "Field Services")*.05
    breached = (rng.random(rows) < np.clip(risk, .04, .78)).astype(int)
    return pd.DataFrame({
        "record_source": "SIMULATED_CONTRACTORLINK",
        "priority": priorities,
        "category": categories,
        "assignment_group": departments,
        "location": rng.choice(["Nairobi", "Kisumu", "Mombasa", "Countrywide"], rows),
        "contact_type": rng.choice(["Portal", "Email", "Phone"], rows, p=[.7,.2,.1]),
        "impact": np.where(priorities == "Critical", "High", rng.choice(["Medium", "Low"], rows)),
        "urgency": np.where(priorities == "Normal", "Low", rng.choice(["High", "Medium"], rows)),
        "reassignment_count": reassignments,
        "reopen_count": reopens,
        "sla_target_minutes": target,
        "breached": breached,
    })

if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    external = prepare_external().sample(n=min(6000, 24918), random_state=42)
    simulated = simulate_contractorlink()
    hybrid = pd.concat([external, simulated], ignore_index=True).sample(frac=1, random_state=42)
    hybrid.to_csv(OUT, index=False)
    REPORT.write_text(f"# Hybrid Dataset Provenance\n\n- External ServiceNow incident snapshots: {len(external):,}.\n- Simulated ContractorLink records: {len(simulated):,}.\n- Total records: {len(hybrid):,}.\n- Breach outcomes: {int(hybrid.breached.sum()):,}.\n\nSimulated records are included to balance breach outcomes and represent ContractorLink service scenarios. They must be disclosed as simulated in project documentation.\n", encoding="utf-8")
    print(f"Wrote {len(hybrid)} records to {OUT}")
