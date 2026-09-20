const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const organizationApplicationRoutes = require("./routes/organizationApplications");
const organizationRoutes = require("./routes/organizations");
const organizationContactRoutes = require("./routes/organizationContacts");
const organizationUserRoutes = require("./routes/organizationUsers");
const departmentRoutes = require("./routes/departments");
const partnershipRoutes = require("./routes/partnerships");
const slaAgreementRoutes = require("./routes/slaAgreements");
const slaDraftingAssistantRoutes = require("./routes/slaDraftingAssistant");
const ticketTypeRoutes = require("./routes/ticketTypes");
const assetRoutes = require("./routes/assets");
const ticketRoutes = require("./routes/tickets");
const holdRoutes = require("./routes/holds");
const ticketChatRoutes = require("./routes/ticketChat");
const notificationRoutes = require("./routes/notifications");
const slaMonitorRoutes = require("./routes/slaMonitor");
const platformAssistantRoutes = require("./routes/platformAssistant");
const mlRoutes = require("./routes/ml");
const workspaceContextRoutes = require("./routes/workspaceContext");
const auditLogRoutes = require("./routes/auditLogs");
const reportRoutes = require("./routes/reports");

const requireAuth = require("./middleware/requireAuth");
const enforcePasswordChange = require("./middleware/enforcePasswordChange");

const app = express();

app.use(
  cors({
    origin: process.env.APP_BASE_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(process.env.UPLOAD_ROOT || path.join(__dirname, "..", "uploads")));

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organization-applications", organizationApplicationRoutes);
app.use("/api/organizations", requireAuth, enforcePasswordChange, organizationRoutes);
app.use("/api/organization-contacts", requireAuth, enforcePasswordChange, organizationContactRoutes);
app.use("/api/organization-users", requireAuth, enforcePasswordChange, organizationUserRoutes);
app.use("/api/departments", requireAuth, enforcePasswordChange, departmentRoutes);
app.use("/api/partnerships", requireAuth, enforcePasswordChange, partnershipRoutes);
app.use("/api/sla-agreements", requireAuth, enforcePasswordChange, slaAgreementRoutes);
app.use("/api/sla-drafting-assistant", requireAuth, enforcePasswordChange, slaDraftingAssistantRoutes);
app.use("/api/ticket-types", requireAuth, enforcePasswordChange, ticketTypeRoutes);
app.use("/api/assets", requireAuth, enforcePasswordChange, assetRoutes);
app.use("/api/tickets", requireAuth, enforcePasswordChange, ticketRoutes);
app.use("/api/holds", requireAuth, enforcePasswordChange, holdRoutes);
app.use("/api/ticket-chat", requireAuth, enforcePasswordChange, ticketChatRoutes);
app.use("/api/notifications", requireAuth, enforcePasswordChange, notificationRoutes);
app.use("/api/sla-monitor", requireAuth, enforcePasswordChange, slaMonitorRoutes);
app.use("/api/platform-assistant", requireAuth, enforcePasswordChange, platformAssistantRoutes);
app.use("/api/ml", requireAuth, enforcePasswordChange, mlRoutes);
app.use("/api/workspace-context", requireAuth, enforcePasswordChange, workspaceContextRoutes);
app.use("/api/audit-logs", requireAuth, enforcePasswordChange, auditLogRoutes);
app.use("/api/reports", requireAuth, enforcePasswordChange, reportRoutes);

const frontendDist = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(path.join(frontendDist, "index.html")) && process.env.SERVE_FRONTEND === "true") {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "company-contractor-ticketing-backend",
  });
});

module.exports = app;
