import client from "./client";
export async function fetchTicketHolds(ticketId) { const { data } = await client.get("/holds", { params: { ticket_id: ticketId } }); return data; }
export async function createHoldRequest(payload) { const { data } = await client.post("/holds", payload); return data; }
export async function reviewHoldRequest(id, payload) { const { data } = await client.patch(`/holds/${id}/review`, payload); return data; }
export async function closeHoldRequest(id) { const { data } = await client.patch(`/holds/${id}/close`); return data; }
