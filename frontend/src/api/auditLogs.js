import client from "./client";

export async function fetchAuditLogs(limit = 30) {
  const { data } = await client.get("/audit-logs", { params: { limit } });
  return data;
}

export async function downloadAuditLogs() {
  const response = await client.get("/audit-logs/export", {
    params: { limit: 5000 },
    responseType: "blob",
  });
  const downloadUrl = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `contractorlink-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}
