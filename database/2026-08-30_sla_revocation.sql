BEGIN;

ALTER TABLE sla_agreements
    DROP CONSTRAINT IF EXISTS sla_agreements_status_check;

ALTER TABLE sla_agreements
    ADD CONSTRAINT sla_agreements_status_check
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE', 'REVOKED'));

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
    ADD COLUMN IF NOT EXISTS revocation_reason text;

COMMIT;
