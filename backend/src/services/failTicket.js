// Close unfinished work after its SLA deadline without recording it as completed.
async function failTicket(pool, ticketId, user, reason) {
  const client = await pool.connect();
  const reject = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [ticketId]);
    const ticket = rows[0];
    if (!ticket) reject('Ticket not found', 404);
    const admin = user.role_code === 'SUPER_ADMIN';
    if (!admin && !(user.role_code === 'ORG_ADMIN' && [ticket.requesting_organization_id, ticket.assigned_organization_id].includes(user.organization_id))) reject('Only an administrator of the client or assigned contractor can record failure.', 403);
    if (['COMPLETED','CANCELLED','FAILED'].includes(ticket.status)) reject('This ticket is already closed.', 409);
    if (!reason?.trim()) reject('Explain why the work was not completed.');
    const tracking = (await client.query('SELECT *, expected_end_time <= now() AS overdue FROM ticket_sla_tracking WHERE ticket_id=$1 FOR UPDATE', [ticketId])).rows[0];
    if (ticket.status === 'ON_HOLD' || tracking?.sla_status === 'PAUSED') reject('End the approved hold before recording the outcome.');
    if (!tracking || !(tracking.sla_status === 'BREACHED' || tracking.overdue)) reject('A ticket can be marked failed only after its SLA deadline.');
    const result = await client.query("UPDATE tickets SET status='FAILED', resolution_note=$2, failed_by=$3, failed_at=now(), updated_at=now() WHERE id=$1 RETURNING *", [ticketId, reason.trim(), user.id]);
    await client.query("UPDATE ticket_sla_tracking SET sla_status='FAILED', actual_end_time=now(), updated_at=now() WHERE ticket_id=$1", [ticketId]);
    await client.query("UPDATE ticket_chat_threads SET status='LOCKED', locked_at=COALESCE(locked_at,now()) WHERE ticket_id=$1", [ticketId]);
    await client.query('UPDATE ticket_ml_feedback SET actual_breached=true, captured_at=now() WHERE ticket_id=$1', [ticketId]);
    await client.query("UPDATE hold_requests SET status='CLOSED', updated_at=now() WHERE ticket_id=$1 AND status='PENDING'", [ticketId]);
    await require('./audit').logAudit({actorUserId:user.id, actionType:'TICKET_FAILED', entityType:'ticket', entityId:ticketId, metadata:{reason:reason.trim()}, executor:client});
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { failTicket };
