const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "Ticketing_system",
  user: "postgres",
  password: "146412",
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const protectedOrgName = "Platform Internal";
    const protectedEmail = "njugielijah@gmail.com";

    const { rows: orgs } = await client.query(
      `SELECT id, name FROM organizations WHERE name <> $1`,
      [protectedOrgName]
    );

    const orgIds = orgs.map((row) => row.id);

    if (orgIds.length) {
      await client.query(
        `UPDATE organizations
         SET is_active = FALSE, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [orgIds]
      );

      await client.query(
        `UPDATE users
         SET is_active = FALSE, updated_at = now()
         WHERE organization_id = ANY($1::uuid[])
           AND LOWER(email) <> LOWER($2)`,
        [orgIds, protectedEmail]
      );

      await client.query(
        `UPDATE organization_partnerships
         SET status = 'SUSPENDED', updated_at = now()
         WHERE client_organization_id = ANY($1::uuid[])
            OR contractor_organization_id = ANY($1::uuid[])`,
        [orgIds]
      );

      await client.query(
        `UPDATE sla_agreements
         SET status = 'INACTIVE', updated_at = now()
         WHERE client_organization_id = ANY($1::uuid[])
            OR contractor_organization_id = ANY($1::uuid[])`,
        [orgIds]
      );

      await client.query(
        `UPDATE tickets
         SET status = CASE WHEN status = 'COMPLETED' THEN status ELSE 'CANCELLED' END,
             updated_at = now()
         WHERE requesting_organization_id = ANY($1::uuid[])
            OR assigned_organization_id = ANY($1::uuid[])`,
        [orgIds]
      );

      await client.query(
        `UPDATE ticket_sla_tracking st
         SET sla_status = 'COMPLETED',
             actual_end_time = COALESCE(actual_end_time, now()),
             updated_at = now()
         FROM tickets t
         WHERE st.ticket_id = t.id
           AND (t.requesting_organization_id = ANY($1::uuid[]) OR t.assigned_organization_id = ANY($1::uuid[]))
           AND st.sla_status <> 'COMPLETED'`,
        [orgIds]
      );

      await client.query(
        `UPDATE ticket_chat_threads th
         SET status = 'LOCKED',
             locked_at = COALESCE(locked_at, now())
         FROM tickets t
         WHERE th.ticket_id = t.id
           AND (t.requesting_organization_id = ANY($1::uuid[]) OR t.assigned_organization_id = ANY($1::uuid[]))
           AND th.status <> 'LOCKED'`,
        [orgIds]
      );
    }

    await client.query("COMMIT");

    console.log(JSON.stringify({
      disabledOrganizations: orgs.map((o) => o.name),
      keptOrganization: protectedOrgName,
      keptUser: protectedEmail,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
