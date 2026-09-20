BEGIN;
CREATE TABLE IF NOT EXISTS ml_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_name varchar(100) NOT NULL, version varchar(50) NOT NULL,
  training_rows integer NOT NULL, roc_auc numeric(6,4), is_active boolean NOT NULL DEFAULT false, trained_at timestamptz NOT NULL DEFAULT now(), metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_ml_model_version UNIQUE (model_name, version)
);
CREATE TABLE IF NOT EXISTS ticket_ml_feedback (
  ticket_id uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, model_version varchar(50), predicted_breach_risk numeric(6,4), actual_breached boolean, captured_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
