import client from "./client";

export async function fetchSlaAgreements(params = {}) {
  const { data } = await client.get("/sla-agreements", { params });
  return data;
}

export async function fetchSlaAgreement(id) {
  const { data } = await client.get(`/sla-agreements/${id}`);
  return data;
}

export async function createSlaAgreement(payload) {
  const { data } = await client.post("/sla-agreements", payload);
  return data;
}

export async function updateSlaAgreement(id, payload) {
  const { data } = await client.patch(`/sla-agreements/${id}`, payload);
  return data;
}

export async function saveSlaPolicy(agreementId, payload) {
  const { data } = await client.post(`/sla-agreements/${agreementId}/policies`, payload);
  return data;
}

export async function submitSlaAgreement(id) {
  const { data } = await client.post(`/sla-agreements/${id}/submit`);
  return data;
}

export async function decideSlaAgreement(id, payload) {
  const { data } = await client.post(`/sla-agreements/${id}/decision`, payload);
  return data;
}

export async function revokeSlaAgreement(id, payload) {
  const { data } = await client.post(`/sla-agreements/${id}/revoke`, payload);
  return data;
}
