const { Pool } = require("pg");
const pool = new Pool({ host: "localhost", port: 5432, database: "Ticketing_system", user: "postgres", password: "146412" });
(async () => {
  const { rows } = await pool.query(`
    SELECT
      SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active_orgs,
      SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END)::int AS inactive_orgs
    FROM organizations
  `);
  console.log(JSON.stringify(rows[0]));
  await pool.end();
})();
