const express = require("express");

const requireRole = require("../middleware/requireRole");
const { runSlaMonitor } = require("../services/slaMonitor");

const router = express.Router();

router.post("/run", requireRole("SUPER_ADMIN"), async (req, res) => {
  try {
    const result = await runSlaMonitor({ force: true });
    return res.json(result);
  } catch (error) {
    console.error("RUN SLA MONITOR ERROR:", error);
    return res.status(500).json({ error: "Failed to run SLA monitor" });
  }
});

module.exports = router;
