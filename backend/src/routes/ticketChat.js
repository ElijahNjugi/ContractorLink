const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { canAccessOrganization } = require("../utils/orgAccess");
const { logAudit } = require("../services/audit");
const { createNotificationsForUsers } = require("../services/notifications");
const { emitToUsers } = require("../services/realtime");

const router = express.Router();

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

async function getThreadByTicketId(ticketId) {
  const { rows } = await pool.query(
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

function ticketChatHasExpired(ticket) {
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(String(ticket.status).toUpperCase())) return true;
  return ticket.expected_end_time && new Date(ticket.expected_end_time).getTime() <= Date.now();
}

async function lockExpiredThread(thread, ticket) {
  if (thread.status !== "OPEN" || !ticketChatHasExpired(ticket)) return thread;
  const { rows } = await pool.query(
    `UPDATE ticket_chat_threads
     SET status = 'LOCKED', locked_at = COALESCE(locked_at, now())
     WHERE id = $1
     RETURNING *`,
    [thread.id]
  );
  return rows[0] || thread;
}

async function isThreadParticipant(threadId, userId) {
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM ticket_chat_participants
    WHERE thread_id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [threadId, userId]
  );

  return rows.length > 0;
}

router.get("/:ticketId", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (
      !canAccessOrganization(req, ticket.requesting_organization_id) &&
      !canAccessOrganization(req, ticket.assigned_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let thread = await getThreadByTicketId(ticket.id);
    if (!thread) {
      return res.status(404).json({ error: "Ticket chat thread not found" });
    }
    thread = await lockExpiredThread(thread, ticket);

    const participantsResult = await pool.query(
      `
      SELECT
        tcp.id,
        tcp.thread_id,
        tcp.user_id,
        tcp.participant_role,
        tcp.joined_at,
        u.full_name,
        u.email,
        u.phone,
        u.job_title,
        r.code AS role_code,
        r.name AS role_name,
        o.id AS organization_id,
        o.name AS organization_name
      FROM ticket_chat_participants tcp
      JOIN users u
        ON u.id = tcp.user_id
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE tcp.thread_id = $1
      ORDER BY tcp.joined_at ASC, u.full_name ASC
      `,
      [thread.id]
    );

    const messagesResult = await pool.query(
      `
      SELECT
        tcm.*,
        u.full_name AS sender_name,
        u.email AS sender_email,
        r.code AS sender_role_code,
        o.name AS sender_organization_name
      FROM ticket_chat_messages tcm
      JOIN users u
        ON u.id = tcm.sender_user_id
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE tcm.thread_id = $1
      ORDER BY tcm.created_at ASC
      `,
      [thread.id]
    );

    return res.json({
      thread,
      participants: participantsResult.rows,
      messages: messagesResult.rows,
    });
  } catch (error) {
    console.error("GET TICKET CHAT ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch ticket chat" });
  }
});

router.post("/:ticketId/messages", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (
      !canAccessOrganization(req, ticket.requesting_organization_id) &&
      !canAccessOrganization(req, ticket.assigned_organization_id)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let thread = await getThreadByTicketId(ticket.id);
    if (!thread) {
      return res.status(404).json({ error: "Ticket chat thread not found" });
    }
    thread = await lockExpiredThread(thread, ticket);

    if (thread.status !== "OPEN") {
      return res.status(400).json({ error: "This chat thread is locked" });
    }

    const isParticipant = await isThreadParticipant(thread.id, req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ error: "You are not a participant in this chat thread" });
    }

    const messageText = String(req.body?.message_text || "").trim();
    if (!messageText) {
      return res.status(400).json({ error: "message_text is required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO ticket_chat_messages (
        thread_id,
        sender_user_id,
        message_text,
        message_type
      )
      VALUES ($1, $2, $3, 'TEXT')
      RETURNING *
      `,
      [thread.id, req.user.id, messageText]
    );

    const enriched = await pool.query(
      `
      SELECT
        tcm.*,
        u.full_name AS sender_name,
        u.email AS sender_email,
        r.code AS sender_role_code,
        o.name AS sender_organization_name
      FROM ticket_chat_messages tcm
      JOIN users u
        ON u.id = tcm.sender_user_id
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE tcm.id = $1
      LIMIT 1
      `,
      [rows[0].id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "TICKET_CHAT_MESSAGE_SENT",
      entityType: "ticket_chat_message",
      entityId: rows[0].id,
      metadata: {
        ticket_id: ticket.id,
        thread_id: thread.id,
        message_type: "TEXT",
      },
    });

    const recipients = await pool.query(
      `SELECT user_id
       FROM ticket_chat_participants
       WHERE thread_id = $1
         AND user_id <> $2`,
      [thread.id, req.user.id]
    );
    await createNotificationsForUsers(
      recipients.rows.map((row) => row.user_id),
      {
        title: "New ticket message",
        message: `${req.user.full_name || "A participant"} sent a message on ${ticket.ticket_number}: ${messageText.slice(0, 120)}`,
        type: "INFO",
        entityType: "ticket",
        entityId: ticket.id,
        link: `/tickets/${ticket.id}#ticket-chat`,
      }
    );
    emitToUsers(recipients.rows.map((row) => row.user_id), "ticket-chat:message", { ticket_id: ticket.id, message: enriched.rows[0] });

    return res.status(201).json(enriched.rows[0]);
  } catch (error) {
    console.error("SEND TICKET CHAT MESSAGE ERROR:", error);
    return res.status(500).json({ error: "Failed to send ticket chat message" });
  }
});

module.exports = router;
