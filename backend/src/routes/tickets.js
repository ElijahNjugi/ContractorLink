const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { roleCode, canAccessOrganization } = require("../utils/orgAccess");
const {
  getActiveUsersForOrganizations,
  createNotificationsForUsers,
  sendEmailToUsers,
} = require("../services/notifications");
const { logAudit } = require("../services/audit");
const { scoreBreachRisk } = require("../services/mlBreachRisk");

const router = express.Router();

async function getAgreementById(id, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM sla_agreements
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getPolicyForAgreement(agreementId, priorityLevel, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM sla_agreement_policies
    WHERE sla_agreement_id = $1
      AND priority_level = $2
      AND is_active = TRUE
    LIMIT 1
    `,
    [agreementId, priorityLevel]
  );

  return rows[0] || null;
}

async function getTicketTypeById(id, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM ticket_types
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getAssetById(id, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM assets
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getTicketById(id, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM tickets
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function canViewTicket(req, ticket, executor = pool) {
  if (roleCode(req) === "SUPER_ADMIN") return true;

  // The requesting company retains its own record; contractor access follows the assignment scope.
  if (String(req.user.organization_id) === String(ticket.requesting_organization_id)) return true;
  if (String(req.user.organization_id) !== String(ticket.assigned_organization_id)) return false;
  if (roleCode(req) === "ORG_ADMIN") return true;
  if (ticket.assignment_scope === "ORGANIZATION") return true;
  if (ticket.assignment_scope === "USER" && String(ticket.assigned_user_id) === String(req.user.id)) return true;
  if (!ticket.assigned_department_id) return false;

  const { rows } = await executor.query(
    `SELECT is_department_admin
     FROM department_users
     WHERE department_id = $1 AND user_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [ticket.assigned_department_id, req.user.id]
  );

  return Boolean(rows[0]);
}

async function getAssignmentRecipients(ticket, executor = pool) {
  if (ticket.assignment_scope === "USER" && ticket.assigned_user_id) {
    const { rows } = await executor.query(
      `SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN department_users du ON du.user_id = u.id AND du.department_id = $2 AND du.is_active = TRUE
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = TRUE AND u.organization_id = $1
         AND (u.id = $3 OR r.code = 'ORG_ADMIN' OR du.is_department_admin = TRUE)`,
      [ticket.assigned_organization_id, ticket.assigned_department_id, ticket.assigned_user_id]
    );
    return rows.map((row) => row.id);
  }

  if (ticket.assignment_scope === "DEPARTMENT" && ticket.assigned_department_id) {
    const { rows } = await executor.query(
      `SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN department_users du ON du.user_id = u.id AND du.department_id = $2 AND du.is_active = TRUE
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = TRUE AND u.organization_id = $1
         AND (du.user_id IS NOT NULL OR r.code = 'ORG_ADMIN')`,
      [ticket.assigned_organization_id, ticket.assigned_department_id]
    );
    return rows.map((row) => row.id);
  }

  const users = await getActiveUsersForOrganizations([ticket.assigned_organization_id], executor);
  return users.map((user) => user.id);
}

async function buildTicketNumber(client) {
  const { rows } = await client.query(
    `
    SELECT COUNT(*)::int AS ticket_count
    FROM tickets
    WHERE created_at::date = CURRENT_DATE
    `
  );

  const nextNumber = Number(rows[0]?.ticket_count || 0) + 1;
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `TKT-${dateStamp}-${String(nextNumber).padStart(4, "0")}`;
}

async function addChatParticipants(client, threadId, userIds) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean).map(String))];

  for (const userId of uniqueUserIds) {
    await client.query(
      `
      INSERT INTO ticket_chat_participants (
        thread_id,
        user_id
      )
      VALUES ($1, $2)
      ON CONFLICT (thread_id, user_id) DO NOTHING
      `,
      [threadId, userId]
    );
  }
}

