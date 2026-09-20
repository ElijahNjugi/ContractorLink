require("dotenv").config();

const http = require("http");
const app = require("./app");
const { startSlaMonitor } = require("./services/slaMonitor");
const { initializeRealtime } = require("./services/realtime");
const { warmBreachRiskPredictor } = require("./services/mlBreachRisk");

const PORT = Number(process.env.PORT || 5000);

const server = http.createServer(app);
initializeRealtime(server);

server.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
  startSlaMonitor();
  warmBreachRiskPredictor();
});

// The local launcher uses IPC so exit handlers can stop the Python worker on Windows.
process.on("message", (message) => {
  if (message !== "contractorlink:shutdown") return;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
