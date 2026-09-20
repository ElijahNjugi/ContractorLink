const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// A single source of truth for the signed-in user's current working context.
router.get("/me", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.job_title,
        r.code AS role_code,
        r.name AS role_name,
        o.name AS organization_name,
        o.organization_type,
        COALESCE(
          string_agg(DISTINCT d.name, ', ' ORDER BY d.name)
            FILTER (WHERE du.is_active = TRUE AND d.is_active = TRUE),
          ''
        ) AS department_names
      FROM users u
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      LEFT JOIN department_users du
        ON du.user_id = u.id
      LEFT JOIN departments d
        ON d.id = du.department_id
      WHERE u.id = $1
      GROUP BY u.id, r.code, r.name, o.name, o.organization_type
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows.length) return res.status(404).json({ error: "User not found" });
    return res.json(rows[0]);
  } catch (error) {
    console.error("WORKSPACE CONTEXT ERROR:", error);
    return res.status(500).json({ error: "Failed to load workspace context" });
  }
});

module.exports = router;
