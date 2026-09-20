const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
    const params = [];
    const where = activeOnly ? "WHERE is_active = $1" : "";

    if (activeOnly) {
      params.push(true);
    }

    const { rows } = await pool.query(
      `
      SELECT
        tt.*,
        creator.full_name AS created_by_name
      FROM ticket_types tt
      LEFT JOIN users creator
        ON creator.id = tt.created_by
      ${where}
      ORDER BY tt.name ASC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST TICKET TYPES ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch ticket types" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim() || null;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO ticket_types (
        name,
        description,
        created_by
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name, description, req.user.id]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE TICKET TYPE ERROR:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "A ticket type with that name already exists" });
    }
    return res.status(500).json({ error: "Failed to create ticket type" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    const { rows } = await pool.query(
      `
      UPDATE ticket_types
      SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        updated_at = now()
      WHERE id = $4
      RETURNING *
      `,
      [name, description, isActive, req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Ticket type not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE TICKET TYPE ERROR:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "A ticket type with that name already exists" });
    }
    return res.status(500).json({ error: "Failed to update ticket type" });
  }
});

module.exports = router;
