const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");
const { createNotificationsForUsers, getActiveUsersForOrganizations } = require("../services/notifications");

const router = express.Router();

function canAccessOrganization(req, organizationId) {
  const roleCode = String(req.user?.role_code || "").toUpperCase();
  if (roleCode === "SUPER_ADMIN") return true;
  if (["ORG_ADMIN", "DIRECTOR", "ORG_STAFF"].includes(roleCode)) {
    return String(req.user.organization_id) === String(organizationId);
  }
  return false;
}

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), async (req, res) => {
  try {
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const organizationId =
      roleCode === "SUPER_ADMIN"
        ? req.query.organization_id || null
        : req.user.organization_id;

    const params = [];
    let where = "";

    if (organizationId) {
      params.push(organizationId);
      where = `
        WHERE p.client_organization_id = $1
           OR p.contractor_organization_id = $1
      `;
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        client_org.name AS client_organization_name,
        contractor_org.name AS contractor_organization_name,
        approver.full_name AS approved_by_name
      FROM organization_partnerships p
      JOIN organizations client_org
        ON client_org.id = p.client_organization_id
      JOIN organizations contractor_org
        ON contractor_org.id = p.contractor_organization_id
      LEFT JOIN users approver
        ON approver.id = p.approved_by
      ${where}
      ORDER BY p.created_at DESC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST PARTNERSHIPS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch partnerships" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const clientOrganizationId = req.body?.client_organization_id;
    const contractorOrganizationId = req.body?.contractor_organization_id;
    const notes = String(req.body?.notes || "").trim() || null;
    const requestedStatus = String(req.body?.status || "PENDING").trim().toUpperCase();

    if (!clientOrganizationId || !contractorOrganizationId) {
      return res.status(400).json({
        error: "client_organization_id and contractor_organization_id are required",
      });
    }

    if (!["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "ENDED"].includes(requestedStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    if (
      String(req.user?.role_code || "").toUpperCase() !== "SUPER_ADMIN" &&
      String(req.user.organization_id) !== String(clientOrganizationId)
    ) {
      return res.status(403).json({
        error: "Organization admins can only create partnerships for their own organization",
      });
    }

    if (roleCode !== "SUPER_ADMIN" && requestedStatus !== "PENDING") {
      return res.status(403).json({
        error: "Organization admins can create collaboration requests only. The contractor must accept it.",
      });
    }

    const approvedBy = requestedStatus === "ACTIVE" && roleCode === "SUPER_ADMIN" ? req.user.id : null;

    const query = approvedBy
      ? `
        INSERT INTO organization_partnerships (
          client_organization_id,
          contractor_organization_id,
          status,
          notes,
          approved_by,
          approved_at
        )
        VALUES ($1,$2,$3,$4,$5,now())
        RETURNING *
      `
      : `
        INSERT INTO organization_partnerships (
          client_organization_id,
          contractor_organization_id,
          status,
          notes
        )
        VALUES ($1,$2,$3,$4)
        RETURNING *
      `;

    const params = approvedBy
      ? [clientOrganizationId, contractorOrganizationId, requestedStatus, notes, req.user.id]
      : [clientOrganizationId, contractorOrganizationId, requestedStatus, notes];

    const { rows } = await pool.query(query, params);
    await logAudit({
      actorUserId: req.user.id,
      actionType: "PARTNERSHIP_CREATED",
      entityType: "organization_partnership",
      entityId: rows[0].id,
      metadata: {
        client_organization_id: clientOrganizationId,
        contractor_organization_id: contractorOrganizationId,
        status: requestedStatus,
      },
    });
    const contractorUsers = await getActiveUsersForOrganizations([contractorOrganizationId]);
    await createNotificationsForUsers(contractorUsers.map((user) => user.id), {
      title: "New Partnership Request",
      message: "A client organization has requested to work with your company.",
      type: "INFO",
      entityType: "organization_partnership",
      entityId: rows[0].id,
      link: "/partnerships",
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE PARTNERSHIP ERROR:", error);
    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "This partnership already exists" });
    }
    return res.status(500).json({ error: "Failed to create partnership" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const existing = await pool.query(
      `
      SELECT *
      FROM organization_partnerships
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "Partnership not found" });
    }

    const partnership = existing.rows[0];
    const roleCode = String(req.user?.role_code || "").toUpperCase();

    if (
      roleCode !== "SUPER_ADMIN" &&
      ![
        String(partnership.client_organization_id),
        String(partnership.contractor_organization_id),
      ].includes(String(req.user.organization_id))
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const status = req.body?.status ? String(req.body.status).trim().toUpperCase() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : null;

    if (status && !["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "ENDED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    if (roleCode !== "SUPER_ADMIN" && status) {
      const isContractor = String(req.user.organization_id) === String(partnership.contractor_organization_id);
      const isClient = String(req.user.organization_id) === String(partnership.client_organization_id);
      const isPendingDecision = partnership.status === "PENDING" && ["ACTIVE", "REJECTED"].includes(status);
      const isEndingActivePartnership = partnership.status === "ACTIVE" && status === "ENDED";

      if (!(isContractor && isPendingDecision) && !(isClient && isEndingActivePartnership)) {
        return res.status(403).json({
          error: "Only the contractor can accept or decline a pending request. Clients can end an active partnership.",
        });
      }
    }

    const approverId = status === "ACTIVE" ? req.user.id : null;

    const { rows } = await pool.query(
      `
      UPDATE organization_partnerships
      SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        approved_by = CASE
          WHEN $3::uuid IS NOT NULL THEN $3
          ELSE approved_by
        END,
        approved_at = CASE
          WHEN $3::uuid IS NOT NULL THEN now()
          ELSE approved_at
        END,
        updated_at = now()
      WHERE id = $4
      RETURNING *
      `,
      [status, notes, approverId, req.params.id]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "PARTNERSHIP_UPDATED",
      entityType: "organization_partnership",
      entityId: req.params.id,
      metadata: {
        status,
      },
    });
    const notifyOrganizationId = status === "ACTIVE" || status === "REJECTED"
      ? partnership.client_organization_id
      : partnership.contractor_organization_id;
    const recipients = await getActiveUsersForOrganizations([notifyOrganizationId]);
    if (status) {
      await createNotificationsForUsers(recipients.map((user) => user.id), {
        title: status === "ACTIVE" ? "Partnership Accepted" : status === "REJECTED" ? "Partnership Declined" : "Partnership Updated",
        message: status === "ACTIVE"
          ? "Your client-contractor partnership is active and ready for SLA setup."
          : status === "REJECTED" ? "Your client-contractor partnership request was declined." : "A partnership linked to your organization has been updated.",
        type: status === "ACTIVE" ? "SUCCESS" : status === "REJECTED" ? "WARNING" : "INFO",
        entityType: "organization_partnership",
        entityId: partnership.id,
        link: "/partnerships",
      });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE PARTNERSHIP ERROR:", error);
    return res.status(500).json({ error: "Failed to update partnership" });
  }
});

module.exports = router;