async function getChatThreadByTicketId(ticketId, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT *
    FROM ticket_chat_threads
    WHERE ticket_id = $1
    LIMIT 1
    `,
    [ticketId]
  );

  return rows[0] || null;
}

async function replaceContractorParticipants(client, threadId, previousOrganizationId, nextOrganizationId) {
  await client.query(
    `
    DELETE FROM ticket_chat_participants tcp
    USING users u
    WHERE tcp.user_id = u.id
      AND tcp.thread_id = $1
      AND u.organization_id = $2
    `,
    [threadId, previousOrganizationId]
  );

  const participantLookup = await client.query(
    `
    SELECT id
    FROM users
    WHERE is_active = TRUE
      AND organization_id = $1
    `,
    [nextOrganizationId]
  );

  await addChatParticipants(
    client,
    threadId,
    participantLookup.rows.map((row) => row.id)
  );
}

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const currentRole = roleCode(req);
    const requestedOrgId = req.query.organization_id || null;
    const requestedStatus = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const params = [];
    const clauses = [];

    if (currentRole === "SUPER_ADMIN") {
      if (requestedOrgId) {
        params.push(requestedOrgId);
        clauses.push(
          `(t.requesting_organization_id = $${params.length} OR t.assigned_organization_id = $${params.length})`
        );
      }
    } else {
      params.push(req.user.organization_id);
      clauses.push(
        `(t.requesting_organization_id = $${params.length} OR t.assigned_organization_id = $${params.length})`
      );
    }

    if (requestedStatus) {
      params.push(requestedStatus);
      clauses.push(`t.status = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        t.*,
        requester.name AS requesting_organization_name,
        assigned.name AS assigned_organization_name,
        tt.name AS ticket_type_name,
        a.name AS asset_name,
        creator.full_name AS created_by_name,
        completer.full_name AS completed_by_name,
        department.name AS assigned_department_name,
        assignee.full_name AS assigned_user_name,
        sla.start_time,
        sla.expected_end_time,
        sla.sla_status,
        feedback.model_version AS ml_model_version,
        feedback.predicted_breach_risk
      FROM tickets t
      JOIN organizations requester
        ON requester.id = t.requesting_organization_id
      JOIN organizations assigned
        ON assigned.id = t.assigned_organization_id
      LEFT JOIN ticket_types tt
        ON tt.id = t.ticket_type_id
      LEFT JOIN assets a
        ON a.id = t.asset_id
      LEFT JOIN users creator
        ON creator.id = t.created_by
      LEFT JOIN users completer
        ON completer.id = t.completed_by
      LEFT JOIN departments department
        ON department.id = t.assigned_department_id
      LEFT JOIN users assignee
        ON assignee.id = t.assigned_user_id
      LEFT JOIN ticket_sla_tracking sla
        ON sla.ticket_id = t.id
      LEFT JOIN ticket_ml_feedback feedback
        ON feedback.ticket_id = t.id
      ${where}
      ORDER BY t.created_at DESC
      `,
      params
    );

    const visibleTickets = currentRole === "SUPER_ADMIN"
      ? rows
      : (await Promise.all(rows.map(async (ticket) => (await canViewTicket(req, ticket)) ? ticket : null))).filter(Boolean);
    return res.json(visibleTickets);
  } catch (error) {
    console.error("LIST TICKETS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

router.get("/assignment-options", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const organizationId = String(req.query.organization_id || "").trim();
    const slaAgreementId = String(req.query.sla_agreement_id || "").trim();
    if (!organizationId || !slaAgreementId) {
      return res.status(400).json({ error: "organization_id and sla_agreement_id are required" });
    }

    const agreement = await getAgreementById(slaAgreementId);
    const isMatchingActiveAgreement = agreement && agreement.status === "ACTIVE"
      && String(agreement.contractor_organization_id) === organizationId
      && (roleCode(req) === "SUPER_ADMIN" || String(agreement.client_organization_id) === String(req.user.organization_id));
    if (!isMatchingActiveAgreement) return res.status(403).json({ error: "Active SLA access is required" });

    const { rows: departments } = await pool.query(
      `SELECT id, name, description FROM departments WHERE organization_id = $1 AND is_active = TRUE ORDER BY name`,
      [organizationId]
    );
    const { rows: users } = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.job_title, du.department_id, du.is_department_admin
       FROM department_users du JOIN users u ON u.id = du.user_id
       WHERE du.is_active = TRUE AND u.is_active = TRUE AND u.organization_id = $1
       ORDER BY u.full_name`,
      [organizationId]
    );
    return res.json({ departments, users });
  } catch (error) {
    console.error("TICKET ASSIGNMENT OPTIONS ERROR:", error);
    return res.status(500).json({ error: "Failed to load assignment options" });
  }
});

