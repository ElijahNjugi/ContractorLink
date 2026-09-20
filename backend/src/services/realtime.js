const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

let io = null;

function initializeRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.APP_BASE_URL || "http://localhost:5173", credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = String(user.id);
      next();
    } catch {
      next(new Error("Unauthorized realtime connection"));
    }
  });

  io.on("connection", (socket) => socket.join(`user:${socket.userId}`));
  return io;
}

function emitToUsers(userIds, eventName, payload) {
  if (!io) return;
  [...new Set((userIds || []).filter(Boolean).map(String))].forEach((userId) => io.to(`user:${userId}`).emit(eventName, payload));
}

function emitToSuperAdmins(eventName, payload) {
  if (io) io.emit(eventName, payload);
}

module.exports = { initializeRealtime, emitToUsers, emitToSuperAdmins };
