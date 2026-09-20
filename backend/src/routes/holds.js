const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { roleCode, canAccessOrganization } = require("../utils/orgAccess");
const {
  getActiveUsersForOrganizations,
  createNotificationsForUsers,
  sendEmailToUsers,
} = require("../services/notifications");
const { logAudit } = require("../services/audit");

const router = express.Router();
const UPLOAD_ROOT = path.join(process.env.UPLOAD_ROOT || path.join(__dirname, "..", "..", "uploads"), "hold-attachments");
const MAX_PROOF_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_PROOF_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"]);

function sanitizeFileName(fileName) {
  const extension = path.extname(fileName || "").slice(0, 16);
  const baseName = path.basename(fileName || "proof", extension).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  return `${baseName || "proof"}${extension}`;
}

function validateProof(proof, proofBuffer) {
  if (!proof?.content_base64) return null;
  const extension = path.extname(String(proof.file_name || "")).toLowerCase();
  if (!proof?.file_name || !proofBuffer?.length || proofBuffer.length > MAX_PROOF_SIZE_BYTES) {
    return "Proof files must include a name and be between 1 byte and 8 MB.";
  }
  if (!ALLOWED_PROOF_EXTENSIONS.has(extension)) {
    return "Proof files must be a PDF, image, Word document, or supported document type.";
  }
  return null;
}

