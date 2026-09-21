const pool = require("../config/db");

async function disableOrganizationCascade(organizationId, executor = pool) {
  await executor.query(
    `
    UPDATE organizations
    SET is_active = FALSE,
        updated_at = now()
    WHERE id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE users
    SET is_active = FALSE,
        updated_at = now()
    WHERE organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE departments
    SET is_active = FALSE,
        updated_at = now()
    WHERE organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE department_users du
    SET is_active = FALSE,
        is_department_admin = FALSE,
        updated_at = now()
    FROM departments d
    WHERE du.department_id = d.id
      AND d.organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE organization_contacts
    SET is_active = FALSE,
        updated_at = now()
    WHERE organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE client_contractor_department_access
    SET is_visible = FALSE,
        updated_at = now()
    WHERE client_organization_id = $1
       OR contractor_organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE client_contractor_user_access cua
    SET is_visible = FALSE,
        is_assignable = FALSE,
        updated_at = now()
    FROM sla_agreements sa
    WHERE cua.sla_agreement_id = sa.id
      AND (sa.client_organization_id = $1 OR sa.contractor_organization_id = $1)
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE assets
    SET status = 'INACTIVE',
        updated_at = now()
    WHERE organization_id = $1
      AND status <> 'RETIRED'
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE organization_partnerships
    SET status = 'SUSPENDED',
        updated_at = now()
    WHERE client_organization_id = $1
       OR contractor_organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE sla_agreements
    SET status = 'INACTIVE',
        updated_at = now()
    WHERE client_organization_id = $1
       OR contractor_organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE tickets
    SET status = CASE
        WHEN status IN ('COMPLETED', 'CANCELLED', 'FAILED') THEN status
        ELSE 'CANCELLED'
      END,
      updated_at = now()
    WHERE requesting_organization_id = $1
       OR assigned_organization_id = $1
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE hold_requests hr
    SET status = CASE
        WHEN hr.status IN ('APPROVED', 'PENDING') THEN 'CLOSED'
        ELSE hr.status
      END,
      updated_at = now()
    FROM tickets t
    WHERE hr.ticket_id = t.id
      AND (t.requesting_organization_id = $1 OR t.assigned_organization_id = $1)
      AND hr.status IN ('APPROVED', 'PENDING')
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE ticket_sla_tracking st
    SET sla_status = 'COMPLETED',
        actual_end_time = COALESCE(actual_end_time, now()),
        updated_at = now()
    FROM tickets t
    WHERE st.ticket_id = t.id
      AND (t.requesting_organization_id = $1 OR t.assigned_organization_id = $1)
      AND st.sla_status NOT IN ('COMPLETED', 'FAILED')
    `,
    [organizationId]
  );

  await executor.query(
    `
    UPDATE ticket_chat_threads th
    SET status = 'LOCKED',
        locked_at = COALESCE(locked_at, now())
    FROM tickets t
    WHERE th.ticket_id = t.id
      AND (t.requesting_organization_id = $1 OR t.assigned_organization_id = $1)
      AND th.status <> 'LOCKED'
    `,
    [organizationId]
  );
}

async function enableOrganizationOnly(organizationId, executor = pool) {
  await executor.query(
    `
    UPDATE organizations
    SET is_active = TRUE,
        updated_at = now()
    WHERE id = $1
    `,
    [organizationId]
  );
}

module.exports = {
  disableOrganizationCascade,
  enableOrganizationOnly,
};
