const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

function canManageOrganization(req, organizationId) {
  const roleCode = String(req.user?.role_code || "").toUpperCase();
  if (roleCode === "SUPER_ADMIN") return true;
  if (roleCode === "ORG_ADMIN" && String(req.user.organization_id) === String(organizationId)) {
    return true;
  }
  return false;
}

router.get("/", async (req, res) => {
  try {
    const requestedOrgId = req.query.organization_id;
    const roleCode = String(req.user?.role_code || "").toUpperCase();

    let organizationId = requestedOrgId;
    if (roleCode !== "SUPER_ADMIN") {
      organizationId = req.user.organization_id;
    }

    if (!organizationId) {
      return res.status(400).json({ error: "organization_id is required" });
    }

    const { rows } = await pool.query(
      `
      WITH contact_source AS (
        SELECT c.*, COALESCE(NULLIF(LOWER(TRIM(c.email)), ''), 'contact:' || c.id::text) AS email_key
        FROM organization_contacts c
        WHERE c.organization_id = $1
      ), escalation_usage AS (
        SELECT
          COALESCE(NULLIF(LOWER(TRIM(c.email)), ''), 'contact:' || c.id::text) AS email_key,
          jsonb_agg(DISTINCT jsonb_build_object(
            'agreement_name', a.agreement_name,
            'stage', CASE
              WHEN e.trigger_event_type = 'BREACH' THEN 'At breach time'
              ELSE e.trigger_minutes::text || ' minutes before target'
            END,
            'event', e.trigger_event_type
          )) AS escalation_usages
        FROM sla_agreement_escalations e
        JOIN sla_agreement_policies p ON p.id = e.sla_policy_id
        JOIN sla_agreements a ON a.id = p.sla_agreement_id
        JOIN organization_contacts c ON c.id = e.contact_id
        WHERE c.organization_id = $1
        GROUP BY COALESCE(NULLIF(LOWER(TRIM(c.email)), ''), 'contact:' || c.id::text)
      )
      SELECT
        (array_agg(c.id ORDER BY c.is_primary DESC, c.created_at ASC))[1] AS id,
        array_agg(c.id ORDER BY c.is_primary DESC, c.created_at ASC) AS contact_ids,
        (array_agg(c.name ORDER BY c.is_primary DESC, c.created_at ASC))[1] AS name,
        (array_agg(c.email ORDER BY c.is_primary DESC, c.created_at ASC))[1] AS email,
        (array_agg(c.phone ORDER BY c.is_primary DESC, c.created_at ASC))[1] AS phone,
        (array_agg(c.job_title ORDER BY c.is_primary DESC, c.created_at ASC))[1] AS job_title,
        string_agg(DISTINCT c.contact_type, ', ') AS contact_type,
        bool_or(c.is_primary) AS is_primary,
        bool_or(c.is_active) AS is_active,
        COALESCE(u.escalation_usages, '[]'::jsonb) AS escalation_usages
      FROM contact_source c
      LEFT JOIN escalation_usage u ON u.email_key = c.email_key
      GROUP BY c.email_key, u.escalation_usages
      ORDER BY bool_or(c.is_primary) DESC, min(c.created_at) ASC, min(c.name) ASC
      `,
      [organizationId]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ORGANIZATION CONTACTS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organization contacts" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const organizationId = req.body?.organization_id || req.user.organization_id;

    if (!canManageOrganization(req, organizationId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase() || null;
    const phone = String(req.body?.phone || "").trim() || null;
    const jobTitle = String(req.body?.job_title || "").trim() || null;
    const contactType = String(req.body?.contact_type || "").trim() || null;
    const description = String(req.body?.description || "").trim() || null;
    const isPrimary = req.body?.is_primary === true;
    const isActive = req.body?.is_active !== false;

    if (!organizationId || !name) {
      return res.status(400).json({ error: "organization_id and name are required" });
    }

    if (email) {
      const duplicate = await pool.query(
        `SELECT id FROM organization_contacts WHERE organization_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
        [organizationId, email]
      );
      if (duplicate.rowCount) {
        return res.status(409).json({ error: "This email is already saved as an organization contact." });
      }
    }

    const { rows } = await pool.query(
      `
      INSERT INTO organization_contacts (
        organization_id,
        name,
        email,
        phone,
        job_title,
        contact_type,
        description,
        is_primary,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        organizationId,
        name,
        email,
        phone,
        jobTitle,
        contactType,
        description,
        isPrimary,
        isActive,
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE ORGANIZATION CONTACT ERROR:", error);
    return res.status(500).json({ error: "Failed to create organization contact" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const existing = await pool.query(
      `
      SELECT *
      FROM organization_contacts
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "Organization contact not found" });
    }

    const contact = existing.rows[0];
    if (!canManageOrganization(req, contact.organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const name = req.body?.name ? String(req.body.name).trim() : null;
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const jobTitle = req.body?.job_title ? String(req.body.job_title).trim() : null;
    const contactType = req.body?.contact_type ? String(req.body.contact_type).trim() : null;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const isPrimary =
      typeof req.body?.is_primary === "boolean" ? req.body.is_primary : null;
    const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    const { rows } = await pool.query(
      `
      UPDATE organization_contacts
      SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        job_title = COALESCE($4, job_title),
        contact_type = COALESCE($5, contact_type),
        description = COALESCE($6, description),
        is_primary = COALESCE($7, is_primary),
        is_active = COALESCE($8, is_active),
        updated_at = now()
      WHERE id = $9
      RETURNING *
      `,
      [name, email, phone, jobTitle, contactType, description, isPrimary, isActive, req.params.id]
    );

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE ORGANIZATION CONTACT ERROR:", error);
    return res.status(500).json({ error: "Failed to update organization contact" });
  }
});

module.exports = router;
