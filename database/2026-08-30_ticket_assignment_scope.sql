BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignment_scope varchar(20) NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN IF NOT EXISTS assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_assignment_scope_check;

ALTER TABLE tickets
  ADD CONSTRAINT tickets_assignment_scope_check
  CHECK (assignment_scope IN ('ORGANIZATION', 'DEPARTMENT', 'USER'));

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_department
  ON tickets(assigned_department_id);

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_user
  ON tickets(assigned_user_id);

COMMIT;
