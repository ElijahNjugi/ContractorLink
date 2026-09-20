const express = require("express");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

function fallback(question) {
  const text = String(question || "").toLowerCase();
  if (text.includes("sla") || text.includes("agreement")) return "Start with an active partnership, then draft the SLA. The client submits the service terms; the contractor must add payment terms, delivery contact, breach remedies, and 30/15-minute and breach email recipients before approving.";
  if (text.includes("ticket")) return "Tickets can only be created under an active SLA. Choose the priority and assign the work to the contractor organization, a department, or a named person. The SLA controls the deadline and escalation timer.";
  if (text.includes("breach") || text.includes("escalat")) return "Tickets turn amber in the final 20% of the SLA target and red when breached. The agreed 30-minute, 15-minute, and breach-time email groups receive automatic alerts while the ticket remains open.";
  if (text.includes("market") || text.includes("partner")) return "Use Marketplace to find a contractor, then select the contractor and send a partnership request. Once both organizations accept, you can draft an SLA.";
  return "I can help with Marketplace, partnerships, SLA drafting and approval, escalation rules, tickets, departments, notifications, and dashboards. Tell me what you are trying to do.";
}

router.post("/ask", requireRole("SUPER_ADMIN", "ORG_ADMIN", "ORG_STAFF", "DIRECTOR"), async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (question.length < 2) return res.status(400).json({ error: "Ask a short question first." });
  if (String(process.env.AI_PROVIDER || "guided").toLowerCase() !== "ollama") return res.json({ answer: fallback(question), mode: "guided" });
  try {
    const prompt = `You are ContractorLink Help, a concise in-app assistant. Explain only how to use this platform. Known workflow: Marketplace -> partnership -> client SLA draft -> contractor adds commercial/contact/escalation terms -> active SLA -> tickets. SLA alerts occur 30 minutes before, 15 minutes before, and at breach. Do not give legal advice, invent features, or discuss unrelated topics. User question: ${question}`;
    const response = await fetch(process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "gemma3:4b", prompt, stream: false, options: { temperature: 0.25 } }) });
    if (!response.ok) throw new Error("Ollama unavailable");
    const data = await response.json();
    return res.json({ answer: String(data.response || fallback(question)).trim(), mode: "local_ai" });
  } catch (error) { return res.json({ answer: fallback(question), mode: "guided" }); }
});

module.exports = router;
