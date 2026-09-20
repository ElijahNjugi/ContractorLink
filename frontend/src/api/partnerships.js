import client from "./client";

export async function fetchPartnerships(params = {}) {
  const { data } = await client.get("/partnerships", { params });
  return data;
}

export async function updatePartnership(id, payload) {
  const { data } = await client.patch(`/partnerships/${id}`, payload);
  return data;
}