router.get("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        t.*,
        requester.name AS requesting_organization_name,
        assigned.name AS assigned_organization_name,
        tt.name AS ticket_type_name,
        a.name AS asset_name,
        a.organization_id AS asset_organization_id,
        creator.full_name AS created_by_name,
        completer.full_name AS completed_by_name,
        sat.agreement_name,
        sat.status AS agreement_status,
        sla.id AS sla_tracking_id,
        sla.sla_policy_id,
        sla.start_time,
        sla.expected_end_time,
        sla.actual_end_time,
        sla.paused_duration_minutes,
        sla.pause_start_time,
        sla.sla_status,
        feedback.model_version AS ml_model_version,
        feedback.predicted_breach_risk,
        department.name AS assigned_department_name,
        assignee.full_name AS assigned_user_name
      FROM tickets t
      JOIN organizations requester
        ON requester.id = t.requesting_organization_id
      JOIN organizations assigned
        ON assigned.id = t.assigned_organization_id
      LEFT JOIN ticket_types tt
        ON tt.id = t.ticket_type_id
      LEFT JOIN assets a
        ON a.id = t.asset_id
      LEFT JOIN users creator
        ON creator.id = t.created_by
      LEFT JOIN users completer
        ON completer.id = t.completed_by
      JOIN sla_agreements sat
        ON sat.id = t.sla_agreement_id
      LEFT JOIN ticket_sla_tracking sla
        ON sla.ticket_id = t.id
      LEFT JOIN ticket_ml_feedback feedback
        ON feedback.ticket_id = t.id
      LEFT JOIN departments department
        ON department.id = t.assigned_department_id
      LEFT JOIN users assignee
        ON assignee.id = t.assigned_user_id
      WHERE t.id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticket = rows[0];
    if (!(await canViewTicket(req, ticket))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(ticket);
  } catch (error) {
    console.error("GET TICKET ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  const client = await pool.connect();
  let postCommitNotification = null;

  try {
    await client.query("BEGIN");

    const requestingOrganizationId = req.body?.requesting_organization_id || req.user.organization_id;
    const assignedOrganizationId = req.body?.assigned_organization_id;
    const slaAgreementId = req.body?.sla_agreement_id;
    const ticketTypeId = req.body?.ticket_type_id || null;
    const assetId = req.body?.asset_id || null;
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const location = String(req.body?.location || "").trim() || null;
    const priorityLevel = Number(req.body?.priority_level);
    const assignmentScope = String(req.body?.assignment_scope || "ORGANIZATION").toUpperCase();
    const assignedDepartmentId = req.body?.assigned_department_id || null;
    const assignedUserId = req.body?.assigned_user_id || null;

    if (
      !requestingOrganizationId ||
      !assignedOrganizationId ||
      !slaAgreementId ||
      !title ||
      !description
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "requesting_organization_id, assigned_organization_id, sla_agreement_id, title, and description are required",
      });
    }

    if (![1, 2, 3].includes(priorityLevel)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "priority_level must be 1, 2, or 3" });
    }

    if (!["ORGANIZATION", "DEPARTMENT", "USER"].includes(assignmentScope)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "assignment_scope must be ORGANIZATION, DEPARTMENT, or USER" });
    }
    if (assignmentScope === "DEPARTMENT" && !assignedDepartmentId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "A department is required for department assignment" });
    }
    if (assignmentScope === "USER" && (!assignedDepartmentId || !assignedUserId)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "A department and person are required for individual assignment" });
    }

    if (
      roleCode(req) !== "SUPER_ADMIN" &&
      String(req.user.organization_id) !== String(requestingOrganizationId)
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "You can only create tickets for your own organization",
      });
    }

    const agreement = await getAgreementById(slaAgreementId);
    if (!agreement) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    const agreementMatches =
      String(agreement.client_organization_id) === String(requestingOrganizationId) &&
      String(agreement.contractor_organization_id) === String(assignedOrganizationId);

    if (!agreementMatches) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "SLA agreement does not match the requesting and assigned organizations",
      });
    }

    if (agreement.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "SLA agreement must be ACTIVE before creating tickets" });
    }

    if (assignedDepartmentId) {
      const { rows: departments } = await client.query(
        `SELECT id FROM departments WHERE id = $1 AND organization_id = $2 AND is_active = TRUE LIMIT 1`,
        [assignedDepartmentId, assignedOrganizationId]
      );
      if (!departments.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Assigned department does not belong to the contractor organization" });
      }
    }
    if (assignedUserId) {
      const { rows: members } = await client.query(
        `SELECT 1 FROM department_users du JOIN users u ON u.id = du.user_id
         WHERE du.department_id = $1 AND du.user_id = $2 AND du.is_active = TRUE AND u.is_active = TRUE LIMIT 1`,
        [assignedDepartmentId, assignedUserId]
      );
      if (!members.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Assigned person must be an active member of the selected department" });
      }
    }

    const policy = await getPolicyForAgreement(slaAgreementId, priorityLevel);
    if (!policy) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No active SLA policy exists for the selected priority level",
      });
    }

    const mlFeatures = {
      priority: priorityLevel === 3 ? "High" : priorityLevel === 2 ? "Normal" : "Normal",
      category: "Service Request",
      assignment_group: assignmentScope,
      location: location || "Unknown",
      contact_type: "Portal",
      impact: priorityLevel === 3 ? "High" : "Medium",
      urgency: priorityLevel === 3 ? "High" : priorityLevel === 2 ? "Medium" : "Low",
      reassignment_count: 0,
      reopen_count: 0,
      sla_target_minutes: policy.target_resolution_minutes,
    };

    if (ticketTypeId) {
      const ticketType = await getTicketTypeById(ticketTypeId);
      if (!ticketType || ticketType.is_active === false) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Ticket type not found or inactive" });
      }
    }

    if (assetId) {
      const asset = await getAssetById(assetId);
      if (!asset) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Asset not found" });
      }

      if (String(asset.organization_id) !== String(requestingOrganizationId)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Selected asset must belong to the requesting organization",
        });
      }
    }

    const ticketNumber = await buildTicketNumber(client);

    const ticketInsert = await client.query(
      `
      INSERT INTO tickets (
        ticket_number,
        requesting_organization_id,
        assigned_organization_id,
        assignment_scope,
        assigned_department_id,
        assigned_user_id,
        sla_agreement_id,
        ticket_type_id,
        asset_id,
        title,
        description,
        location,
        priority_level,
        status,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPEN',$14)
      RETURNING *
      `,
      [
        ticketNumber,
        requestingOrganizationId,
        assignedOrganizationId,
        assignmentScope,
        assignedDepartmentId,
        assignedUserId,
        slaAgreementId,
        ticketTypeId,
        assetId,
        title,
        description,
        location,
        priorityLevel,
        req.user.id,
      ]
    );

    const ticket = ticketInsert.rows[0];

    const slaTrackingInsert = await client.query(
      `
      INSERT INTO ticket_sla_tracking (
        ticket_id,
        sla_policy_id,
        start_time,
        expected_end_time,
        sla_status
      )
      VALUES (
        $1,
        $2,
        now(),
        now() + ($3::text || ' minutes')::interval,
        'ACTIVE'
      )
      RETURNING *
      `,
      [ticket.id, policy.id, policy.target_resolution_minutes]
    );

    const threadInsert = await client.query(
      `
      INSERT INTO ticket_chat_threads (
        ticket_id,
        status
      )
      VALUES ($1, 'OPEN')
      RETURNING *
      `,
      [ticket.id]
    );

    const contractorRecipientIds = await getAssignmentRecipients(ticket, client);
    const participantLookup = await client.query(
      `
      SELECT id
      FROM users
      WHERE is_active = TRUE
        AND (
          organization_id = $1
          OR id = ANY($2::uuid[])
          OR id = $3
        )
      `,
      [requestingOrganizationId, contractorRecipientIds, req.user.id]
    );

    await addChatParticipants(
      client,
      threadInsert.rows[0].id,
      participantLookup.rows.map((row) => row.id)
    );

    const assignedUserIds = contractorRecipientIds;

    await createNotificationsForUsers(
      assignedUserIds,
      {
        title: "New Ticket Assigned",
        message: `${ticket.ticket_number} has been assigned to your organization.`,
        type: "INFO",
        entityType: "ticket",
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      },
      client
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "TICKET_CREATED",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: {
        ticket_number: ticket.ticket_number,
        requesting_organization_id: requestingOrganizationId,
        assigned_organization_id: assignedOrganizationId,
        priority_level: priorityLevel,
      },
      executor: client,
    });

    await client.query("COMMIT");

    postCommitNotification = {
      userIds: assignedUserIds,
      subject: `New Ticket Assigned: ${ticket.ticket_number}`,
      text: `Ticket ${ticket.ticket_number} has been assigned to your organization.\n\nTitle: ${ticket.title}\nPriority: ${"★".repeat(priorityLevel)}\nClient: ${requestingOrganizationId}\nSLA status: Active\n\nOpen ContractorLink to review the request and begin work.`,
    };

    if (postCommitNotification.userIds.length) {
      void sendEmailToUsers(postCommitNotification.userIds, "email_ticket_assigned", {
        subject: postCommitNotification.subject,
        text: postCommitNotification.text,
      }).catch((error) => console.error("TICKET ASSIGNMENT EMAIL ERROR:", error.message));
    }

    void scoreBreachRisk(mlFeatures)
      .then((prediction) => pool.query(
        `INSERT INTO ticket_ml_feedback (ticket_id, model_version, predicted_breach_risk)
         VALUES ($1,$2,$3)
         ON CONFLICT (ticket_id) DO UPDATE
         SET model_version = EXCLUDED.model_version,
             predicted_breach_risk = EXCLUDED.predicted_breach_risk`,
        [ticket.id, prediction.model_version, prediction.breach_risk]
      ))
      .catch((error) => console.error("ML TICKET SCORE ERROR:", error.message));

    return res.status(201).json({
      ticket,
      sla_tracking: slaTrackingInsert.rows[0],
      chat_thread: threadInsert.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CREATE TICKET ERROR:", error);
    return res.status(500).json({ error: "Failed to create ticket" });
  } finally {
    client.release();
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const canUpdate = roleCode(req) === "SUPER_ADMIN"
      || String(req.user.organization_id) === String(ticket.requesting_organization_id)
      || (String(req.user.organization_id) === String(ticket.assigned_organization_id)
        && roleCode(req) === "ORG_ADMIN");
    if (!canUpdate) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const status = req.body?.status ? String(req.body.status).trim().toUpperCase() : null;
    const issueFound =
      typeof req.body?.issue_found === "string" ? req.body.issue_found.trim() : null;
    const fixApplied =
      typeof req.body?.fix_applied === "string" ? req.body.fix_applied.trim() : null;
    const resolutionNote =
      typeof req.body?.resolution_note === "string" ? req.body.resolution_note.trim() : null;

    if (status && !["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"].includes(status)) {
      return res.status(400).json({
        error: "status must be OPEN, IN_PROGRESS, ON_HOLD, COMPLETED, or CANCELLED",
      });
    }
    if (status === "COMPLETED" && String(ticket.status).toUpperCase() === "COMPLETED") {
      return res.status(409).json({ error: "This ticket has already been completed." });
    }
    if (status === "CANCELLED" && String(ticket.status).toUpperCase() === "CANCELLED") {
      return res.status(409).json({ error: "This ticket has already been cancelled." });
    }
    if (status === "CANCELLED" && String(ticket.status).toUpperCase() === "COMPLETED") {
      return res.status(400).json({ error: "Completed tickets cannot be cancelled." });
    }
    if (status === "CANCELLED" && String(req.user.organization_id) !== String(ticket.requesting_organization_id)) {
      return res.status(403).json({ error: "Only the client Organization Admin that created this ticket can cancel it." });
    }

    const nextCompletedBy =
      status === "COMPLETED" && !ticket.completed_by ? req.user.id : null;

    const query = `
      UPDATE tickets
      SET
        status = COALESCE($1, status),
        issue_found = COALESCE($2, issue_found),
        fix_applied = COALESCE($3, fix_applied),
        resolution_note = COALESCE($4, resolution_note),
        completed_by = CASE WHEN $1::varchar = 'COMPLETED' THEN COALESCE(completed_by, $5::uuid) ELSE completed_by END,
        completed_at = CASE WHEN $1::varchar = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE completed_at END,
        updated_at = now()
      WHERE id = $6
        AND NOT ($1::varchar IN ('COMPLETED', 'CANCELLED') AND status = $1::varchar)
      RETURNING *
    `;

    const { rows } = await pool.query(query, [
      status,
      issueFound,
      fixApplied,
      resolutionNote,
      nextCompletedBy,
      req.params.id,
    ]);
    if (!rows.length) {
      return res.status(409).json({ error: "This ticket has already been completed." });
    }

    if (status === "COMPLETED") {
      const tracking = await pool.query(`SELECT sla_status FROM ticket_sla_tracking WHERE ticket_id = $1 LIMIT 1`, [ticket.id]);
      const actualBreached = tracking.rows[0]?.sla_status === "BREACHED";
      await pool.query(
        `
        UPDATE ticket_sla_tracking
        SET
          actual_end_time = now(),
          sla_status = 'COMPLETED',
          updated_at = now()
        WHERE ticket_id = $1
        `,
        [req.params.id]
      );

      await pool.query(
        `UPDATE ticket_ml_feedback SET actual_breached = $1, captured_at = now() WHERE ticket_id = $2`,
        [actualBreached, ticket.id]
      );

      await pool.query(
        `
        UPDATE ticket_chat_threads
        SET
          status = 'LOCKED',
          locked_at = COALESCE(locked_at, now())
        WHERE ticket_id = $1
        `,
        [req.params.id]
      );

      const affectedUsers = await getActiveUsersForOrganizations([
        ticket.requesting_organization_id,
        ticket.assigned_organization_id,
      ]);

      const affectedUserIds = affectedUsers.map((user) => user.id);

      await createNotificationsForUsers(affectedUserIds, {
        title: "Ticket Completed",
        message: `${ticket.ticket_number} has been marked as completed.`,
        type: "SUCCESS",
        entityType: "ticket",
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      });

      void sendEmailToUsers(affectedUserIds, "email_ticket_completed", {
        subject: `Ticket Completed: ${ticket.ticket_number}`,
        text: `Ticket ${ticket.ticket_number} has been marked as completed.\n\nTitle: ${ticket.title}\nIssue found: ${issueFound || "Not recorded"}\nWork delivered or fix applied: ${fixApplied || "Not recorded"}\nCompletion note: ${resolutionNote || "Not recorded"}\n\nOpen ContractorLink to review the full service record.`,
      }).catch((error) => console.error("TICKET COMPLETION EMAIL ERROR:", error.message));
    }

    if (status === "CANCELLED") {
      await pool.query(
        `UPDATE ticket_sla_tracking SET actual_end_time = now(), sla_status = 'COMPLETED', updated_at = now() WHERE ticket_id = $1`,
        [ticket.id]
      );
      await pool.query(
        `UPDATE ticket_chat_threads SET status = 'LOCKED', locked_at = COALESCE(locked_at, now()) WHERE ticket_id = $1`,
        [ticket.id]
      );
      const affectedUsers = await getActiveUsersForOrganizations([ticket.requesting_organization_id, ticket.assigned_organization_id]);
      const affectedUserIds = affectedUsers.map((user) => user.id);
      await createNotificationsForUsers(affectedUserIds, {
        title: "Ticket Cancelled",
        message: `${ticket.ticket_number} has been cancelled by the client.`,
        type: "WARNING",
        entityType: "ticket",
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      });
      void sendEmailToUsers(affectedUserIds, "email_ticket_updated", {
        subject: `Ticket Cancelled: ${ticket.ticket_number}`,
        text: `The client has cancelled ticket ${ticket.ticket_number}.\n\nTitle: ${ticket.title}\n\nThe SLA timer and ticket chat are now closed.`,
      }).catch((error) => console.error("TICKET CANCELLATION EMAIL ERROR:", error.message));
    }

    await logAudit({
      actorUserId: req.user.id,
      actionType: status === "COMPLETED" ? "TICKET_COMPLETED" : status === "CANCELLED" ? "TICKET_CANCELLED" : "TICKET_UPDATED",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: {
        status,
      },
    });

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE TICKET ERROR:", error);
    return res.status(500).json({ error: "Failed to update ticket" });
  }
});

