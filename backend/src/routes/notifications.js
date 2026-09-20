const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const unreadOnly = String(req.query.unread_only || "").toLowerCase() === "true";
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const params = [req.user.id];
    const clauses = ["user_id = $1"];

    if (unreadOnly) {
      clauses.push("is_read = FALSE");
    }

    params.push(limit);

    const { rows } = await pool.query(
      `
      SELECT *
      FROM notifications
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $2
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST NOTIFICATIONS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.patch("/:id/read", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1
        AND user_id = $2
      RETURNING *
      `,
      [req.params.id, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("MARK NOTIFICATION READ ERROR:", error);
    return res.status(500).json({ error: "Failed to update notification" });
  }
});

router.patch("/read-all", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE user_id = $1
        AND is_read = FALSE
      `,
      [req.user.id]
    );

    return res.json({
      updated_count: result.rowCount || 0,
    });
  } catch (error) {
    console.error("MARK ALL NOTIFICATIONS READ ERROR:", error);
    return res.status(500).json({ error: "Failed to update notifications" });
  }
});

router.get("/settings/me", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM user_notification_settings
      WHERE user_id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows.length) {
      return res.json({
        user_id: req.user.id,
        email_ticket_assigned: true,
        email_ticket_updated: true,
        email_sla_breached: true,
        email_hold_reviewed: true,
        email_ticket_completed: true,
      });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("GET NOTIFICATION SETTINGS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch notification settings" });
  }
});

router.put("/settings/me", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const assigned =
      typeof req.body?.email_ticket_assigned === "boolean"
        ? req.body.email_ticket_assigned
        : true;
    const updated =
      typeof req.body?.email_ticket_updated === "boolean"
        ? req.body.email_ticket_updated
        : true;
    const slaBreached =
      typeof req.body?.email_sla_breached === "boolean"
        ? req.body.email_sla_breached
        : true;
    const holdReviewed =
      typeof req.body?.email_hold_reviewed === "boolean"
        ? req.body.email_hold_reviewed
        : true;
    const completed =
      typeof req.body?.email_ticket_completed === "boolean"
        ? req.body.email_ticket_completed
        : true;

    const { rows } = await pool.query(
      `
      INSERT INTO user_notification_settings (
        user_id,
        email_ticket_assigned,
        email_ticket_updated,
        email_sla_breached,
        email_hold_reviewed,
        email_ticket_completed
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id)
      DO UPDATE SET
        email_ticket_assigned = EXCLUDED.email_ticket_assigned,
        email_ticket_updated = EXCLUDED.email_ticket_updated,
        email_sla_breached = EXCLUDED.email_sla_breached,
        email_hold_reviewed = EXCLUDED.email_hold_reviewed,
        email_ticket_completed = EXCLUDED.email_ticket_completed,
        updated_at = now()
      RETURNING *
      `,
      [req.user.id, assigned, updated, slaBreached, holdReviewed, completed]
    );

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE NOTIFICATION SETTINGS ERROR:", error);
    return res.status(500).json({ error: "Failed to update notification settings" });
  }
});

module.exports = router;
