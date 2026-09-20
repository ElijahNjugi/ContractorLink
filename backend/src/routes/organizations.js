const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { logAudit } = require("../services/audit");
const {
  createNotificationsForUsers,
  getActiveUsersForOrganizations,
} = require("../services/notifications");
const {
  disableOrganizationCascade,
  enableOrganizationOnly,
} = require("../services/organizationStatus");

const router = express.Router();
const BRANDING_UPLOAD_ROOT = path.join(process.env.UPLOAD_ROOT || path.join(__dirname, "..", "..", "uploads"), "organization-branding");
const MAX_BRANDING_IMAGE_BYTES = 3 * 1024 * 1024;

async function storeBrandingImage(organizationId, image, label) {
  if (!image?.content_base64) return null;
  const mimeType = String(image.mime_type || "").toLowerCase();
  const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[mimeType];
  if (!extension) throw new Error("Branding images must be PNG, JPG, or WEBP files.");
  const content = String(image.content_base64).replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(content, "base64");
  if (!buffer.length || buffer.length > MAX_BRANDING_IMAGE_BYTES) throw new Error("Branding images must be between 1 byte and 3 MB.");
  const directory = path.join(BRANDING_UPLOAD_ROOT, organizationId);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${label}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${extension}`;
  await fs.writeFile(path.join(directory, filename), buffer);
  return `/uploads/organization-branding/${organizationId}/${filename}`;
}

router.get("/marketplace/contractors", async (req, res) => {
  try {
    const search = String(req.query?.search || "").trim().toLowerCase();
    const includeUnpublished =
      String(req.query?.include_unpublished || "false").toLowerCase() === "true";
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const params = [];
    const conditions = [
      "o.is_active = TRUE",
      "o.organization_type IN ('CONTRACTOR', 'HYBRID')",
    ];

    if (!(includeUnpublished && roleCode === "SUPER_ADMIN")) {
      conditions.push("o.marketplace_enabled = TRUE");
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`
        (
          LOWER(o.name) LIKE $${params.length}
          OR LOWER(COALESCE(o.marketplace_tagline, '')) LIKE $${params.length}
          OR LOWER(COALESCE(o.service_summary, '')) LIKE $${params.length}
          OR LOWER(COALESCE(o.coverage_area, '')) LIKE $${params.length}
          OR LOWER(COALESCE(o.specializations, '')) LIKE $${params.length}
        )
      `);
    }

    const { rows } = await pool.query(
  `
    SELECT
      o.*,
      primary_contact.name AS primary_contact_name,
      primary_contact.email AS primary_contact_email,
      primary_contact.phone AS primary_contact_phone,
      COALESCE(review_summary.review_count, 0)::int AS review_count,
      COALESCE(review_summary.average_rating, 0)::numeric(3,2) AS average_rating,
      COUNT(DISTINCT CASE
        WHEN p.status = 'ACTIVE' THEN p.id
      END)::int AS active_partnership_count
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT c.name, c.email, c.phone
      FROM organization_contacts c
      WHERE c.organization_id = o.id
        AND c.is_active = TRUE
      ORDER BY c.is_primary DESC, c.created_at ASC
      LIMIT 1
    ) primary_contact ON TRUE
    LEFT JOIN organization_partnerships p
      ON p.contractor_organization_id = o.id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS review_count,
        ROUND(AVG(r.rating)::numeric, 2) AS average_rating
      FROM contractor_reviews r
      WHERE r.contractor_organization_id = o.id
    ) review_summary ON TRUE
    WHERE ${conditions.join(" AND ")}
    GROUP BY
      o.id,
      primary_contact.name,
      primary_contact.email,
      primary_contact.phone,
      review_summary.review_count,
      review_summary.average_rating
    ORDER BY o.created_at DESC, o.name ASC
  `,
  params
);

    return res.json(rows);
  } catch (error) {
    console.error("LIST MARKETPLACE CONTRACTORS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch marketplace contractors" });
  }
});

router.get("/marketplace/contractors/:id", async (req, res) => {
  try {
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const { rows } = await pool.query(
      `
      SELECT
        o.*,
        primary_contact.name AS primary_contact_name,
        primary_contact.email AS primary_contact_email,
        primary_contact.phone AS primary_contact_phone,
        COALESCE(review_summary.review_count, 0)::int AS review_count,
        COALESCE(review_summary.average_rating, 0)::numeric(3,2) AS average_rating,
        COALESCE(review_summary.reviews, '[]'::json) AS reviews
      FROM organizations o
      LEFT JOIN LATERAL (
        SELECT c.name, c.email, c.phone
        FROM organization_contacts c
        WHERE c.organization_id = o.id AND c.is_active = TRUE
        ORDER BY c.is_primary DESC, c.created_at ASC
        LIMIT 1
      ) primary_contact ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS review_count,
          ROUND(AVG(r.rating)::numeric, 2) AS average_rating,
          json_agg(
            json_build_object(
              'id', r.id,
              'rating', r.rating,
              'comment', r.comment,
              'created_at', r.created_at,
              'client_organization_name', client_org.name
            ) ORDER BY r.created_at DESC
          ) AS reviews
        FROM contractor_reviews r
        JOIN organizations client_org ON client_org.id = r.client_organization_id
        WHERE r.contractor_organization_id = o.id
      ) review_summary ON TRUE
      WHERE o.id = $1
        AND o.is_active = TRUE
        AND o.organization_type IN ('CONTRACTOR', 'HYBRID')
        AND (o.marketplace_enabled = TRUE OR $2 = 'SUPER_ADMIN')
      LIMIT 1
      `,
      [req.params.id, roleCode]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Contractor listing not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    console.error("GET MARKETPLACE CONTRACTOR ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch contractor listing" });
  }
});

router.post("/marketplace/contractors/:id/partnership-requests", requireRole("ORG_ADMIN"), async (req, res) => {
  try {
    const clientOrganizationId = req.user.organization_id;
    const contractorOrganizationId = req.params.id;
    const notes = String(req.body?.notes || "").trim() || null;

    if (!clientOrganizationId || String(clientOrganizationId) === String(contractorOrganizationId)) {
      return res.status(400).json({ error: "Choose a different contractor organization" });
    }

    const clientOrganization = await pool.query(
      `SELECT id FROM organizations
       WHERE id = $1 AND is_active = TRUE AND organization_type IN ('CLIENT', 'HYBRID')`,
      [clientOrganizationId]
    );
    if (!clientOrganization.rowCount) {
      return res.status(403).json({ error: "Only active client organizations can request a contractor" });
    }

    const contractor = await pool.query(
      `SELECT id FROM organizations
       WHERE id = $1 AND is_active = TRUE AND marketplace_enabled = TRUE
         AND organization_type IN ('CONTRACTOR', 'HYBRID')`,
      [contractorOrganizationId]
    );
    if (!contractor.rowCount) {
      return res.status(404).json({ error: "Contractor listing not found or unavailable" });
    }

    const { rows } = await pool.query(
      `INSERT INTO organization_partnerships (
         client_organization_id, contractor_organization_id, status, notes
       ) VALUES ($1, $2, 'PENDING', $3) RETURNING *`,
      [clientOrganizationId, contractorOrganizationId, notes]
    );
    await logAudit({
      actorUserId: req.user.id,
      actionType: "MARKETPLACE_PARTNERSHIP_REQUESTED",
      entityType: "organization_partnership",
      entityId: rows[0].id,
      metadata: { client_organization_id: clientOrganizationId, contractor_organization_id: contractorOrganizationId },
    });
    const clientNameResult = await pool.query(
      `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
      [clientOrganizationId]
    );
    const recipients = await getActiveUsersForOrganizations([contractorOrganizationId]);
    await createNotificationsForUsers(recipients.map((recipient) => recipient.id), {
      title: "New Partnership Request",
      message: `${clientNameResult.rows[0]?.name || "A client organization"} wants to work with your company.`,
      type: "INFO",
      entityType: "organization_partnership",
      entityId: rows[0].id,
      link: "/partnerships",
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "A collaboration record already exists for these organizations" });
    }
    console.error("REQUEST MARKETPLACE PARTNERSHIP ERROR:", error);
    return res.status(500).json({ error: "Failed to send collaboration request" });
  }
});

