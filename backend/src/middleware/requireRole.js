module.exports = (...allowedRoles) => {
  const allowed = allowedRoles.map((role) => String(role || "").toUpperCase());

  return (req, res, next) => {
    const current = String(req.user?.role_code || "").toUpperCase();

    if (!current) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!allowed.includes(current)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
};
