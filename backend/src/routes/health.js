const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true, database: "connected" });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      database: "disconnected",
      error: error.message,
    });
  }
});

module.exports = router;