router.get("/:id/reassignments", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (
      !canAccessOrganization(req, ticket.requesting_organization_id) &&
      !canAccessOrganization(req, ticket.assigned_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        tr.*,
        from_org.name AS from_organization_name,
        to_org.name AS to_organization_name,
        actor.full_name AS reassigned_by_name
      FROM ticket_reassignments tr
      JOIN organizations from_org
        ON from_org.id = tr.from_organization_id
      JOIN organizations to_org
        ON to_org.id = tr.to_organization_id
      JOIN users actor
        ON actor.id = tr.reassigned_by
      WHERE tr.ticket_id = $1
      ORDER BY tr.reassigned_at DESC
      `,
      [req.params.id]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST REASSIGNMENTS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch ticket reassignments" });
  }
});

router.post("/:id/reassign", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();
  let postCommitNotification = null;

  try {
    await client.query("BEGIN");

    const ticket = await getTicketById(req.params.id, client);
    if (!ticket) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (
      roleCode(req) !== "SUPER_ADMIN" &&
      String(req.user.organization_id) !== String(ticket.requesting_organization_id)
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (ticket.status === "COMPLETED" || ticket.status === "CANCELLED") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Completed or cancelled tickets cannot be reassigned",
      });
    }

    const nextAssignedOrganizationId = req.body?.assigned_organization_id;
    const nextAgreementId = req.body?.sla_agreement_id;
    const reasonText = String(req.body?.reason_text || "").trim();

    if (!nextAssignedOrganizationId || !nextAgreementId || !reasonText) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "assigned_organization_id, sla_agreement_id, and reason_text are required",
      });
    }

    if (String(nextAssignedOrganizationId) === String(ticket.assigned_organization_id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "assigned_organization_id must be different from the current assigned organization",
      });
    }

    const activeHoldCheck = await client.query(
      `
      SELECT id
      FROM hold_requests
      WHERE ticket_id = $1
        AND status IN ('PENDING', 'APPROVED')
      LIMIT 1
      `,
      [ticket.id]
    );

    if (activeHoldCheck.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Tickets with pending or approved holds must be resolved before reassignment",
      });
    }

    const nextAgreement = await getAgreementById(nextAgreementId, client);
    if (!nextAgreement) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "SLA agreement not found" });
    }

    const agreementMatches =
      String(nextAgreement.client_organization_id) === String(ticket.requesting_organization_id) &&
      String(nextAgreement.contractor_organization_id) === String(nextAssignedOrganizationId);

    if (!agreementMatches) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "SLA agreement does not match the ticket requester and new assigned organization",
      });
    }

    if (nextAgreement.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "New SLA agreement must be ACTIVE" });
    }

    const nextPolicy = await getPolicyForAgreement(nextAgreementId, ticket.priority_level, client);
    if (!nextPolicy) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No active SLA policy exists for the ticket priority under the new agreement",
      });
    }

    await client.query(
      `
      INSERT INTO ticket_reassignments (
        ticket_id,
        from_organization_id,
        to_organization_id,
        reason_text,
        reassigned_by
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        ticket.id,
        ticket.assigned_organization_id,
        nextAssignedOrganizationId,
        reasonText,
        req.user.id,
      ]
    );

    const ticketUpdate = await client.query(
      `
      UPDATE tickets
      SET
        assigned_organization_id = $1,
        sla_agreement_id = $2,
        status = 'OPEN',
        updated_at = now()
      WHERE id = $3
      RETURNING *
      `,
      [nextAssignedOrganizationId, nextAgreementId, ticket.id]
    );

    const currentTracking = await client.query(
      `
      SELECT *
      FROM ticket_sla_tracking
      WHERE ticket_id = $1
      LIMIT 1
      `,
      [ticket.id]
    );

    if (currentTracking.rowCount) {
      await client.query(
        `
        UPDATE ticket_sla_tracking
        SET
          sla_policy_id = $1,
          start_time = now(),
          expected_end_time = now() + ($2::text || ' minutes')::interval,
          actual_end_time = NULL,
          paused_duration_minutes = 0,
          pause_start_time = NULL,
          sla_status = 'ACTIVE',
          last_escalation_sent_at = NULL,
          updated_at = now()
        WHERE ticket_id = $3
        `,
        [nextPolicy.id, nextPolicy.target_resolution_minutes, ticket.id]
      );
    }

    const thread = await getChatThreadByTicketId(ticket.id, client);
    if (thread) {
      await replaceContractorParticipants(
        client,
        thread.id,
        ticket.assigned_organization_id,
        nextAssignedOrganizationId
      );

      await client.query(
        `
        INSERT INTO ticket_chat_messages (
          thread_id,
          sender_user_id,
          message_text,
          message_type
        )
        VALUES ($1, $2, $3, 'SYSTEM')
        `,
        [
          thread.id,
          req.user.id,
          `Ticket reassigned from organization ${ticket.assigned_organization_id} to ${nextAssignedOrganizationId}. Reason: ${reasonText}`,
        ]
      );
    }

    const affectedUsers = await getActiveUsersForOrganizations(
      [
        ticket.requesting_organization_id,
        ticket.assigned_organization_id,
        nextAssignedOrganizationId,
      ],
      client
    );

    const affectedUserIds = affectedUsers.map((user) => user.id);

    await createNotificationsForUsers(
      affectedUserIds,
      {
        title: "Ticket Reassigned",
        message: `${ticket.ticket_number} has been reassigned to a new contractor organization.`,
        type: "WARNING",
        entityType: "ticket",
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      },
      client
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "TICKET_REASSIGNED",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: {
        from_organization_id: ticket.assigned_organization_id,
        to_organization_id: nextAssignedOrganizationId,
        reason_text: reasonText,
      },
      executor: client,
    });

    await client.query("COMMIT");

    postCommitNotification = {
      userIds: affectedUserIds,
      subject: `Ticket Reassigned: ${ticket.ticket_number}`,
      text: `Ticket ${ticket.ticket_number} has been reassigned. Reason: ${reasonText}`,
    };

    if (postCommitNotification) {
      await sendEmailToUsers(postCommitNotification.userIds, "email_ticket_updated", {
        subject: postCommitNotification.subject,
        text: postCommitNotification.text,
      });
    }

    return res.json(ticketUpdate.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REASSIGN TICKET ERROR:", error);
    return res.status(500).json({ error: "Failed to reassign ticket" });
  } finally {
    client.release();
  }
});

module.exports = router;
