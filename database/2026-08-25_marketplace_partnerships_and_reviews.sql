BEGIN;

ALTER TABLE organization_partnerships
    DROP CONSTRAINT IF EXISTS organization_partnerships_status_check;

ALTER TABLE organization_partnerships
    ADD CONSTRAINT organization_partnerships_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ENDED'));

ALTER TABLE organization_partnerships
    ALTER COLUMN status SET DEFAULT 'PENDING';

CREATE TABLE IF NOT EXISTS contractor_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_contractor_review_orgs_different
        CHECK (client_organization_id <> contractor_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_contractor_reviews_contractor
    ON contractor_reviews(contractor_organization_id, created_at DESC);

COMMIT;
