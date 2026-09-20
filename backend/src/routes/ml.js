const express = require("express");
const pool = require("../config/db");
const requireRole = require("../middleware/requireRole");
const { scoreBreachRisk } = require("../services/mlBreachRisk");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const router = express.Router();
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PYTHON = process.env.PYTHON_EXECUTABLE || path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const TRAINING_SCRIPT = path.join(ROOT, "ml", "train_breach_model.py");
const METRICS_FILE = path.join(ROOT, "ml", "models", "breach_risk_v1_metrics.json");
const DATA_FILE = path.join(ROOT, "ml", "data", "hybrid_breach_training.csv");
let training = { status: "IDLE", started_at: null, finished_at: null, error: null };
router.get("/summary", requireRole("SUPER_ADMIN"), async (_req, res) => {
  const { rows } = await pool.query("SELECT version, training_rows, roc_auc, trained_at FROM ml_model_versions WHERE is_active = TRUE LIMIT 1");
  const feedback = await pool.query(
    "SELECT COUNT(*)::int AS scored_tickets, COUNT(*) FILTER (WHERE actual_breached IS NOT NULL)::int AS confirmed_outcomes FROM ticket_ml_feedback"
  );
  res.json({ model: rows[0] || null, ...feedback.rows[0] });
});
router.post("/breach-risk", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => { try { res.json(await scoreBreachRisk(req.body || {})); } catch (error) { res.status(503).json({ error: error.message }); } });
router.get("/admin", requireRole("SUPER_ADMIN"), async (_req, res) => {
  try {
    const [versions, predictions] = await Promise.all([
      pool.query("SELECT version, training_rows, roc_auc, is_active, trained_at, metadata_json FROM ml_model_versions ORDER BY trained_at DESC"),
      pool.query("SELECT model_version, COUNT(*)::int AS predictions, COUNT(*) FILTER (WHERE actual_breached IS NOT NULL)::int AS outcomes, ROUND(AVG(predicted_breach_risk)::numeric, 3) AS average_predicted_risk FROM ticket_ml_feedback GROUP BY model_version ORDER BY model_version DESC"),
    ]);
    let metrics = null; let dataset_rows = null;
    try { metrics = JSON.parse(await fs.readFile(METRICS_FILE, "utf8")); dataset_rows = (await fs.readFile(DATA_FILE, "utf8")).trim().split(/\r?\n/).length - 1; } catch { /* Model files can be created after the first training run. */ }
    return res.json({ training, metrics, dataset_rows, versions: versions.rows, predictions: predictions.rows });
  } catch (error) { return res.status(500).json({ error: "Unable to load ML administration data" }); }
});
router.post("/retrain", requireRole("SUPER_ADMIN"), async (_req, res) => {
  if (training.status === "RUNNING") return res.status(409).json({ error: "Model training is already running" });
  training = { status: "RUNNING", started_at: new Date().toISOString(), finished_at: null, error: null };
  const child = spawn(PYTHON, ["-u", TRAINING_SCRIPT], { windowsHide: true, env: { ...process.env, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1" } });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { training = { ...training, status: "FAILED", finished_at: new Date().toISOString(), error: error.message }; });
  child.on("close", async (code) => {
    if (code !== 0) { training = { ...training, status: "FAILED", finished_at: new Date().toISOString(), error: stderr || "Training failed" }; return; }
    try {
      const metrics = JSON.parse(await fs.readFile(METRICS_FILE, "utf8"));
      await pool.query("UPDATE ml_model_versions SET is_active = FALSE WHERE model_name = 'breach_risk'");
      await pool.query(`INSERT INTO ml_model_versions (model_name, version, training_rows, roc_auc, is_active, metadata_json) VALUES ('breach_risk',$1,$2,$3,TRUE,$4) ON CONFLICT (model_name, version) DO UPDATE SET training_rows=EXCLUDED.training_rows, roc_auc=EXCLUDED.roc_auc, is_active=TRUE, trained_at=now(), metadata_json=EXCLUDED.metadata_json`, [metrics.model_version, metrics.training_rows, metrics.roc_auc, JSON.stringify({ features: metrics.features, breach_rate: metrics.breach_rate })]);
      training = { ...training, status: "COMPLETED", finished_at: new Date().toISOString(), error: null };
    } catch (error) { training = { ...training, status: "FAILED", finished_at: new Date().toISOString(), error: error.message }; }
  });
  return res.status(202).json(training);
});
module.exports = router;
