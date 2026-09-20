const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");
const { sendMail } = require("../services/mailer");

const router = express.Router();

function canManageOrganization(req, organizationId) {
  const roleCode = String(req.user?.role_code || "").toUpperCase();
  if (roleCode === "SUPER_ADMIN") return true;
  if (roleCode === "ORG_ADMIN" && String(req.user.organization_id) === String(organizationId)) {
    return true;
  }
  return false;
}

function generateTempPassword() {
  return `Temp@${crypto.randomBytes(4).toString("hex")}7!`;
}

async function sendAccessEmail({ fullName, email, tempPassword }) {
  const loginUrl = `${process.env.APP_BASE_URL || "http://localhost:5173"}/login`;

  return sendMail({
    to: email,
    subject: "Your ContractorLink account access details",
    text: [
      `Hello ${fullName},`,
      "",
      "A ContractorLink account has been prepared for you.",
      `Login email: ${email}`,
      `Temporary password: ${tempPassword}`,
      `Login here: ${loginUrl}`,
      "",
      "You will be required to change your password after your first sign-in.",
    ].join("\n"),
    html: `
      <p>Hello ${fullName},</p>
      <p>A ContractorLink account has been prepared for you.</p>
      <p><strong>Login email:</strong> ${email}</p>
      <p><strong>Temporary password:</strong> ${tempPassword}</p>
      <p><a href="${loginUrl}">Open ContractorLink login</a></p>
      <p>You will be required to change your password after your first sign-in.</p>
    `,
  });
}

async function getRoleByCode(roleCode) {
  const { rows } = await pool.query(
    `
    SELECT id, code, name
    FROM roles
    WHERE UPPER(code) = UPPER($1)
    LIMIT 1
    `,
    [roleCode]
  );

  return rows[0] || null;
}

async function fetchOrganizationState(organizationId) {
  const { rows } = await pool.query(
    `
    SELECT id, is_active
    FROM organizations
    WHERE id = $1
    LIMIT 1
    `,
    [organizationId]
  );

  return rows[0] || null;
}

