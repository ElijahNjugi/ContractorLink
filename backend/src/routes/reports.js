const express = require("express");
const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

router.get("/operations", requireRole("SUPER_ADMIN"), async (_req, res) => {
  try {
    const [summary, sla, contractors, recent] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_tickets, COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','ON_HOLD'))::int AS active_tickets, COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_tickets, ROUND((AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0) FILTER (WHERE completed_at IS NOT NULL))::numeric, 1) AS avg_resolution_hours FROM tickets`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE sla_status = 'BREACHED')::int AS breached_tickets, COUNT(*) FILTER (WHERE sla_status = 'COMPLETED')::int AS completed_with_sla, COUNT(*) FILTER (WHERE sla_status IN ('ACTIVE','PAUSED'))::int AS monitored_tickets FROM ticket_sla_tracking`),
      pool.query(`SELECT o.id, o.name, ROUND(AVG(cr.rating)::numeric, 1) AS average_rating, COUNT(cr.id)::int AS review_count FROM organizations o LEFT JOIN contractor_reviews cr ON cr.contractor_organization_id = o.id GROUP BY o.id, o.name HAVING COUNT(cr.id) > 0 ORDER BY average_rating DESC, review_count DESC LIMIT 8`),
      pool.query(`SELECT t.ticket_number, t.title, t.status, t.priority_level, requester.name AS client_name, assigned.name AS contractor_name, sla.sla_status, t.created_at FROM tickets t JOIN organizations requester ON requester.id=t.requesting_organization_id JOIN organizations assigned ON assigned.id=t.assigned_organization_id LEFT JOIN ticket_sla_tracking sla ON sla.ticket_id=t.id ORDER BY t.created_at DESC LIMIT 20`),
    ]);
    return res.json({ summary: { ...summary.rows[0], ...sla.rows[0] }, contractors: contractors.rows, recent_tickets: recent.rows });
  } catch (error) {
    console.error("GET OPERATIONS REPORT ERROR:", error);
    return res.status(500).json({ error: "Unable to load operations report" });
  }
});

router.get("/operations/export", requireRole("SUPER_ADMIN"), async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT t.ticket_number, t.title, t.status, t.priority_level, requester.name AS client, assigned.name AS contractor, COALESCE(sla.sla_status, 'NOT_TRACKED') AS sla_status, t.created_at, t.completed_at FROM tickets t JOIN organizations requester ON requester.id=t.requesting_organization_id JOIN organizations assigned ON assigned.id=t.assigned_organization_id LEFT JOIN ticket_sla_tracking sla ON sla.ticket_id=t.id ORDER BY t.created_at DESC`);
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [["Ticket number", "Title", "Status", "Priority", "Client", "Contractor", "SLA status", "Created", "Completed"], ...rows.map((row) => [row.ticket_number, row.title, row.status, row.priority_level, row.client, row.contractor, row.sla_status, row.created_at, row.completed_at])].map((row) => row.map(escape).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=contractorlink-operations-report.csv");
    return res.send(csv);
  } catch (error) {
    console.error("EXPORT OPERATIONS REPORT ERROR:", error);
    return res.status(500).json({ error: "Unable to export operations report" });
  }
});

module.exports = router;
