BEGIN;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('OPEN','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED','FAILED'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS failed_by uuid REFERENCES users(id);
ALTER TABLE ticket_sla_tracking DROP CONSTRAINT IF EXISTS ticket_sla_tracking_sla_status_check;
ALTER TABLE ticket_sla_tracking ADD CONSTRAINT ticket_sla_tracking_sla_status_check CHECK (sla_status IN ('ACTIVE','PAUSED','BREACHED','COMPLETED','FAILED'));
COMMIT;