async function fetchDepartmentState(departmentId) {
  const { rows } = await pool.query(
    `
    SELECT id, organization_id, is_active, name
    FROM departments
    WHERE id = $1
    LIMIT 1
    `,
    [departmentId]
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
        u.must_change_password,
        u.created_at,
        u.updated_at,
        r.code AS role_code,
        r.name AS role_name,
        o.name AS organization_name,
        du.department_id,
        d.name AS department_name,
        du.is_department_admin,
        du.is_active AS department_membership_active
      FROM users u
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      LEFT JOIN department_users du
        ON du.user_id = u.id
      LEFT JOIN departments d
        ON d.id = du.department_id
      WHERE u.organization_id = $1
      ORDER BY u.created_at DESC, u.full_name ASC
      `,
      [organizationId]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ORGANIZATION USERS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organization users" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    const organizationId = req.body?.organization_id || req.user.organization_id;
    if (!organizationId || !canManageOrganization(req, organizationId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const organization = await fetchOrganizationState(organizationId);
    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    if (organization.is_active === false) {
      return res.status(409).json({ error: "Cannot create users for an inactive organization" });
    }

    const fullName = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim() || null;
    const jobTitle = String(req.body?.job_title || "").trim() || null;
    const requestedRoleCode = String(req.body?.role_code || "").trim().toUpperCase();
    const departmentId = String(req.body?.department_id || "").trim() || null;
    const isDepartmentAdmin = req.body?.is_department_admin === true;

    if (!fullName || !email || !requestedRoleCode) {
      return res.status(400).json({
        error: "full_name, email, and role_code are required",
      });
    }

    if (
      String(req.user?.role_code || "").toUpperCase() === "ORG_ADMIN" &&
      !["ORG_ADMIN", "ORG_STAFF", "DIRECTOR", "STAFF"].includes(requestedRoleCode)
    ) {
      return res.status(403).json({
        error: "Organization admins can only create ORG_ADMIN, ORG_STAFF, DIRECTOR, or STAFF users",
      });
    }

    const role = await getRoleByCode(requestedRoleCode);
    if (!role) {
      return res.status(400).json({ error: "Invalid role_code" });
    }

    let department = null;
    if (departmentId) {
      department = await fetchDepartmentState(departmentId);
      if (!department) {
        return res.status(404).json({ error: "Department not found" });
      }

      if (String(department.organization_id) !== String(organizationId)) {
        return res.status(400).json({ error: "department_id does not belong to the selected organization" });
      }

      if (department.is_active === false) {
        return res.status(409).json({ error: "Cannot assign users to an inactive department" });
      }
    } else if (requestedRoleCode !== "ORG_ADMIN") {
      return res.status(400).json({
        error: "department_id is required for non-organization-admin accounts",
      });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await client.query("BEGIN");

    const userResult = await client.query(
      `
      INSERT INTO users (
        organization_id,
        role_id,
        full_name,
        email,
        password_hash,
        phone,
        job_title,
        is_active,
        must_change_password,
        temp_password_issued_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE,now())
      RETURNING id, organization_id, full_name, email, phone, job_title, profile_photo_path, is_active, must_change_password, created_at
      `,
      [organizationId, role.id, fullName, email, passwordHash, phone, jobTitle]
    );

    if (department) {
      await client.query(
        `
        INSERT INTO department_users (
          department_id,
          user_id,
          is_department_admin,
          is_active
        )
        VALUES ($1,$2,$3,TRUE)
        `,
        [department.id, userResult.rows[0].id, isDepartmentAdmin]
      );
    }

    await logAudit({
      actorUserId: req.user.id,
      actionType: "ORGANIZATION_USER_CREATED",
      entityType: "user",
      entityId: userResult.rows[0].id,
      metadata: {
        organization_id: organizationId,
        department_id: department?.id || null,
        role_code: role.code,
        email,
        is_department_admin: isDepartmentAdmin,
      },
      executor: client,
    });

    await client.query("COMMIT");

    const emailResult = await sendAccessEmail({
      fullName,
      email,
      tempPassword,
    });

    return res.status(201).json({
      user: {
        ...userResult.rows[0],
        role_code: role.code,
        role_name: role.name,
        department_id: department?.id || null,
        department_name: department?.name || null,
        is_department_admin: department ? isDepartmentAdmin : false,
      },
      tempPassword,
      email_delivery: emailResult.ok ? "sent" : emailResult.skipped ? "skipped" : "failed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("CREATE ORGANIZATION USER ERROR:", error);
    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "That email already exists" });
    }
    return res.status(500).json({ error: "Failed to create organization user" });
  } finally {
    client.release();
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT
        u.id,
        u.organization_id,
        r.code AS role_code,
        du.department_id,
        du.is_department_admin
      FROM users u
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN department_users du
        ON du.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization user not found" });
    }

    const target = existing.rows[0];
    if (!canManageOrganization(req, target.organization_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    const organization = await fetchOrganizationState(target.organization_id);
    if (!organization) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization not found" });
    }

    let roleId = null;
    let nextRoleCode = null;
    if (req.body?.role_code) {
      nextRoleCode = String(req.body.role_code).trim().toUpperCase();
      if (
        String(req.user?.role_code || "").toUpperCase() === "ORG_ADMIN" &&
        !["ORG_ADMIN", "ORG_STAFF", "DIRECTOR", "STAFF"].includes(nextRoleCode)
      ) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Forbidden role assignment" });
      }

      const role = await getRoleByCode(nextRoleCode);
      if (!role) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Invalid role_code" });
      }
      roleId = role.id;
    }

    const fullName = req.body?.full_name ? String(req.body.full_name).trim() : null;
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const jobTitle = req.body?.job_title ? String(req.body.job_title).trim() : null;
    const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : null;
    const isDepartmentAdmin =
      typeof req.body?.is_department_admin === "boolean" ? req.body.is_department_admin : null;
    const nextDepartmentId =
      typeof req.body?.department_id === "string"
        ? String(req.body.department_id).trim() || null
        : undefined;

    if (organization.is_active === false && isActive === true) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Cannot activate users while the organization is inactive",
      });
    }

    let department = null;
    if (nextDepartmentId !== undefined && nextDepartmentId !== null) {
      department = await fetchDepartmentState(nextDepartmentId);
      if (!department) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Department not found" });
      }

      if (String(department.organization_id) !== String(target.organization_id)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "department_id does not belong to this organization" });
      }

      if (department.is_active === false) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Cannot assign a user to an inactive department" });
      }
    }

    const updatedUser = await client.query(
      `
      UPDATE users
      SET
        role_id = COALESCE($1, role_id),
        full_name = COALESCE($2, full_name),
        phone = COALESCE($3, phone),
        job_title = COALESCE($4, job_title),
        is_active = COALESCE($5, is_active),
        updated_at = now()
      WHERE id = $6
      RETURNING id, organization_id, full_name, email, phone, job_title, profile_photo_path, is_active, must_change_password, created_at, updated_at
      `,
      [roleId, fullName, phone, jobTitle, isActive, req.params.id]
    );

    if (nextDepartmentId !== undefined) {
      if (nextDepartmentId === null) {
        await client.query(
          `
          DELETE FROM department_users
          WHERE user_id = $1
          `,
          [req.params.id]
        );
      } else {
        await client.query(
          `
          INSERT INTO department_users (
            department_id,
            user_id,
            is_department_admin,
            is_active
          )
          VALUES ($1,$2,$3,TRUE)
          ON CONFLICT (user_id)
          DO UPDATE SET
            department_id = EXCLUDED.department_id,
            is_department_admin = EXCLUDED.is_department_admin,
            is_active = TRUE,
            updated_at = now()
          `,
          [nextDepartmentId, req.params.id, isDepartmentAdmin === true]
        );
      }
    } else if (isDepartmentAdmin !== null) {
      await client.query(
        `
        UPDATE department_users
        SET is_department_admin = $1,
            updated_at = now()
        WHERE user_id = $2
        `,
        [isDepartmentAdmin, req.params.id]
      );
    }

    const membership = await client.query(
      `
      SELECT du.department_id, du.is_department_admin, du.is_active, d.name AS department_name
      FROM department_users du
      LEFT JOIN departments d
        ON d.id = du.department_id
      WHERE du.user_id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "ORGANIZATION_USER_UPDATED",
      entityType: "user",
      entityId: req.params.id,
      metadata: {
        role_id: roleId,
        department_id: membership.rows[0]?.department_id || null,
        is_active: isActive,
        is_department_admin:
          membership.rows[0]?.is_department_admin ??
          (isDepartmentAdmin !== null ? isDepartmentAdmin : null),
      },
      executor: client,
    });

    await client.query("COMMIT");

    return res.json({
      ...updatedUser.rows[0],
      department_id: membership.rows[0]?.department_id || null,
      department_name: membership.rows[0]?.department_name || null,
      is_department_admin: membership.rows[0]?.is_department_admin || false,
      role_code: nextRoleCode || target.role_code,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("UPDATE ORGANIZATION USER ERROR:", error);
    return res.status(500).json({ error: "Failed to update organization user" });
  } finally {
    client.release();
  }
});

