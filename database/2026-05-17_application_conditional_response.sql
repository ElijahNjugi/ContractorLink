BEGIN;

ALTER TABLE organization_applications
    ADD COLUMN IF NOT EXISTS applicant_response_notes text;

COMMIT;