router.post("/marketplace/contractors/:id/reviews", requireRole("ORG_ADMIN"), async (req, res) => {
  try {
    const contractorOrganizationId = req.params.id;
    const clientOrganizationId = req.user.organization_id;
    const ticketId = req.body?.ticket_id;
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim() || null;

    if (!ticketId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "ticket_id and a rating from 1 to 5 are required" });
    }

    const ticketResult = await pool.query(
      `SELECT id FROM tickets
       WHERE id = $1
         AND status = 'COMPLETED'
         AND requesting_organization_id = $2
         AND assigned_organization_id = $3
       LIMIT 1`,
      [ticketId, clientOrganizationId, contractorOrganizationId]
    );
    if (!ticketResult.rowCount) {
      return res.status(403).json({
        error: "Reviews require a completed ticket between your organization and this contractor",
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO contractor_reviews (
         contractor_organization_id, client_organization_id, ticket_id, rating, comment, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [contractorOrganizationId, clientOrganizationId, ticketId, rating, comment, req.user.id]
    );
    await logAudit({
      actorUserId: req.user.id,
      actionType: "CONTRACTOR_REVIEW_CREATED",
      entityType: "contractor_review",
      entityId: rows[0].id,
      metadata: { contractor_organization_id: contractorOrganizationId, ticket_id: ticketId, rating },
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "This completed ticket already has a contractor review" });
    }
    console.error("CREATE CONTRACTOR REVIEW ERROR:", error);
    return res.status(500).json({ error: "Failed to submit contractor review" });
  }
});

