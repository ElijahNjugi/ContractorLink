BEGIN;

/* -------------------------------------------------------------------------- */
/* Phase 2 extension: departments, scoped access, assignment hierarchy        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Organization applications                                                  */
/* -------------------------------------------------------------------------- */

ALTER TABLE organization_applications
    ADD COLUMN IF NOT EXISTS rejection_reason text;

/* -------------------------------------------------------------------------- */
/* Organizations and users media helpers                                      */
/* -------------------------------------------------------------------------- */

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS logo_path text;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS profile_photo_path text;

CREATE TABLE IF NOT EXISTS organization_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    file_name varchar(255) NOT NULL,
    file_path text NOT NULL,
    mime_type varchar(120),
    media_type varchar(30) NOT NULL
        CHECK (media_type IN ('LOGO', 'DOCUMENT', 'OTHER')),
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_media_organization_id
    ON organization_media(organization_id);

CREATE TABLE IF NOT EXISTS user_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name varchar(255) NOT NULL,
    file_path text NOT NULL,
    mime_type varchar(120),
    media_type varchar(30) NOT NULL
        CHECK (media_type IN ('PROFILE_PHOTO', 'DOCUMENT', 'OTHER')),
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_media_user_id
    ON user_media(user_id);

/* -------------------------------------------------------------------------- */
/* Departments and internal hierarchy                                         */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name varchar(150) NOT NULL,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_departments_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_organization_id
    ON departments(organization_id);

CREATE TABLE IF NOT EXISTS department_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_department_admin boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_department_users_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_department_users_department_id
    ON department_users(department_id);

/* -------------------------------------------------------------------------- */
/* SLA agreement options for hierarchy and post-breach behavior               */
/* -------------------------------------------------------------------------- */

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS allow_hierarchy_escalation boolean NOT NULL DEFAULT true;

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS allow_custom_contact_escalation boolean NOT NULL DEFAULT true;

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS post_breach_action varchar(40) NOT NULL DEFAULT 'CONTINUE_AND_NOTIFY';

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS penalty_tracking_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS forced_reassignment_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE sla_agreements
    ADD COLUMN IF NOT EXISTS management_attention_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_sla_agreements_post_breach_action'
    ) THEN
        ALTER TABLE sla_agreements
            ADD CONSTRAINT chk_sla_agreements_post_breach_action
            CHECK (
                post_breach_action IN (
                    'CONTINUE_AND_NOTIFY',
                    'FORCED_REASSIGNMENT',
                    'MANAGEMENT_ATTENTION',
                    'PENALTY_TRACKING_ONLY'
                )
            );
    END IF;
END $$;

ALTER TABLE sla_agreement_escalations
    ADD COLUMN IF NOT EXISTS escalation_target_type varchar(30) NOT NULL DEFAULT 'CONTACT';

ALTER TABLE sla_agreement_escalations
    ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;

ALTER TABLE sla_agreement_escalations
    ADD COLUMN IF NOT EXISTS notify_in_app boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_sla_agreement_escalations_target_type'
    ) THEN
        ALTER TABLE sla_agreement_escalations
            ADD CONSTRAINT chk_sla_agreement_escalations_target_type
            CHECK (
                escalation_target_type IN (
                    'CONTACT',
                    'ASSIGNED_USER',
                    'DEPARTMENT_ADMIN',
                    'ORG_ADMIN'
                )
            );
    END IF;
END $$;

/* -------------------------------------------------------------------------- */
/* Client-to-contractor scoped visibility                                     */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS client_contractor_department_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sla_agreement_id uuid NOT NULL REFERENCES sla_agreements(id) ON DELETE CASCADE,
    client_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contractor_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    is_visible boolean NOT NULL DEFAULT true,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_department_access_orgs_different
        CHECK (client_organization_id <> contractor_organization_id),
    CONSTRAINT uq_client_contractor_department_access
        UNIQUE (sla_agreement_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_client_contractor_department_access_agreement
    ON client_contractor_department_access(sla_agreement_id);

CREATE INDEX IF NOT EXISTS idx_client_contractor_department_access_department
    ON client_contractor_department_access(department_id);

CREATE TABLE IF NOT EXISTS client_contractor_user_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sla_agreement_id uuid NOT NULL REFERENCES sla_agreements(id) ON DELETE CASCADE,
    department_access_id uuid NOT NULL REFERENCES client_contractor_department_access(id) ON DELETE CASCADE,
    department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_assignable boolean NOT NULL DEFAULT true,
    is_visible boolean NOT NULL DEFAULT true,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_client_contractor_user_access
        UNIQUE (sla_agreement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_contractor_user_access_agreement
    ON client_contractor_user_access(sla_agreement_id);

CREATE INDEX IF NOT EXISTS idx_client_contractor_user_access_department
    ON client_contractor_user_access(department_id);

/* -------------------------------------------------------------------------- */
/* Ticket assignment and visibility                                           */
/* -------------------------------------------------------------------------- */

ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS created_by_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS ticket_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    assignment_type varchar(20) NOT NULL
        CHECK (assignment_type IN ('ORGANIZATION', 'DEPARTMENT', 'USER')),
    assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_assignment_target
        CHECK (
            (assignment_type = 'ORGANIZATION' AND department_id IS NULL AND user_id IS NULL) OR
            (assignment_type = 'DEPARTMENT' AND department_id IS NOT NULL AND user_id IS NULL) OR
            (assignment_type = 'USER' AND department_id IS NOT NULL AND user_id IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_ticket_id
    ON ticket_assignments(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_department_id
    ON ticket_assignments(department_id);

CREATE INDEX IF NOT EXISTS idx_ticket_assignments_user_id
    ON ticket_assignments(user_id);

CREATE TABLE IF NOT EXISTS ticket_visibility (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    visibility_type varchar(20) NOT NULL
        CHECK (visibility_type IN ('ORGANIZATION', 'DEPARTMENT', 'USER')),
    granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_visibility_target
        CHECK (
            (visibility_type = 'ORGANIZATION' AND department_id IS NULL AND user_id IS NULL) OR
            (visibility_type = 'DEPARTMENT' AND department_id IS NOT NULL AND user_id IS NULL) OR
            (visibility_type = 'USER' AND department_id IS NOT NULL AND user_id IS NOT NULL)
        ),
    CONSTRAINT uq_ticket_visibility_scope
        UNIQUE (ticket_id, organization_id, department_id, user_id, visibility_type)
);

CREATE INDEX IF NOT EXISTS idx_ticket_visibility_ticket_id
    ON ticket_visibility(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_visibility_department_id
    ON ticket_visibility(department_id);

CREATE INDEX IF NOT EXISTS idx_ticket_visibility_user_id
    ON ticket_visibility(user_id);

/* -------------------------------------------------------------------------- */
/* Helpful comments                                                           */
/* -------------------------------------------------------------------------- */

COMMENT ON TABLE departments IS
    'Internal organization units such as Helpdesk, Finance, Security, or Field Operations.';

COMMENT ON TABLE department_users IS
    'Maps each user to one active department for now, with an optional department admin flag.';

COMMENT ON TABLE client_contractor_department_access IS
    'Controls which contractor departments a specific client may view under a given SLA agreement.';

COMMENT ON TABLE client_contractor_user_access IS
    'Controls which contractor users inside approved departments are visible or assignable to a client.';

COMMENT ON TABLE ticket_assignments IS
    'Stores organization, department, or user-level ticket assignment targets.';

COMMENT ON TABLE ticket_visibility IS
    'Stores which organizations, departments, or specific users can see a ticket.';

COMMIT;