async function storeProofAttachment(holdId, proof, proofBuffer, userId) {
  const directory = path.join(UPLOAD_ROOT, holdId);
  await fs.mkdir(directory, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${sanitizeFileName(proof.file_name)}`;
  await fs.writeFile(path.join(directory, storedName), proofBuffer);
  const { rows } = await pool.query(
    `INSERT INTO hold_attachments (hold_request_id, file_name, file_path, mime_type, uploaded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [holdId, String(proof.file_name).trim(), `/uploads/hold-attachments/${holdId}/${storedName}`, String(proof.mime_type || "application/octet-stream"), userId]
  );
  return rows[0];
}

async function getTicketById(id) {
  const { rows } = await pool.query(
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

async function getHoldById(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM hold_requests
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getLatestOpenPauseEvent(client, ticketId) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM sla_pause_events
    WHERE ticket_id = $1
      AND resumed_at IS NULL
    ORDER BY paused_at DESC
    LIMIT 1
    `,
    [ticketId]
  );

  return rows[0] || null;
}

function canSubmitHold(req, ticket) {
  const currentRole = roleCode(req);
  return (
    ["ORG_ADMIN", "ORG_STAFF"].includes(currentRole) &&
    String(req.user.organization_id) === String(ticket.assigned_organization_id)
  );
}

function canReviewHold(req, ticket) {
  const currentRole = roleCode(req);
  return (
    currentRole === "ORG_ADMIN" &&
    String(req.user.organization_id) === String(ticket.requesting_organization_id)
  );
}

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const requestedStatus = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const requestedTicketId = req.query.ticket_id || null;
    const requestedOrgId = req.query.organization_id || null;
    const params = [];
    const clauses = [];
    const currentRole = roleCode(req);

    if (requestedStatus) {
      params.push(requestedStatus);
      clauses.push(`h.status = $${params.length}`);
    }

    if (requestedTicketId) {
      params.push(requestedTicketId);
      clauses.push(`h.ticket_id = $${params.length}`);
    }

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

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        h.*,
        t.ticket_number,
        t.title AS ticket_title,
        t.status AS ticket_status,
        t.requesting_organization_id,
        t.assigned_organization_id,
        requester.name AS requesting_organization_name,
        assigned.name AS assigned_organization_name,
        submitter.full_name AS submitted_by_name,
        reviewer.full_name AS reviewed_by_name,
        COUNT(ha.id)::int AS attachment_count,
        MAX(ha.file_path) AS attachment_path,
        MAX(ha.file_name) AS attachment_name
      FROM hold_requests h
      JOIN tickets t
        ON t.id = h.ticket_id
      JOIN organizations requester
        ON requester.id = t.requesting_organization_id
      JOIN organizations assigned
        ON assigned.id = t.assigned_organization_id
      JOIN users submitter
        ON submitter.id = h.submitted_by
      LEFT JOIN users reviewer
        ON reviewer.id = h.reviewed_by
      LEFT JOIN hold_attachments ha
        ON ha.hold_request_id = h.id
      ${where}
      GROUP BY
        h.id,
        t.ticket_number,
        t.title,
        t.status,
        t.requesting_organization_id,
        t.assigned_organization_id,
        requester.name,
        assigned.name,
        submitter.full_name,
        reviewer.full_name
      ORDER BY h.created_at DESC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST HOLDS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch hold requests" });
  }
});

router.get("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        h.*,
        t.ticket_number,
        t.title AS ticket_title,
        t.status AS ticket_status,
        t.requesting_organization_id,
        t.assigned_organization_id,
        requester.name AS requesting_organization_name,
        assigned.name AS assigned_organization_name,
        submitter.full_name AS submitted_by_name,
        reviewer.full_name AS reviewed_by_name
      FROM hold_requests h
      JOIN tickets t
        ON t.id = h.ticket_id
      JOIN organizations requester
        ON requester.id = t.requesting_organization_id
      JOIN organizations assigned
        ON assigned.id = t.assigned_organization_id
      JOIN users submitter
        ON submitter.id = h.submitted_by
      LEFT JOIN users reviewer
        ON reviewer.id = h.reviewed_by
      WHERE h.id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Hold request not found" });
    }

    const hold = rows[0];
    if (
      !canAccessOrganization(req, hold.requesting_organization_id) &&
      !canAccessOrganization(req, hold.assigned_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const attachments = await pool.query(
      `
      SELECT *
      FROM hold_attachments
      WHERE hold_request_id = $1
      ORDER BY created_at ASC
      `,
      [req.params.id]
    );

    return res.json({
      hold_request: hold,
      attachments: attachments.rows,
    });
  } catch (error) {
    console.error("GET HOLD ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch hold request" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF"), async (req, res) => {
  try {
    const ticketId = req.body?.ticket_id;
    const reasonText = String(req.body?.reason_text || "").trim();
    const proof = req.body?.proof || null;
    const proofBuffer = proof?.content_base64 ? Buffer.from(String(proof.content_base64), "base64") : null;

    if (!ticketId || !reasonText) {
      return res.status(400).json({ error: "ticket_id and reason_text are required" });
    }
    const proofError = validateProof(proof, proofBuffer);
    if (proofError) return res.status(400).json({ error: proofError });

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!canSubmitHold(req, ticket)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!["OPEN", "IN_PROGRESS", "ON_HOLD"].includes(ticket.status)) {
      return res.status(400).json({
        error: "Hold requests can only be created for open or in-progress tickets",
      });
    }

    const pendingCheck = await pool.query(
      `
      SELECT id
      FROM hold_requests
      WHERE ticket_id = $1
        AND status = 'PENDING'
      LIMIT 1
      `,
      [ticketId]
    );

    if (pendingCheck.rowCount) {
      return res.status(409).json({ error: "This ticket already has a pending hold request" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO hold_requests (
        ticket_id,
        submitted_by,
        reason_text
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [ticketId, req.user.id, reasonText]
    );

    if (proofBuffer) rows[0].attachment = await storeProofAttachment(rows[0].id, proof, proofBuffer, req.user.id);

    const requesterUsers = await getActiveUsersForOrganizations([
      ticket.requesting_organization_id,
    ]);
    const requesterUserIds = requesterUsers.map((user) => user.id);

    await createNotificationsForUsers(requesterUserIds, {
      title: "New Hold Request",
      message: `A hold request has been submitted for ticket ${ticket.ticket_number}.`,
      type: "WARNING",
      entityType: "hold_request",
      entityId: rows[0].id,
      link: `/tickets/${ticket.id}#hold-requests`,
    });

    await sendEmailToUsers(requesterUserIds, "email_ticket_updated", {
      subject: `Hold Request Submitted: ${ticket.ticket_number}`,
      text: `A hold request has been submitted for ticket ${ticket.ticket_number}. Reason: ${reasonText}`,
    });

    await logAudit({
      actorUserId: req.user.id,
      actionType: "HOLD_REQUEST_CREATED",
      entityType: "hold_request",
      entityId: rows[0].id,
      metadata: {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE HOLD ERROR:", error);
    return res.status(500).json({ error: "Failed to create hold request" });
  }
});

router.post("/:id/attachments", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF"), async (req, res) => {
  try {
    const hold = await getHoldById(req.params.id);
    if (!hold) {
      return res.status(404).json({ error: "Hold request not found" });
    }

    const ticket = await getTicketById(hold.ticket_id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!canSubmitHold(req, ticket)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (hold.status !== "PENDING") {
      return res.status(400).json({ error: "Attachments can only be added to pending hold requests" });
    }

    const proof = req.body?.proof || null;
    const proofBuffer = proof?.content_base64 ? Buffer.from(String(proof.content_base64), "base64") : null;
    const proofError = validateProof(proof, proofBuffer);
    if (proofError) return res.status(400).json({ error: proofError });
    if (!proofBuffer) return res.status(400).json({ error: "A proof file is required" });

    const attachment = await storeProofAttachment(hold.id, proof, proofBuffer, req.user.id);

    await logAudit({
      actorUserId: req.user.id,
      actionType: "HOLD_ATTACHMENT_ADDED",
      entityType: "hold_attachment",
      entityId: attachment.id,
      metadata: {
        hold_request_id: hold.id,
        file_name: attachment.file_name,
      },
    });

    return res.status(201).json(attachment);
  } catch (error) {
    console.error("CREATE HOLD ATTACHMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to add hold attachment" });
  }
});

router.patch("/:id/review", requireRole("ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();
  let emailPayload = null;

  try {
    await client.query("BEGIN");

    const hold = await getHoldById(req.params.id);
    if (!hold) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Hold request not found" });
    }

    const ticket = await getTicketById(hold.ticket_id);
    if (!ticket) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!canReviewHold(req, ticket)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (hold.status !== "PENDING") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only pending hold requests can be reviewed" });
    }

    const nextStatus = String(req.body?.status || "").trim().toUpperCase();
    const rejectionReason = String(req.body?.rejection_reason || "").trim() || null;

    if (!["APPROVED", "REJECTED"].includes(nextStatus)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "status must be APPROVED or REJECTED" });
    }

    if (nextStatus === "REJECTED" && !rejectionReason) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "rejection_reason is required when rejecting a hold" });
    }

    if (nextStatus === "APPROVED") {
      const openPauseEvent = await getLatestOpenPauseEvent(client, ticket.id);
      if (openPauseEvent) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This ticket already has an active SLA pause" });
      }

      await client.query(
        `
        UPDATE ticket_sla_tracking
        SET
          sla_status = 'PAUSED',
          pause_start_time = now(),
          updated_at = now()
        WHERE ticket_id = $1
        `,
        [ticket.id]
      );

      await client.query(
        `
        INSERT INTO sla_pause_events (
          ticket_id,
          paused_by,
          reason_text
        )
        VALUES ($1, $2, $3)
        `,
        [ticket.id, req.user.id, hold.reason_text]
      );

      await client.query(
        `
        UPDATE tickets
        SET
          status = 'ON_HOLD',
          updated_at = now()
        WHERE id = $1
        `,
        [ticket.id]
      );
    }

    const reviewUpdate = await client.query(
      `
      UPDATE hold_requests
      SET
        status = $1,
        rejection_reason = $2,
        reviewed_by = $3,
        reviewed_at = now(),
        updated_at = now()
      WHERE id = $4
      RETURNING *
      `,
      [nextStatus, nextStatus === "REJECTED" ? rejectionReason : null, req.user.id, hold.id]
    );

    const assignedUsers = await getActiveUsersForOrganizations(
      [ticket.assigned_organization_id],
      client
    );
    const assignedUserIds = assignedUsers.map((user) => user.id);

    await createNotificationsForUsers(
      assignedUserIds,
      {
        title: nextStatus === "APPROVED" ? "Hold Approved" : "Hold Rejected",
        message:
          nextStatus === "APPROVED"
            ? `Your hold request for ticket ${ticket.ticket_number} has been approved.`
            : `Your hold request for ticket ${ticket.ticket_number} has been rejected.`,
        type: nextStatus === "APPROVED" ? "SUCCESS" : "DANGER",
        entityType: "hold_request",
        entityId: hold.id,
        link: `/tickets/${ticket.id}#hold-requests`,
      },
      client
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: nextStatus === "APPROVED" ? "HOLD_REQUEST_APPROVED" : "HOLD_REQUEST_REJECTED",
      entityType: "hold_request",
      entityId: hold.id,
      metadata: {
        ticket_id: ticket.id,
        rejection_reason: rejectionReason,
      },
      executor: client,
    });

    await client.query("COMMIT");

    emailPayload = {
      userIds: assignedUserIds,
      subject:
        nextStatus === "APPROVED"
          ? `Hold Approved: ${ticket.ticket_number}`
          : `Hold Rejected: ${ticket.ticket_number}`,
      text:
        nextStatus === "APPROVED"
          ? `Your hold request for ticket ${ticket.ticket_number} has been approved.`
          : `Your hold request for ticket ${ticket.ticket_number} has been rejected. Reason: ${rejectionReason}`,
    };

    if (emailPayload.userIds.length) {
      await sendEmailToUsers(emailPayload.userIds, "email_hold_reviewed", {
        subject: emailPayload.subject,
        text: emailPayload.text,
      });
    }

    return res.json(reviewUpdate.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REVIEW HOLD ERROR:", error);
    return res.status(500).json({ error: "Failed to review hold request" });
  } finally {
    client.release();
  }
});

