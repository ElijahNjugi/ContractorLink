function roleCode(req) {
  return String(req.user?.role_code || "").toUpperCase();
}

function canAccessOrganization(req, organizationId) {
  const role = roleCode(req);
  if (role === "SUPER_ADMIN") return true;

  if (["ORG_ADMIN", "DIRECTOR", "ORG_STAFF"].includes(role)) {
    return String(req.user.organization_id) === String(organizationId);
  }

  return false;
}

function canManageOrganization(req, organizationId) {
  const role = roleCode(req);
  if (role === "SUPER_ADMIN") return true;

  if (role === "ORG_ADMIN") {
    return String(req.user.organization_id) === String(organizationId);
  }

  return false;
}

module.exports = {
  roleCode,
  canAccessOrganization,
  canManageOrganization,
};
