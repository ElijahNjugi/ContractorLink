const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");

const router = express.Router();

function canManageOrganization(req, organizationId) {
  const roleCode = String(req.user?.role_code || "").toUpperCase();
  if (roleCode === "SUPER_ADMIN") return true;
  if (roleCode === "ORG_ADMIN" && String(req.user.organization_id) === String(organizationId)) {
    return true;
  }
  return false;
}

async function fetchDepartment(id) {
  const { rows } = await pool.query(
    `
    SELECT d.*, o.name AS organization_name
    FROM departments d
    JOIN organizations o
      ON o.id = d.organization_id
    WHERE d.id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const requestedOrgId = req.query.organization_id;
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const organizationId = roleCode === "SUPER_ADMIN" ? requestedOrgId : req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({ error: "organization_id is required" });
    }

    if (!canManageOrganization(req, organizationId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        d.*,
        COUNT(DISTINCT CASE WHEN du.is_active THEN du.user_id END) AS active_user_count,
        COUNT(DISTINCT CASE WHEN du.is_active AND du.is_department_admin THEN du.user_id END) AS admin_user_count
      FROM departments d
      LEFT JOIN department_users du
        ON du.department_id = d.id
      WHERE d.organization_id = $1
      GROUP BY d.id
      ORDER BY d.created_at DESC, d.name ASC
      `,
      [organizationId]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST DEPARTMENTS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch departments" });
  }
});

router.get("/:id/users", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const department = await fetchDepartment(req.params.id);
    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }

    if (!canManageOrganization(req, department.organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.organization_id,
        u.full_name,
        u.email,
        u.phone,
        u.job_title,
        u.profile_photo_path,
        u.is_active,
        r.code AS role_code,
        r.name AS role_name,
        du.is_department_admin,
        du.is_active AS department_membership_active
      FROM department_users du
      JOIN users u
        ON u.id = du.user_id
      JOIN roles r
        ON r.id = u.role_id
      WHERE du.department_id = $1
      ORDER BY du.is_department_admin DESC, u.full_name ASC
      `,
      [req.params.id]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST DEPARTMENT USERS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch department users" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const organizationId = req.body?.organization_id || req.user.organization_id;
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    const isActive = req.body?.is_active !== false;

    if (!organizationId || !name) {
      return res.status(400).json({ error: "organization_id and name are required" });
    }

    if (!canManageOrganization(req, organizationId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO departments (
        organization_id,
        name,
        description,
        is_active,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [organizationId, name, description, isActive, req.user.id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "DEPARTMENT_CREATED",
      entityType: "department",
      entityId: rows[0].id,
      metadata: {
        organization_id: organizationId,
        name,
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE DEPARTMENT ERROR:", error);
    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "A department with that name already exists" });
    }
    return res.status(500).json({ error: "Failed to create department" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT *
      FROM departments
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Department not found" });
    }

    const department = existing.rows[0];

    if (!canManageOrganization(req, department.organization_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    const name = req.body?.name ? String(req.body.name).trim() : null;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    const updated = await client.query(
      `
      UPDATE departments
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

    if (isActive === false) {
      await client.query(
        `
        UPDATE department_users
        SET is_active = FALSE,
            is_department_admin = FALSE,
            updated_at = now()
        WHERE department_id = $1
        `,
        [req.params.id]
      );
    }

    await logAudit({
      actorUserId: req.user.id,
      actionType: isActive === false ? "DEPARTMENT_DISABLED" : "DEPARTMENT_UPDATED",
      entityType: "department",
      entityId: req.params.id,
      metadata: {
        organization_id: department.organization_id,
        is_active: isActive,
      },
      executor: client,
    });

    await client.query("COMMIT");
    return res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("UPDATE DEPARTMENT ERROR:", error);
    return res.status(500).json({ error: "Failed to update department" });
  } finally {
    client.release();
  }
});

module.exports = router;
