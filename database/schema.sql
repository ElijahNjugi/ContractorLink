BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

/* -------------------------------------------------------------------------- */
/* Core reference tables                                                      */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(50) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL UNIQUE,
    organization_type varchar(30) NOT NULL
        CHECK (organization_type IN ('CLIENT', 'CONTRACTOR', 'HYBRID', 'PLATFORM_INTERNAL')),
    description text,
    website_url text,
    phone varchar(50),
    email varchar(150),
    marketplace_tagline varchar(220),
    service_summary text,
    coverage_area text,
    specializations text,
    years_in_service integer CHECK (years_in_service IS NULL OR years_in_service >= 0),
    logo_image_url text,
    profile_image_url text,
    cover_image_url text,
    marketplace_enabled boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    full_name varchar(150) NOT NULL,
    email varchar(150) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    phone varchar(50),
    job_title varchar(120),
    is_active boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    temp_password_issued_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

/* -------------------------------------------------------------------------- */
/* Organization registration and verification                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS organization_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name varchar(200) NOT NULL,
    organization_type_requested varchar(30) NOT NULL
        CHECK (organization_type_requested IN ('CLIENT', 'CONTRACTOR', 'HYBRID')),
    primary_contact_name varchar(150) NOT NULL,
    primary_contact_email varchar(150) NOT NULL,
    primary_contact_phone varchar(50),
    description text,
    service_summary text,
    coverage_area text,
    application_status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (application_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    review_notes text,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    approved_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_applications_status
    ON organization_applications(application_status);

CREATE TABLE IF NOT EXISTS organization_application_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES organization_applications(id) ON DELETE CASCADE,
    document_label varchar(150) NOT NULL DEFAULT 'Legal Document',
    file_name varchar(255) NOT NULL,
    file_path text NOT NULL,
    mime_type varchar(120),
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_application_documents_application_id
    ON organization_application_documents(application_id);

/* -------------------------------------------------------------------------- */
/* Organization operational details                                           */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS organization_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name varchar(150) NOT NULL,
    email varchar(150),
    phone varchar(50),
    job_title varchar(120),
    contact_type varchar(50),
    description text,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_contacts_organization_id
    ON organization_contacts(organization_id);

