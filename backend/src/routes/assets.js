const express = require("express");

const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { roleCode, canAccessOrganization, canManageOrganization } = require("../utils/orgAccess");

const router = express.Router();

async function getAssetCategoryById(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM asset_categories
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function getOrganizationById(id) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM organizations
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

router.get("/categories", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
    const params = [];
    const where = activeOnly ? "WHERE is_active = $1" : "";

    if (activeOnly) {
      params.push(true);
    }

    const { rows } = await pool.query(
      `
      SELECT *
      FROM asset_categories
      ${where}
      ORDER BY name ASC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ASSET CATEGORIES ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch asset categories" });
  }
});

router.post("/categories", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim() || null;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO asset_categories (
        name,
        description
      )
      VALUES ($1, $2)
      RETURNING *
      `,
      [name, description]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE ASSET CATEGORY ERROR:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "An asset category with that name already exists" });
    }
    return res.status(500).json({ error: "Failed to create asset category" });
  }
});

router.patch("/categories/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const isActive =
      typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

    const { rows } = await pool.query(
      `
      UPDATE asset_categories
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
      return res.status(404).json({ error: "Asset category not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE ASSET CATEGORY ERROR:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "An asset category with that name already exists" });
    }
    return res.status(500).json({ error: "Failed to update asset category" });
  }
});

router.get("/", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const requestedOrgId = req.query.organization_id || null;
    const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
    const params = [];
    const clauses = [];
    const currentRole = roleCode(req);

    if (currentRole === "SUPER_ADMIN") {
      if (requestedOrgId) {
        params.push(requestedOrgId);
        clauses.push(`a.organization_id = $${params.length}`);
      }
    } else {
      params.push(req.user.organization_id);
      clauses.push(`a.organization_id = $${params.length}`);
    }

    if (activeOnly) {
      params.push("ACTIVE");
      clauses.push(`a.status = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        a.*,
        o.name AS organization_name,
        ac.name AS asset_category_name,
        creator.full_name AS created_by_name
      FROM assets a
      JOIN organizations o
        ON o.id = a.organization_id
      JOIN asset_categories ac
        ON ac.id = a.asset_category_id
      LEFT JOIN users creator
        ON creator.id = a.created_by
      ${where}
      ORDER BY a.created_at DESC, a.name ASC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("LIST ASSETS ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch assets" });
  }
});

router.get("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        a.*,
        o.name AS organization_name,
        ac.name AS asset_category_name,
        creator.full_name AS created_by_name
      FROM assets a
      JOIN organizations o
        ON o.id = a.organization_id
      JOIN asset_categories ac
        ON ac.id = a.asset_category_id
      LEFT JOIN users creator
        ON creator.id = a.created_by
      WHERE a.id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const asset = rows[0];
    if (!canAccessOrganization(req, asset.organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(asset);
  } catch (error) {
    console.error("GET ASSET ERROR:", error);
    return res.status(500).json({ error: "Failed to fetch asset" });
  }
});

router.post("/", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const organizationId = req.body?.organization_id || req.user.organization_id;
    const assetCategoryId = req.body?.asset_category_id;
    const name = String(req.body?.name || "").trim();
    const location = String(req.body?.location || "").trim() || null;
    const status = String(req.body?.status || "ACTIVE").trim().toUpperCase();
    const description = String(req.body?.description || "").trim() || null;
    const serialNumber = String(req.body?.serial_number || "").trim() || null;

    if (!organizationId || !assetCategoryId || !name) {
      return res.status(400).json({
        error: "organization_id, asset_category_id, and name are required",
      });
    }

    if (!canManageOrganization(req, organizationId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!["ACTIVE", "INACTIVE", "MAINTENANCE", "RETIRED"].includes(status)) {
      return res.status(400).json({
        error: "status must be ACTIVE, INACTIVE, MAINTENANCE, or RETIRED",
      });
    }

    const [organization, category] = await Promise.all([
      getOrganizationById(organizationId),
      getAssetCategoryById(assetCategoryId),
    ]);

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    if (!category) {
      return res.status(404).json({ error: "Asset category not found" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO assets (
        organization_id,
        asset_category_id,
        name,
        location,
        status,
        description,
        serial_number,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        organizationId,
        assetCategoryId,
        name,
        location,
        status,
        description,
        serialNumber,
        req.user.id,
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("CREATE ASSET ERROR:", error);
    return res.status(500).json({ error: "Failed to create asset" });
  }
});

router.patch("/:id", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  try {
    const existing = await pool.query(
      `
      SELECT *
      FROM assets
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const asset = existing.rows[0];
    if (!canManageOrganization(req, asset.organization_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let assetCategoryId = null;
    if (req.body?.asset_category_id) {
      const category = await getAssetCategoryById(req.body.asset_category_id);
      if (!category) {
        return res.status(404).json({ error: "Asset category not found" });
      }
      assetCategoryId = category.id;
    }

    const name = req.body?.name ? String(req.body.name).trim() : null;
    const location =
      typeof req.body?.location === "string" ? req.body.location.trim() : null;
    const status = req.body?.status ? String(req.body.status).trim().toUpperCase() : null;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const serialNumber =
      typeof req.body?.serial_number === "string" ? req.body.serial_number.trim() : null;

    if (status && !["ACTIVE", "INACTIVE", "MAINTENANCE", "RETIRED"].includes(status)) {
      return res.status(400).json({
        error: "status must be ACTIVE, INACTIVE, MAINTENANCE, or RETIRED",
      });
    }

    const { rows } = await pool.query(
      `
      UPDATE assets
      SET
        asset_category_id = COALESCE($1, asset_category_id),
        name = COALESCE($2, name),
        location = COALESCE($3, location),
        status = COALESCE($4, status),
        description = COALESCE($5, description),
        serial_number = COALESCE($6, serial_number),
        updated_at = now()
      WHERE id = $7
      RETURNING *
      `,
      [assetCategoryId, name, location, status, description, serialNumber, req.params.id]
    );

    return res.json(rows[0]);
  } catch (error) {
    console.error("UPDATE ASSET ERROR:", error);
    return res.status(500).json({ error: "Failed to update asset" });
  }
});

module.exports = router;
