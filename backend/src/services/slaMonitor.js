const pool = require("../config/db");
const { sendMail } = require("./mailer");
const { createNotificationsForUsers, getActiveUsersForOrganizations } = require("./notifications");

let monitorTimer = null;
let monitorRunning = false;

function escalationEmailEnabled() {
  return String(process.env.SLA_ESCALATION_EMAILS_ENABLED || "false").toLowerCase() === "true";
}

function minutesSince(startTime, endTime = new Date()) {
  return Math.floor((endTime.getTime() - new Date(startTime).getTime()) / 60000);
}

async function isAutoEscalationEnabled(executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT auto_escalation
    FROM system_settings
    ORDER BY created_at ASC
    LIMIT 1
    `
  );

  if (!rows.length) {
    return true;
  }

  return rows[0].auto_escalation !== false;
}

async function escalationAlreadySent(ticketId, escalationId, cycleKey, executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT 1
    FROM audit_logs
    WHERE action_type = 'SLA_ESCALATION_SENT'
      AND entity_type = 'ticket'
      AND entity_id = $1
      AND metadata_json->>'escalation_id' = $2
      AND metadata_json->>'cycle_key' = $3
    LIMIT 1
    `,
    [ticketId, String(escalationId), String(cycleKey)]
  );

  return rows.length > 0;
}

async function recordEscalationAudit(ticket, escalation, cycleKey, executor = pool) {
  await executor.query(
    `
    INSERT INTO audit_logs (
      actor_user_id,
      action_type,
      entity_type,
      entity_id,
      metadata_json
    )
    VALUES ($1, 'SLA_ESCALATION_SENT', 'ticket', $2, $3::jsonb)
    `,
    [
      null,
      ticket.ticket_id,
      JSON.stringify({
        escalation_id: escalation.escalation_id,
        cycle_key: String(cycleKey),
        trigger_event_type: escalation.trigger_event_type,
        trigger_minutes: escalation.trigger_minutes,
        contact_id: escalation.contact_id,
      }),
    ]
  );
}

async function notifyEscalation(ticket, escalation, cycleKey, executor = pool) {
  const title =
    escalation.trigger_event_type === "WARNING"
      ? `SLA Warning: ${ticket.ticket_number}`
      : escalation.trigger_event_type === "BREACH"
        ? `SLA Breach: ${ticket.ticket_number}`
        : `Post-Breach Reminder: ${ticket.ticket_number}`;

  const message =
    escalation.trigger_event_type === "WARNING"
      ? `${ticket.ticket_number} has reached escalation level ${escalation.level_no} before breach.`
      : escalation.trigger_event_type === "BREACH"
        ? `${ticket.ticket_number} has breached its SLA and needs attention.`
        : `${ticket.ticket_number} remains overdue after breach and requires follow-up.`;

  const emailText = [
    `Ticket: ${ticket.ticket_number}`,
    `Title: ${ticket.title}`,
    `Client: ${ticket.requesting_organization_name}`,
    `Contractor: ${ticket.assigned_organization_name}`,
    `Priority: ${ticket.priority_level}`,
    `Escalation Level: ${escalation.level_no}`,
    `Trigger Type: ${escalation.trigger_event_type}`,
    `Location: ${ticket.location || "N/A"}`,
    `Contact: ${escalation.contact_name || "N/A"}`,
  ].join("\n");

  if (escalation.contact_email && escalationEmailEnabled()) {
    await sendMail({
      to: escalation.contact_email,
      subject: title,
      text: `${message}\n\n${emailText}`,
    });
  }

  const orgUsers = await getActiveUsersForOrganizations(
    [ticket.requesting_organization_id, ticket.assigned_organization_id],
    executor
  );
  const orgUserIds = orgUsers.map((user) => user.id);

  if (orgUserIds.length) {
    await createNotificationsForUsers(
      orgUserIds,
      {
        title,
        message,
        type:
          escalation.trigger_event_type === "WARNING"
            ? "WARNING"
            : escalation.trigger_event_type === "BREACH"
              ? "DANGER"
              : "INFO",
        entityType: "ticket",
        entityId: ticket.ticket_id,
        link: `/tickets/${ticket.ticket_id}`,
      },
      executor
    );
  }

  await recordEscalationAudit(ticket, escalation, cycleKey, executor);
}

async function processTicketEscalations(ticket, now, executor = pool) {
  const elapsedMinutes = minutesSince(ticket.start_time, now);
  const results = {
    ticket_id: ticket.ticket_id,
    sent: 0,
    status_changed: false,
  };

  const breachReached = now >= new Date(ticket.expected_end_time);
  if (breachReached && ticket.sla_status !== "BREACHED") {
    await executor.query(
      `
      UPDATE ticket_sla_tracking
      SET
        sla_status = 'BREACHED',
        updated_at = now()
      WHERE ticket_id = $1
      `,
      [ticket.ticket_id]
    );
    results.status_changed = true;
  }

  for (const escalation of ticket.escalations) {
    if (escalation.trigger_event_type === "POST_BREACH_REPEAT") {
      if (elapsedMinutes < escalation.trigger_minutes || !escalation.repeat_every_minutes) {
        continue;
      }

      const repeatOffset = elapsedMinutes - escalation.trigger_minutes;
      const cycleIndex = Math.floor(repeatOffset / escalation.repeat_every_minutes);
      if (cycleIndex < 0) {
        continue;
      }

      const cycleKey = `${escalation.escalation_id}:${cycleIndex}`;
      const alreadySent = await escalationAlreadySent(
        ticket.ticket_id,
        escalation.escalation_id,
        cycleKey,
        executor
      );

      if (!alreadySent) {
        await notifyEscalation(ticket, escalation, cycleKey, executor);
        results.sent += 1;
      }

      continue;
    }

    if (elapsedMinutes < escalation.trigger_minutes) {
      continue;
    }

    const cycleKey = `${escalation.escalation_id}:base`;
    const alreadySent = await escalationAlreadySent(
      ticket.ticket_id,
      escalation.escalation_id,
      cycleKey,
      executor
    );

    if (!alreadySent) {
      await notifyEscalation(ticket, escalation, cycleKey, executor);
      results.sent += 1;
    }
  }

  if (results.sent > 0) {
    await executor.query(
      `
      UPDATE ticket_sla_tracking
      SET
        last_escalation_sent_at = now(),
        updated_at = now()
      WHERE ticket_id = $1
      `,
      [ticket.ticket_id]
    );
  }

  return results;
}