router.get("/", async (req, res) => {
  try {
    const roleCode = String(req.user?.role_code || "").toUpperCase();
    const includeInactive =
      String(req.query?.include_inactive || "false").toLowerCase() === "true";

    if (roleCode === "SUPER_ADMIN") {
      const { rows } = await pool.query(
        `
        SELECT
          o.*,
          COUNT(DISTINCT u.id)::int AS user_count,
          COUNT(DISTINCT a.id)::int AS asset_count
        FROM organizations o
        LEFT JOIN users u
          ON u.organization_id = o.id
        LEFT JOIN assets a
          ON a.organization_id = o.id
        ${includeInactive ? "" : "WHERE o.is_active = TRUE"}
        GROUP BY o.id
        ORDER BY o.created_at DESC, o.name ASC
        `
      );

      return res.json(rows);
    }

    if (!req.user.organization_id) {
      return res.json([]);
    }

    const { rows } = await pool.query(
      `
      SELECT
        o.*,
        COUNT(DISTINCT u.id)::int AS user_count,
        COUNT(DISTINCT a.id)::int AS asset_count
      FROM organizations o
      LEFT JOIN users u
        ON u.organization_id = o.id
      LEFT JOIN assets a
        ON a.organization_id = o.id
      WHERE o.id = $1
      GROUP BY o.id
      LIMIT 1
      `,
      [req.user.organization_id]
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ORGANIZATIONS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const organizationId = req.params.id;
    const roleCode = String(req.user?.role_code || "").toUpperCase();

    if (roleCode !== "SUPER_ADMIN" && req.user.organization_id !== organizationId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT *
      FROM organizations
      WHERE id = $1
      LIMIT 1
      `,
      [organizationId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Organization not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("GET ORGANIZATION ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
});

router.post("/", requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const organizationType = String(req.body?.organization_type || "")
      .trim()
      .toUpperCase();
    const description = String(req.body?.description || "").trim() || null;
    const websiteUrl = String(req.body?.website_url || "").trim() || null;
    const phone = String(req.body?.phone || "").trim() || null;
    const email = String(req.body?.email || "").trim().toLowerCase() || null;
    const marketplaceTagline =
      String(req.body?.marketplace_tagline || "").trim() || null;
    const serviceSummary =
      String(req.body?.service_summary || "").trim() || null;
    const coverageArea =
      String(req.body?.coverage_area || "").trim() || null;
    const specializations =
      String(req.body?.specializations || "").trim() || null;
    const marketplaceEnabled =
      typeof req.body?.marketplace_enabled === "boolean"
        ? req.body.marketplace_enabled
        : false;
    const yearsInService =
      req.body?.years_in_service === "" || req.body?.years_in_service == null
        ? null
        : Number(req.body.years_in_service);

    if (!name || !organizationType) {
      return res.status(400).json({ error: "name and organization_type are required" });
    }

    if (!["CLIENT", "CONTRACTOR", "HYBRID", "PLATFORM_INTERNAL"].includes(organizationType)) {
      return res.status(400).json({
                error: "organization_type must be CLIENT, CONTRACTOR, HYBRID, or PLATFORM_INTERNAL",
      });
    }

    if (
      marketplaceEnabled === true &&
      !["CONTRACTOR", "HYBRID"].includes(organizationType)
    ) {
      return res.status(400).json({
        error: "Only contractor or hybrid organizations can be published in the marketplace",
      });
    }

    if (yearsInService !== null && (!Number.isInteger(yearsInService) || yearsInService < 0)) {
      return res.status(400).json({
        error: "years_in_service must be a whole number greater than or equal to 0",
      });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO organizations (
        name,
        organization_type,
        description,
        website_url,
        phone,
        email,
        marketplace_tagline,
        service_summary,
        coverage_area,
        specializations,
        years_in_service,
        marketplace_enabled
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
      `,
      [
        name,
        organizationType,
        description,
        websiteUrl,
        phone,
        email,
        marketplaceTagline,
        serviceSummary,
        coverageArea,
        specializations,
        yearsInService,
        marketplaceEnabled,
      ]
    );

    await logAudit({
      actorUserId: req.user.id,
      actionType: "ORGANIZATION_CREATED",
      entityType: "organization",
      entityId: rows[0].id,
      metadata: {
        organization_type: organizationType,
        email,
      },
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE ORGANIZATION ERROR:", error);

    if (String(error?.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "An organization with that name already exists" });
    }

    return res.status(500).json({ error: "Failed to create organization" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const client = await pool.connect();

  try {
    const organizationId = req.params.id;
    const roleCode = String(req.user?.role_code || "").toUpperCase();

    if (roleCode !== "SUPER_ADMIN" && req.user.organization_id !== organizationId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const name = String(req.body?.name || "").trim() || null;
    const organizationType = req.body?.organization_type
      ? String(req.body.organization_type).trim().toUpperCase()
      : null;
    const description = req.body?.description ?? null;
    const websiteUrl = req.body?.website_url ?? null;
    const phone = req.body?.phone ?? null;
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
    const marketplaceTagline =
      req.body?.marketplace_tagline != null
        ? String(req.body.marketplace_tagline).trim()
        : null;
    const serviceSummary =
      req.body?.service_summary != null
        ? String(req.body.service_summary).trim()
        : null;
    const coverageArea =
      req.body?.coverage_area != null
        ? String(req.body.coverage_area).trim()
        : null;
    const specializations =
      req.body?.specializations != null
        ? String(req.body.specializations).trim()
        : null;
    const yearsInService =
      req.body?.years_in_service === "" || req.body?.years_in_service == null
        ? null
        : Number(req.body.years_in_service);
    const marketplaceEnabled =
      typeof req.body?.marketplace_enabled === "boolean"
        ? req.body.marketplace_enabled
        : null;
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    if (organizationType && !["CLIENT", "CONTRACTOR", "HYBRID", "PLATFORM_INTERNAL"].includes(organizationType)) {
      return res.status(400).json({
        error: "organization_type must be CLIENT, CONTRACTOR, HYBRID, or PLATFORM_INTERNAL",
      });
    }

    if (
      marketplaceEnabled === true &&
      organizationType &&
      !["CONTRACTOR", "HYBRID"].includes(organizationType)
    ) {
      return res.status(400).json({
        error: "Only contractor or hybrid organizations can be published in the marketplace",
      });
    }

    if (yearsInService !== null && (!Number.isInteger(yearsInService) || yearsInService < 0)) {
      return res.status(400).json({
        error: "years_in_service must be a whole number greater than or equal to 0",
      });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT id, is_active, organization_type
      FROM organizations
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [organizationId]
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization not found" });
    }

    const previousIsActive = existing.rows[0].is_active;
    const effectiveOrganizationType = organizationType || existing.rows[0].organization_type;

    if (
      marketplaceEnabled === true &&
      !["CONTRACTOR", "HYBRID"].includes(effectiveOrganizationType)
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Only contractor or hybrid organizations can be published in the marketplace",
      });
    }

    const logoImageUrl = await storeBrandingImage(organizationId, req.body?.logo_image, "logo");
    const profileImageUrl = await storeBrandingImage(organizationId, req.body?.profile_image, "profile");
    const coverImageUrl = await storeBrandingImage(organizationId, req.body?.cover_image, "cover");

    const { rows } = await client.query(
      `
      UPDATE organizations
      SET
        name = COALESCE($1, name),
        organization_type = COALESCE($2, organization_type),
        description = COALESCE($3, description),
        website_url = COALESCE($4, website_url),
        phone = COALESCE($5, phone),
        email = COALESCE($6, email),
        marketplace_tagline = COALESCE($7, marketplace_tagline),
        service_summary = COALESCE($8, service_summary),
        coverage_area = COALESCE($9, coverage_area),
        specializations = COALESCE($10, specializations),
        years_in_service = COALESCE($11, years_in_service),
        marketplace_enabled = COALESCE($12, marketplace_enabled),
        is_active = COALESCE($13, is_active),
        logo_image_url = COALESCE($14, logo_image_url),
        profile_image_url = COALESCE($15, profile_image_url),
        cover_image_url = COALESCE($16, cover_image_url),
        updated_at = now()
      WHERE id = $17
      RETURNING *
      `,
      [
        name,
        organizationType,
        description,
        websiteUrl,
        phone,
        email,
        marketplaceTagline,
        serviceSummary,
        coverageArea,
        specializations,
        yearsInService,
        marketplaceEnabled,
        isActive,
        logoImageUrl,
        profileImageUrl,
        coverImageUrl,
        organizationId,
      ]
    );

    const current = rows[0];

    if (previousIsActive === true && current.is_active === false) {
      await disableOrganizationCascade(organizationId, client);
    } else if (previousIsActive === false && current.is_active === true) {
      await enableOrganizationOnly(organizationId, client);
    }

    await logAudit({
      actorUserId: req.user.id,
      actionType:
        previousIsActive !== current.is_active
          ? current.is_active
            ? "ORGANIZATION_REENABLED"
            : "ORGANIZATION_DISABLED"
          : "ORGANIZATION_UPDATED",
      entityType: "organization",
      entityId: organizationId,
      metadata: {
        organization_type: organizationType,
        is_active: isActive,
      },
      executor: client,
    });

    await client.query("COMMIT");

    return res.json(current);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("UPDATE ORGANIZATION ERROR:", error);
    return res.status(500).json({ error: "Failed to update organization" });
  } finally {
    client.release();
  }
});

module.exports = router;
