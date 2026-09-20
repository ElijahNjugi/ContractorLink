import client from "./client";

export async function fetchNotifications(params = {}) {
  const { data } = await client.get("/notifications", { params });
  return data;
}

export async function markNotificationRead(id) {
  const { data } = await client.patch(`/notifications/${id}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await client.patch("/notifications/read-all");
  return data;
}

export async function fetchNotificationSettings() {
  const { data } = await client.get("/notifications/settings/me");
  return data;
}

export async function updateNotificationSettings(payload) {
  const { data } = await client.put("/notifications/settings/me", payload);
  return data;
}
