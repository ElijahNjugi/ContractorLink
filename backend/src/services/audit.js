const pool = require("../config/db");

async function logAudit({
  actorUserId = null,
  actionType,
  entityType,
  entityId = null,
  metadata = null,
  executor = pool,
}) {
  if (!actionType || !entityType) {
    return null;
  }

  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  const { rows } = await executor.query(
    `
    INSERT INTO audit_logs (
      actor_user_id,
      action_type,
      entity_type,
      entity_id,
      metadata_json
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *
    `,
    [actorUserId, actionType, entityType, entityId, metadataJson]
  );

  return rows[0] || null;
}

module.exports = {
  logAudit,
};
