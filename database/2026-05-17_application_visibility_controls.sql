BEGIN;

ALTER TABLE organization_applications
    ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
    ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_applications_is_hidden
    ON organization_applications(is_hidden);

COMMIT;
