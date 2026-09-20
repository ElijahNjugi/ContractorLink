BEGIN;

ALTER TABLE organization_application_documents
    ADD COLUMN IF NOT EXISTS document_type varchar(80),
    ADD COLUMN IF NOT EXISTS document_number varchar(120),
    ADD COLUMN IF NOT EXISTS issue_date date,
    ADD COLUMN IF NOT EXISTS expiry_date date,
    ADD COLUMN IF NOT EXISTS notes text;

UPDATE organization_application_documents
SET document_type = COALESCE(NULLIF(document_type, ''), 'SUPPORTING_DOCUMENT')
WHERE document_type IS NULL OR document_type = '';

ALTER TABLE organization_application_documents
    ALTER COLUMN document_type SET DEFAULT 'SUPPORTING_DOCUMENT';

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname
    INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel
      ON rel.oid = con.conrelid
    JOIN pg_attribute attr
      ON attr.attrelid = rel.oid
     AND attr.attnum = ANY(con.conkey)
    WHERE rel.relname = 'organization_applications'
      AND attr.attname = 'application_status'
      AND con.contype = 'c'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE organization_applications DROP CONSTRAINT %I',
            constraint_name
        );
    END IF;
END $$;

ALTER TABLE organization_applications
    ADD CONSTRAINT organization_applications_application_status_check
    CHECK (
        application_status IN (
            'PENDING',
            'UNDER_REVIEW',
            'CONDITIONAL',
            'APPROVED',
            'REJECTED'
        )
    );

COMMIT;
