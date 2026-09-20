BEGIN;

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS agreement_version varchar(30) NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS effective_date date,
    ADD COLUMN IF NOT EXISTS end_date date,
    ADD COLUMN IF NOT EXISTS renewal_type varchar(30) NOT NULL DEFAULT 'ONGOING',
    ADD COLUMN IF NOT EXISTS notice_period_days integer,
    ADD COLUMN IF NOT EXISTS review_interval_months integer,
    ADD COLUMN IF NOT EXISTS next_review_date date,
    ADD COLUMN IF NOT EXISTS document_owner_name varchar(150),
    ADD COLUMN IF NOT EXISTS services_in_scope text,
    ADD COLUMN IF NOT EXISTS services_excluded text,
    ADD COLUMN IF NOT EXISTS client_responsibilities text,
    ADD COLUMN IF NOT EXISTS contractor_responsibilities text,
    ADD COLUMN IF NOT EXISTS service_assumptions text,
    ADD COLUMN IF NOT EXISTS support_hours text,
    ADD COLUMN IF NOT EXISTS support_channels text,
    ADD COLUMN IF NOT EXISTS payment_terms text,
    ADD COLUMN IF NOT EXISTS governing_law varchar(160),
    ADD COLUMN IF NOT EXISTS legal_terms text;

ALTER TABLE sla_agreements
    DROP CONSTRAINT IF EXISTS sla_agreements_renewal_type_check;

ALTER TABLE sla_agreements
    ADD CONSTRAINT sla_agreements_renewal_type_check
    CHECK (renewal_type IN ('ONGOING', 'FIXED_TERM', 'AUTO_RENEW'));

ALTER TABLE sla_agreement_policies
    ADD COLUMN IF NOT EXISTS target_response_minutes integer;

ALTER TABLE sla_agreement_policies
    DROP CONSTRAINT IF EXISTS sla_agreement_policies_target_response_minutes_check;

ALTER TABLE sla_agreement_policies
    ADD CONSTRAINT sla_agreement_policies_target_response_minutes_check
    CHECK (target_response_minutes IS NULL OR target_response_minutes > 0);

COMMIT;