router.patch("/:id/close", requireRole("ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();
  let emailPayload = null;

  try {
    await client.query("BEGIN");

    const hold = await getHoldById(req.params.id);
    if (!hold) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Hold request not found" });
    }

    const ticket = await getTicketById(hold.ticket_id);
    if (!ticket) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (!canReviewHold(req, ticket)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (hold.status !== "APPROVED") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only approved hold requests can be closed" });
    }

    const pauseEvent = await getLatestOpenPauseEvent(client, ticket.id);
    if (!pauseEvent) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No active SLA pause event exists for this ticket" });
    }

    const pauseMinutesResult = await client.query(
      `
      SELECT CEIL(EXTRACT(EPOCH FROM (now() - paused_at)) / 60.0)::int AS paused_minutes
      FROM sla_pause_events
      WHERE id = $1
      `,
      [pauseEvent.id]
    );

    const pausedMinutes = Number(pauseMinutesResult.rows[0]?.paused_minutes || 0);

    await client.query(
      `
      UPDATE sla_pause_events
      SET
        resumed_at = now(),
        paused_minutes = $1
      WHERE id = $2
      `,
      [pausedMinutes, pauseEvent.id]
    );

    await client.query(
      `
      UPDATE ticket_sla_tracking
      SET
        paused_duration_minutes = paused_duration_minutes + $1,
        pause_start_time = NULL,
        expected_end_time = expected_end_time + ($1::text || ' minutes')::interval,
        sla_status = 'ACTIVE',
        updated_at = now()
      WHERE ticket_id = $2
      `,
      [pausedMinutes, ticket.id]
    );

    await client.query(
      `
      UPDATE tickets
      SET
        status = 'IN_PROGRESS',
        updated_at = now()
      WHERE id = $1
      `,
      [ticket.id]
    );

    const holdUpdate = await client.query(
      `
      UPDATE hold_requests
      SET
        status = 'CLOSED',
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [hold.id]
    );

    const affectedUsers = await getActiveUsersForOrganizations(
      [ticket.requesting_organization_id, ticket.assigned_organization_id],
      client
    );
    const affectedUserIds = affectedUsers.map((user) => user.id);

    await createNotificationsForUsers(
      affectedUserIds,
      {
        title: "Hold Closed",
        message: `Hold for ticket ${ticket.ticket_number} has been closed and work can continue.`,
        type: "INFO",
        entityType: "hold_request",
        entityId: hold.id,
        link: `/tickets/${ticket.id}#hold-requests`,
      },
      client
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "HOLD_REQUEST_CLOSED",
      entityType: "hold_request",
      entityId: hold.id,
      metadata: {
        ticket_id: ticket.id,
        paused_minutes: pausedMinutes,
      },
      executor: client,
    });

    await client.query("COMMIT");

    emailPayload = {
      userIds: affectedUserIds,
      subject: `Hold Closed: ${ticket.ticket_number}`,
      text: `Hold for ticket ${ticket.ticket_number} has been closed and SLA timing has resumed.`,
    };

    if (emailPayload.userIds.length) {
      await sendEmailToUsers(emailPayload.userIds, "email_ticket_updated", {
        subject: emailPayload.subject,
        text: emailPayload.text,
      });
    }

    return res.json(holdUpdate.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CLOSE HOLD ERROR:", error);
    return res.status(500).json({ error: "Failed to close hold request" });
  } finally {
    client.release();
  }
});

module.exports = router;
