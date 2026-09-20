require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("../src/config/db");

const roleSeeds = [
  {
    code: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Platform-wide administrator with full access.",
  },
  {
    code: "ORG_ADMIN",
    name: "Organization Admin",
    description: "Administrator scoped to one organization.",
  },
  {
    code: "ORG_STAFF",
    name: "Organization Staff",
    description: "Operational staff working on tickets for an organization.",
  },
  {
    code: "DIRECTOR",
    name: "Director",
    description: "Oversight role with organization-level visibility.",
  },
  {
    code: "APPLICANT_REP",
    name: "Applicant Representative",
    description: "Representative of a company applying to join the platform.",
  },
];

const platformOrgSeed = {
  name: "Platform Internal",
  organization_type: "PLATFORM_INTERNAL",
  description: "Internal platform organization used for system-level administration.",
  email: process.env.SUPER_ADMIN_EMAIL || process.env.MAIL_USER || "admin@contractorlink.local",
};

const superAdminSeed = {
  full_name: process.env.SUPER_ADMIN_NAME || "Platform Administrator",
  email: process.env.SUPER_ADMIN_EMAIL || process.env.MAIL_USER || "admin@contractorlink.local",
  password: process.env.SUPER_ADMIN_PASSWORD,
};

async function ensureRole(client, role) {
  const { rows } = await client.query(
    `
    INSERT INTO roles (code, name, description)
    VALUES ($1, $2, $3)
    ON CONFLICT (code)
    DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = now()
    RETURNING id, code
    `,
    [role.code, role.name, role.description]
  );

  return rows[0];
}

async function ensurePlatformOrganization(client) {
  const { rows } = await client.query(
    `
    INSERT INTO organizations (name, organization_type, description, email)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (name)
    DO UPDATE SET
      organization_type = EXCLUDED.organization_type,
      description = EXCLUDED.description,
      email = EXCLUDED.email,
      updated_at = now()
    RETURNING id, name
    `,
    [
      platformOrgSeed.name,
      platformOrgSeed.organization_type,
      platformOrgSeed.description,
      platformOrgSeed.email,
    ]
  );

  return rows[0];
}

async function ensureSuperAdmin(client, roleId, organizationId) {
  const passwordHash = await bcrypt.hash(superAdminSeed.password, 10);

  const { rows } = await client.query(
    `
    INSERT INTO users (
      organization_id,
      role_id,
      full_name,
      email,
      password_hash,
      is_active,
      must_change_password
    )
    VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
    ON CONFLICT (email)
    DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      role_id = EXCLUDED.role_id,
      full_name = EXCLUDED.full_name,
      password_hash = EXCLUDED.password_hash,
      is_active = TRUE,
      must_change_password = TRUE,
      updated_at = now()
    RETURNING id, email
    `,
    [
      organizationId,
      roleId,
      superAdminSeed.full_name,
      superAdminSeed.email,
      passwordHash,
    ]
  );

  return rows[0];
}

async function main() {
  if (!superAdminSeed.password || superAdminSeed.password.length < 12) {
    console.error("Set SUPER_ADMIN_PASSWORD to a unique password of at least 12 characters before running the development seed.");
    process.exitCode = 1;
    await pool.end();
    return;
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roleMap = {};
    for (const role of roleSeeds) {
      const created = await ensureRole(client, role);
      roleMap[created.code] = created.id;
    }

    const platformOrganization = await ensurePlatformOrganization(client);
    const superAdmin = await ensureSuperAdmin(
      client,
      roleMap.SUPER_ADMIN,
      platformOrganization.id
    );

    await client.query("COMMIT");

    console.log("Bootstrap complete.");
    console.log(`Platform organization: ${platformOrganization.name}`);
    console.log(`Super admin email: ${superAdmin.email}`);
    console.log("You should change this password after first login.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
