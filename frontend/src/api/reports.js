import client from "./client";
export async function fetchOperationsReport() { const { data } = await client.get("/reports/operations"); return data; }
export async function downloadOperationsReport() { const { data } = await client.get("/reports/operations/export", { responseType: "blob" }); return data; }
