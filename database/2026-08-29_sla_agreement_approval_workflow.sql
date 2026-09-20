BEGIN;

ALTER TABLE sla_agreements
    DROP CONSTRAINT IF EXISTS sla_agreements_status_check;

ALTER TABLE sla_agreements
    ADD CONSTRAINT sla_agreements_status_check
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE'));

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS contractor_approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contractor_approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS contractor_review_note text;

COMMIT;
