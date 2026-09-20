import client from "./client";

export async function fetchTickets(params = {}) {
  const { data } = await client.get("/tickets", { params });
  return data;
}

export async function fetchTicket(id) {
  const { data } = await client.get(`/tickets/${id}`);
  return data;
}

export async function createTicket(payload) {
  const { data } = await client.post("/tickets", payload);
  return data;
}

export async function updateTicket(id, payload) {
  const { data } = await client.patch(`/tickets/${id}`, payload);
  return data;
}

export async function fetchTicketAssignmentOptions(params) {
  const { data } = await client.get("/tickets/assignment-options", { params });
  return data;
}

export async function fetchTicketChat(ticketId) {
  const { data } = await client.get(`/ticket-chat/${ticketId}`);
  return data;
}

export async function sendTicketChatMessage(ticketId, messageText) {
  const { data } = await client.post(`/ticket-chat/${ticketId}/messages`, { message_text: messageText });
  return data;
}
