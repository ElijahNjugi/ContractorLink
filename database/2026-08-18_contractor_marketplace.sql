BEGIN;

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS marketplace_tagline varchar(220),
    ADD COLUMN IF NOT EXISTS service_summary text,
    ADD COLUMN IF NOT EXISTS coverage_area text,
    ADD COLUMN IF NOT EXISTS specializations text,
    ADD COLUMN IF NOT EXISTS years_in_service integer CHECK (years_in_service IS NULL OR years_in_service >= 0),
    ADD COLUMN IF NOT EXISTS marketplace_enabled boolean NOT NULL DEFAULT false;

COMMIT;