CREATE TABLE IF NOT EXISTS organization_partnerships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contractor_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ENDED')),
    notes text,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_partnership_orgs_different
        CHECK (client_organization_id <> contractor_organization_id),
    CONSTRAINT uq_org_partnership UNIQUE (client_organization_id, contractor_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_partnerships_client
    ON organization_partnerships(client_organization_id);

CREATE INDEX IF NOT EXISTS idx_org_partnerships_contractor
    ON organization_partnerships(contractor_organization_id);

/* -------------------------------------------------------------------------- */
/* Classification and assets                                                  */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS ticket_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL UNIQUE,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL UNIQUE,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_category_id uuid NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
    name varchar(200) NOT NULL,
    location varchar(200),
    status varchar(30) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED')),
    description text,
    serial_number varchar(120),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_organization_id ON assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_assets_category_id ON assets(asset_category_id);

/* -------------------------------------------------------------------------- */
/* SLA agreements                                                             */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS sla_agreements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contractor_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    partnership_id uuid REFERENCES organization_partnerships(id) ON DELETE SET NULL,
    agreement_name varchar(200) NOT NULL,
    description text,
    agreement_version varchar(30) NOT NULL DEFAULT '1.0',
    effective_date date,
    end_date date,
    renewal_type varchar(30) NOT NULL DEFAULT 'ONGOING'
        CHECK (renewal_type IN ('ONGOING', 'FIXED_TERM', 'AUTO_RENEW')),
    notice_period_days integer CHECK (notice_period_days IS NULL OR notice_period_days >= 0),
    review_interval_months integer CHECK (review_interval_months IS NULL OR review_interval_months > 0),
    next_review_date date,
    document_owner_name varchar(150),
    services_in_scope text,
    services_excluded text,
    client_responsibilities text,
    contractor_responsibilities text,
    service_assumptions text,
    support_hours text,
    support_channels text,
    payment_terms text,
    contractor_payment_terms text,
    breach_remedies text,
    contractor_job_contact_name varchar(150),
    contractor_job_contact_email varchar(150),
    contractor_job_contact_phone varchar(50),
    escalation_30m_emails text,
    escalation_15m_emails text,
    escalation_breach_emails text,
    governing_law varchar(160),
    legal_terms text,
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE', 'REVOKED')),
    contractor_approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    contractor_approved_at timestamptz,
    contractor_review_note text,
    revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
    revoked_at timestamptz,
    revocation_reason text,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_sla_agreement_orgs_different
        CHECK (client_organization_id <> contractor_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_sla_agreements_client
    ON sla_agreements(client_organization_id);

CREATE INDEX IF NOT EXISTS idx_sla_agreements_contractor
    ON sla_agreements(contractor_organization_id);

CREATE TABLE IF NOT EXISTS sla_agreement_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sla_agreement_id uuid NOT NULL REFERENCES sla_agreements(id) ON DELETE CASCADE,
    priority_level smallint NOT NULL CHECK (priority_level IN (1, 2, 3)),
    target_response_minutes integer CHECK (target_response_minutes IS NULL OR target_response_minutes > 0),
    target_resolution_minutes integer NOT NULL CHECK (target_resolution_minutes > 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_sla_policy_priority UNIQUE (sla_agreement_id, priority_level)
);

CREATE TABLE IF NOT EXISTS sla_agreement_escalations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sla_policy_id uuid NOT NULL REFERENCES sla_agreement_policies(id) ON DELETE CASCADE,
    level_no integer NOT NULL CHECK (level_no > 0),
    trigger_minutes integer NOT NULL CHECK (trigger_minutes >= 0),
    trigger_event_type varchar(30) NOT NULL
        CHECK (trigger_event_type IN ('WARNING', 'BREACH', 'POST_BREACH_REPEAT')),
    contact_id uuid NOT NULL REFERENCES organization_contacts(id) ON DELETE RESTRICT,
    repeat_every_minutes integer CHECK (repeat_every_minutes IS NULL OR repeat_every_minutes > 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_sla_escalation_level UNIQUE (sla_policy_id, level_no)
);

CREATE INDEX IF NOT EXISTS idx_sla_escalations_policy_id
    ON sla_agreement_escalations(sla_policy_id);

/* -------------------------------------------------------------------------- */
/* Tickets and SLA runtime                                                    */
/* -------------------------------------------------------------------------- */

-- Departments must exist before the assignment foreign key in a fresh database.
-- The hierarchy migration adds indexes and membership records afterwards.
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

CREATE TABLE IF NOT EXISTS tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number varchar(100) NOT NULL UNIQUE,
    requesting_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    assigned_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    assignment_scope varchar(20) NOT NULL DEFAULT 'ORGANIZATION'
        CHECK (assignment_scope IN ('ORGANIZATION', 'DEPARTMENT', 'USER')),
    assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
    assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    sla_agreement_id uuid NOT NULL REFERENCES sla_agreements(id) ON DELETE RESTRICT,
    ticket_type_id uuid REFERENCES ticket_types(id) ON DELETE SET NULL,
    asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
    title varchar(255) NOT NULL,
    description text NOT NULL,
    location varchar(200),
    priority_level smallint NOT NULL CHECK (priority_level IN (1, 2, 3)),
    status varchar(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    issue_found text,
    fix_applied text,
    resolution_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT chk_ticket_orgs_different
        CHECK (requesting_organization_id <> assigned_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_requesting_org
    ON tickets(requesting_organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_org
    ON tickets(assigned_organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_department
    ON tickets(assigned_department_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_user
    ON tickets(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority_level ON tickets(priority_level);

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

CREATE TABLE IF NOT EXISTS ticket_sla_tracking (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    sla_policy_id uuid NOT NULL REFERENCES sla_agreement_policies(id) ON DELETE RESTRICT,
    start_time timestamptz NOT NULL,
    expected_end_time timestamptz NOT NULL,
    actual_end_time timestamptz,
    paused_duration_minutes integer NOT NULL DEFAULT 0 CHECK (paused_duration_minutes >= 0),
    pause_start_time timestamptz,
    sla_status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (sla_status IN ('ACTIVE', 'PAUSED', 'BREACHED', 'COMPLETED')),
    last_escalation_sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sla_pause_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    paused_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason_text text NOT NULL,
    paused_at timestamptz NOT NULL DEFAULT now(),
    resumed_at timestamptz,
    paused_minutes integer CHECK (paused_minutes IS NULL OR paused_minutes >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_pause_events_ticket_id
    ON sla_pause_events(ticket_id);

/* -------------------------------------------------------------------------- */
/* Holds and attachments                                                      */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS hold_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason_text text NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED')),
    rejection_reason text,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hold_requests_ticket_id ON hold_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_hold_requests_status ON hold_requests(status);

CREATE TABLE IF NOT EXISTS hold_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hold_request_id uuid NOT NULL REFERENCES hold_requests(id) ON DELETE CASCADE,
    file_name varchar(255) NOT NULL,
    file_path text NOT NULL,
    mime_type varchar(120),
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hold_attachments_hold_request_id
    ON hold_attachments(hold_request_id);

/* -------------------------------------------------------------------------- */
/* Reassignment history                                                       */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS ticket_reassignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    to_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    reason_text text NOT NULL,
    reassigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reassigned_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_reassignment_orgs_different
        CHECK (from_organization_id <> to_organization_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_reassignments_ticket_id
    ON ticket_reassignments(ticket_id);

/* -------------------------------------------------------------------------- */
/* Ticket chat                                                                */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS ticket_chat_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    status varchar(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'LOCKED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz
);

CREATE TABLE IF NOT EXISTS ticket_chat_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES ticket_chat_threads(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_role varchar(30),
    joined_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_ticket_chat_participant UNIQUE (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_chat_participants_thread_id
    ON ticket_chat_participants(thread_id);

CREATE TABLE IF NOT EXISTS ticket_chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES ticket_chat_threads(id) ON DELETE CASCADE,
    sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    message_text text NOT NULL,
    message_type varchar(20) NOT NULL DEFAULT 'TEXT'
        CHECK (message_type IN ('TEXT', 'SYSTEM')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_chat_messages_thread_id
    ON ticket_chat_messages(thread_id, created_at);

/* -------------------------------------------------------------------------- */
/* Notifications and audit                                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS notifications (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    message text NOT NULL,
    type varchar(20) NOT NULL DEFAULT 'INFO'
        CHECK (type IN ('INFO', 'SUCCESS', 'WARNING', 'DANGER')),
    entity_type varchar(50),
    entity_id uuid,
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
    ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_notification_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_ticket_assigned boolean NOT NULL DEFAULT true,
    email_ticket_updated boolean NOT NULL DEFAULT true,
    email_sla_breached boolean NOT NULL DEFAULT true,
    email_hold_reviewed boolean NOT NULL DEFAULT true,
    email_ticket_completed boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action_type varchar(100) NOT NULL,
    entity_type varchar(100) NOT NULL,
    entity_id uuid,
    metadata_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
    ON audit_logs(entity_type, entity_id);

/* -------------------------------------------------------------------------- */
/* Password management and system settings                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS password_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    purpose varchar(20) NOT NULL CHECK (purpose IN ('INVITE', 'RESET')),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_tokens_user_id ON password_tokens(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reset_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reset_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    system_name varchar(200),
    support_email varchar(150),
    auto_escalation boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
