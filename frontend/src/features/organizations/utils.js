export const FRIENDLY_ROLE_LABELS = {
  ORG_ADMIN: "Organization Admin",
  ORG_STAFF: "Field Staff",
  DIRECTOR: "Director",
  STAFF: "Staff",
};

export function getFriendlyRoleLabel(roleCode, fallback) {
  return FRIENDLY_ROLE_LABELS[roleCode] || fallback || roleCode;
}
