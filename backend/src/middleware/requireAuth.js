const jwt = require("jsonwebtoken");
const pool = require("../config/db");

module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.organization_id,
        u.full_name,
        u.email,
        u.phone,
        u.job_title,
        u.is_active,
        u.must_change_password,
        r.code AS role_code,
        r.name AS role_name,
        o.name AS organization_name,
        o.organization_type,
        o.is_active AS organization_is_active
      FROM users u
      JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN organizations o
        ON o.id = u.organization_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = rows[0];

    if (user.is_active === false) {
      return res.status(403).json({
        error: "ACCOUNT_DISABLED",
        message: "Your account has been deactivated.",
      });
    }

    if (
      user.organization_id &&
      user.organization_is_active === false
    ) {
      return res.status(403).json({
        error: "ORGANIZATION_DISABLED",
        message: "Your organization has been disabled.",
      });
    }

    req.user = {
      id: user.id,
      organization_id: user.organization_id,
      organization: user.organization_name,
      organization_type: user.organization_type,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      job_title: user.job_title,
      must_change_password: user.must_change_password,
      role_code: user.role_code,
      role_name: user.role_name,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
