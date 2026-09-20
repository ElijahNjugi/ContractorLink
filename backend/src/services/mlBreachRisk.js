const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PYTHON = process.env.PYTHON_EXECUTABLE || path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const SCRIPT = path.join(ROOT, "ml", "predict_breach_risk.py");

let predictor = null;
let outputBuffer = "";
let requestNumber = 0;
const pendingPredictions = new Map();

function clearPending(error) {
  for (const pending of pendingPredictions.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingPredictions.clear();
}

function startPredictor() {
  if (predictor && !predictor.killed) return predictor;

  outputBuffer = "";
  predictor = spawn(PYTHON, ["-u", SCRIPT, "--serve"], {
    windowsHide: true,
    env: {
      ...process.env,
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      MKL_NUM_THREADS: "1",
    },
  });

  predictor.stdout.on("data", (chunk) => {
    outputBuffer += chunk;
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.type === "ready") {
          console.log("ML predictor ready");
          continue;
        }
        const pending = pendingPredictions.get(String(message.id));
        if (!pending) continue;
        pendingPredictions.delete(String(message.id));
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve({ model_version: message.model_version, breach_risk: message.breach_risk });
      } catch (error) {
        console.error("ML predictor returned invalid output:", error.message);
      }
    }
  });
  predictor.stderr.on("data", (chunk) => console.error("ML PREDICTOR ERROR:", String(chunk).trim()));
  predictor.on("error", (error) => {
    if (predictor) predictor = null;
    clearPending(error);
  });
  predictor.on("close", (code) => {
    const error = new Error(`ML predictor stopped${code == null ? "" : ` with code ${code}`}`);
    predictor = null;
    clearPending(error);
  });
  return predictor;
}

function scoreBreachRisk(features) {
  return new Promise((resolve, reject) => {
    const id = String(++requestNumber);
    const timeout = setTimeout(() => {
      pendingPredictions.delete(id);
      reject(new Error("ML scoring timed out"));
    }, Number(process.env.ML_SCORING_TIMEOUT_MS || 45000));
    timeout.unref();
    pendingPredictions.set(id, { resolve, reject, timeout });
    const child = startPredictor();
    child.stdin.write(`${JSON.stringify({ id, features })}\n`, (error) => {
      if (!error) return;
      const pending = pendingPredictions.get(id);
      if (!pending) return;
      pendingPredictions.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    });
  });
}

function warmBreachRiskPredictor() {
  startPredictor();
}

process.once("exit", () => predictor?.kill());

module.exports = { scoreBreachRisk, warmBreachRiskPredictor };
