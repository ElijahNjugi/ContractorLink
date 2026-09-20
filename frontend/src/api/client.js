import axios from "axios";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
});

export function attachAuthToken(token) {
  if (token) {
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete client.defaults.headers.common.Authorization;
  }
}

export function assetUrl(value) {
  if (!value || /^https?:\/\//i.test(value) || /^data:/i.test(value)) return value || "";
  const apiBase = client.defaults.baseURL.replace(/\/api\/?$/, "");
  return `${apiBase}${String(value).startsWith("/") ? "" : "/"}${value}`;
}

export default client;