async function loadMonitorTickets(executor = pool) {
  const { rows } = await executor.query(
    `
    SELECT
      t.id AS ticket_id,
      t.ticket_number,
      t.title,
      t.location,
      t.priority_level,
      t.requesting_organization_id,
      t.assigned_organization_id,
      requester.name AS requesting_organization_name,
      assigned.name AS assigned_organization_name,
      sla.id AS sla_tracking_id,
      sla.start_time,
      sla.expected_end_time,
      sla.actual_end_time,
      sla.paused_duration_minutes,
      sla.pause_start_time,
      sla.sla_status,
      esc.id AS escalation_id,
      esc.level_no,
      esc.trigger_minutes,
      esc.trigger_event_type,
      esc.contact_id,
      esc.repeat_every_minutes,
      contact.name AS contact_name,
      contact.email AS contact_email
    FROM ticket_sla_tracking sla
    JOIN tickets t
      ON t.id = sla.ticket_id
    JOIN organizations requester
      ON requester.id = t.requesting_organization_id
    JOIN organizations assigned
      ON assigned.id = t.assigned_organization_id
    JOIN sla_agreement_escalations esc
      ON esc.sla_policy_id = sla.sla_policy_id
     AND esc.is_active = TRUE
    JOIN organization_contacts contact
      ON contact.id = esc.contact_id
    WHERE sla.sla_status IN ('ACTIVE', 'BREACHED')
      AND t.status IN ('OPEN', 'IN_PROGRESS')
    ORDER BY t.created_at ASC, esc.level_no ASC
    `
  );

  const tickets = new Map();

  for (const row of rows) {
    if (!tickets.has(row.ticket_id)) {
      tickets.set(row.ticket_id, {
        ticket_id: row.ticket_id,
        ticket_number: row.ticket_number,
        title: row.title,
        location: row.location,
        priority_level: row.priority_level,
        requesting_organization_id: row.requesting_organization_id,
        assigned_organization_id: row.assigned_organization_id,
        requesting_organization_name: row.requesting_organization_name,
        assigned_organization_name: row.assigned_organization_name,
        sla_tracking_id: row.sla_tracking_id,
        start_time: row.start_time,
        expected_end_time: row.expected_end_time,
        actual_end_time: row.actual_end_time,
        paused_duration_minutes: row.paused_duration_minutes,
        pause_start_time: row.pause_start_time,
        sla_status: row.sla_status,
        escalations: [],
      });
    }

    tickets.get(row.ticket_id).escalations.push({
      escalation_id: row.escalation_id,
      level_no: row.level_no,
      trigger_minutes: row.trigger_minutes,
      trigger_event_type: row.trigger_event_type,
      contact_id: row.contact_id,
      repeat_every_minutes: row.repeat_every_minutes,
      contact_name: row.contact_name,
      contact_email: row.contact_email,
    });
  }

  return [...tickets.values()];
}

async function runSlaMonitor({ force = false } = {}) {
  if (monitorRunning) {
    return { ok: true, skipped: true, reason: "Monitor already running" };
  }

  monitorRunning = true;

  try {
    if (!force) {
      const enabled = await isAutoEscalationEnabled();
      if (!enabled) {
        return { ok: true, skipped: true, reason: "Auto escalation disabled" };
      }
    }

    const now = new Date();
    const tickets = await loadMonitorTickets();
    const summary = {
      ok: true,
      checked_tickets: tickets.length,
      escalations_sent: 0,
      status_changes: 0,
    };

    for (const ticket of tickets) {
      const result = await processTicketEscalations(ticket, now);
      summary.escalations_sent += result.sent;
      if (result.status_changed) {
        summary.status_changes += 1;
      }
    }

    return summary;
  } catch (error) {
    console.error("SLA MONITOR ERROR:", error);
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    monitorRunning = false;
  }
}

function startSlaMonitor() {
  if (monitorTimer) {
    return monitorTimer;
  }

  const intervalMs = Number(process.env.SLA_MONITOR_INTERVAL_MS || 60000);
  const autoStart = String(process.env.SLA_MONITOR_ENABLED || "true").toLowerCase() !== "false";

  if (!autoStart) {
    return null;
  }

  monitorTimer = setInterval(() => {
    runSlaMonitor().catch((error) => {
      console.error("SLA MONITOR LOOP ERROR:", error);
    });
  }, intervalMs);

  if (typeof monitorTimer.unref === "function") {
    monitorTimer.unref();
  }

  return monitorTimer;
}

module.exports = {
  runSlaMonitor,
  startSlaMonitor,
};
