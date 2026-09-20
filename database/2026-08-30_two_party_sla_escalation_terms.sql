BEGIN;

ALTER TABLE sla_agreements
  ADD COLUMN IF NOT EXISTS contractor_payment_terms text,
  ADD COLUMN IF NOT EXISTS breach_remedies text,
  ADD COLUMN IF NOT EXISTS contractor_job_contact_name varchar(150),
  ADD COLUMN IF NOT EXISTS contractor_job_contact_email varchar(150),
  ADD COLUMN IF NOT EXISTS contractor_job_contact_phone varchar(50),
  ADD COLUMN IF NOT EXISTS escalation_30m_emails text,
  ADD COLUMN IF NOT EXISTS escalation_15m_emails text,
  ADD COLUMN IF NOT EXISTS escalation_breach_emails text;

-- Older agreements did not contain the required two-party operational terms.
UPDATE sla_agreements
SET status = 'INACTIVE', updated_at = now()
WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED');

COMMIT;