router.post("/:id/reset-access", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT
        u.id,
        u.organization_id,
        u.full_name,
        u.email,
        u.is_active
      FROM users u
      WHERE u.id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization user not found" });
    }

    const target = existing.rows[0];
    if (!canManageOrganization(req, target.organization_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You can only reset access for users in your organization" });
    }
    const organization = await fetchOrganizationState(target.organization_id);

    if (!organization) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization not found" });
    }

    if (target.is_active === false) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cannot reset access for an inactive user" });
    }

    if (organization.is_active === false) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cannot reset access while the organization is inactive" });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await client.query(
      `
      UPDATE users
      SET
        password_hash = $1,
        must_change_password = TRUE,
        temp_password_issued_at = now(),
        updated_at = now()
      WHERE id = $2
      `,
      [passwordHash, req.params.id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "ORGANIZATION_USER_ACCESS_RESET",
      entityType: "user",
      entityId: req.params.id,
      metadata: {
        organization_id: target.organization_id,
        email: target.email,
      },
      executor: client,
    });

    await client.query("COMMIT");

    const emailResult = await sendAccessEmail({
      fullName: target.full_name,
      email: target.email,
      tempPassword,
    });

    return res.json({
      message: "User access reset successfully.",
      tempPassword,
      email: target.email,
      email_delivery: emailResult.ok ? "sent" : emailResult.skipped ? "skipped" : "failed",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("RESET ORGANIZATION USER ACCESS ERROR:", error);
    return res.status(500).json({ error: "Failed to reset user access" });
  } finally {
    client.release();
  }
});

module.exports = router;
