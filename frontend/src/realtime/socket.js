import { io } from "socket.io-client";

let socket;

export function getRealtimeSocket(token) {
  if (!token) return null;
  if (!socket) {
    const baseUrl = (import.meta.env.VITE_API_BASE_URL || window.location.origin + "/api").replace(/\/api\/?$/, "") || window.location.origin;
    socket = io(baseUrl, { auth: { token } });
  }
  return socket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = undefined;
}
