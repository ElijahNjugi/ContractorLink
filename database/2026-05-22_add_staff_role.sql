BEGIN;

INSERT INTO roles (code, name, description)
VALUES (
  'STAFF',
  'Staff',
  'Lowest normal organization user role for standard departmental access.'
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = now();

COMMIT;
