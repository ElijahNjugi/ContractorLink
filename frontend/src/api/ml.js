import client from "./client";
export async function fetchMlSummary() { const { data } = await client.get("/ml/summary"); return data; }
export async function fetchMlAdministration() { const { data } = await client.get("/ml/admin"); return data; }
export async function retrainMlModel() { const { data } = await client.post("/ml/retrain"); return data; }
