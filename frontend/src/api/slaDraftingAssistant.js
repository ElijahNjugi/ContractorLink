import client from "./client";

export async function draftSlaClause(payload) {
  const { data } = await client.post("/sla-drafting-assistant/draft", payload);
  return data;
}
