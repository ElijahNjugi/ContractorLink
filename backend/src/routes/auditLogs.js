const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

function normalizeLimit(value, fallback = 30, maximum = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), maximum));
}

function auditLogQuery(limit) {
  return pool.query(
    `
    SELECT
      al.id,
      al.action_type,
      al.entity_type,
      al.entity_id,
      al.metadata_json,
      al.created_at,
      actor.full_name AS actor_name,
      actor.email AS actor_email
    FROM audit_logs al
    LEFT JOIN users actor ON actor.id = al.actor_user_id
    ORDER BY al.created_at DESC
    LIMIT $1
    `,
    [limit]
  );
}

function toCsvValue(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

router.get("/", requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const { rows } = await auditLogQuery(normalizeLimit(req.query.limit));
    return res.json(rows);
  } catch (error) {
    console.error("GET AUDIT LOGS ERROR:", error);
    return res.status(500).json({ error: "Failed to retrieve audit logs" });
  }
});

router.get("/export", requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const { rows } = await auditLogQuery(normalizeLimit(req.query.limit, 1000, 5000));
    const headers = [
      "recorded_at",
      "actor_name",
      "actor_email",
      "action_type",
      "entity_type",
      "entity_id",
      "metadata",
    ];
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.created_at ? new Date(row.created_at).toISOString() : "",
          row.actor_name || "System",
          row.actor_email || "",
          row.action_type,
          row.entity_type,
          row.entity_id || "",
          row.metadata_json ? JSON.stringify(row.metadata_json) : "",
        ]
          .map(toCsvValue)
          .join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contractorlink-audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    return res.send(csv);
  } catch (error) {
    console.error("EXPORT AUDIT LOGS ERROR:", error);
    return res.status(500).json({ error: "Failed to export audit logs" });
  }
});

module.exports = router;
