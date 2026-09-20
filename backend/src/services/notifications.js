const pool = require("../config/db");
const { sendMail } = require("./mailer");
const { emitToUsers } = require("./realtime");

const ALLOWED_EMAIL_PREFS = new Set([
  "email_ticket_assigned",
  "email_ticket_updated",
  "email_sla_breached",
  "email_hold_reviewed",
  "email_ticket_completed",
]);

async function getActiveUsersForOrganizations(organizationIds, executor = pool) {
  const ids = [...new Set((organizationIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];

  const { rows } = await executor.query(
    `
    SELECT
      u.id,
      u.organization_id,
      u.full_name,
      u.email
    FROM users u
    WHERE u.is_active = TRUE
      AND u.organization_id = ANY($1::uuid[])
    ORDER BY u.full_name ASC
    `,
    [ids]
  );

  rows.forEach((notification) => emitToUsers([notification.user_id], "notification:new", notification));
  return rows;
}

async function createNotificationsForUsers(userIds, payload, executor = pool) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];

  const values = [];
  const params = [];

  ids.forEach((userId, index) => {
    const offset = index * 7;
    values.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
    );

    params.push(
      userId,
      payload.title,
      payload.message,
      payload.type || "INFO",
      payload.entityType || null,
      payload.entityId || null,
      payload.link || null
    );
  });

  const { rows } = await executor.query(
    `
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      entity_type,
      entity_id,
      link
    )
    VALUES ${values.join(", ")}
    RETURNING *
    `,
    params
  );

  return rows;
}

async function sendEmailToUsers(userIds, preferenceKey, { subject, text, html }, executor = pool) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: false, skipped: true, reason: "No users provided" };

  if (!ALLOWED_EMAIL_PREFS.has(preferenceKey)) {
    return { ok: false, skipped: true, reason: "Unsupported email preference key" };
  }

  const { rows } = await executor.query(
    `
    SELECT
      u.email
    FROM users u
    LEFT JOIN user_notification_settings uns
      ON uns.user_id = u.id
    WHERE u.is_active = TRUE
      AND u.id = ANY($1::uuid[])
      AND COALESCE(uns.${preferenceKey}, TRUE) = TRUE
      AND u.email IS NOT NULL
    `,
    [ids]
  );

  const emails = [...new Set(rows.map((row) => row.email).filter(Boolean))];
  if (!emails.length) {
    return { ok: false, skipped: true, reason: "No recipients opted in" };
  }

  return sendMail({
    to: emails.join(", "),
    subject,
    text,
    html,
  });
}

module.exports = {
  getActiveUsersForOrganizations,
  createNotificationsForUsers,
  sendEmailToUsers,
};
