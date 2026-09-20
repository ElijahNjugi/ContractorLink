const express = require("express");
const requireRole = require("../middleware/requireRole");
const { fallbackOptions, getGuide, SECTION_GUIDES } = require("../services/slaDraftingAssistant");

const router = express.Router();

function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => String(option || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function generateWithOpenAi({ section, answer, context }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: [
        "You are ContractorLink's SLA drafting assistant.",
        "Write clear, neutral business-language draft clauses for a service-level agreement.",
        "This is not legal advice. Do not claim that wording is legally enforceable or sufficient for court.",
        "Do not invent facts, prices, laws, party names, certifications, or obligations not supplied by the user.",
        "Return only valid JSON: {\"options\":[\"...\",\"...\",\"...\",\"...\"]}.",
        "Provide exactly four distinct, concise options. Each option must be usable as an editable draft clause.",
      ].join(" "),
      input: `SLA section: ${section}\nUser's plain-English answer: ${answer}\nContext: ${context || "No additional context."}`,
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(data.output_text || "{}");
  return cleanOptions(parsed.options);
}

async function generateWithOllama({ section, answer, context }) {
  const prompt = [
    "You are ContractorLink's SLA drafting assistant.",
    "Write clear, neutral business-language draft clauses for a service-level agreement.",
    "This is not legal advice. Do not claim wording is legally enforceable or sufficient for court.",
    "Do not invent facts, prices, laws, party names, certifications, or obligations not supplied by the user.",
    "Return only valid JSON with exactly this shape: {\"options\":[\"option 1\",\"option 2\",\"option 3\",\"option 4\"]}.",
    "Provide exactly four distinct, concise, editable draft clauses.",
    `SLA section: ${section}`,
    `User's plain-English answer: ${answer}`,
    `Context: ${context || "No additional context."}`,
  ].join("\n\n");

  const response = await fetch(process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "gemma3:4b",
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.35 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Local AI provider returned ${response.status}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(data.response || "{}");
  return cleanOptions(parsed.options);
}

router.get("/sections", requireRole("SUPER_ADMIN", "ORG_ADMIN", "DIRECTOR", "ORG_STAFF"), (req, res) => {
  const sections = Object.entries(SECTION_GUIDES).map(([id, guide]) => ({
    id,
    title: guide.title,
    question: guide.question,
  }));
  return res.json(sections);
});

router.post("/draft", requireRole("SUPER_ADMIN", "ORG_ADMIN"), async (req, res) => {
  const section = String(req.body?.section || "").trim();
  const answer = String(req.body?.answer || "").trim();
  const context = String(req.body?.context || "").trim().slice(0, 4000);
  const guide = getGuide(section);

  if (!guide) return res.status(400).json({ error: "Choose a valid SLA section" });
  if (answer.length < 8) return res.status(400).json({ error: "Describe what you need in a little more detail before generating drafts" });

  let options = [];
  let mode = "guided";
  const provider = String(process.env.AI_PROVIDER || "guided").trim().toLowerCase();

  if (provider === "ollama") {
    try {
      options = await generateWithOllama({ section: guide.title, answer, context });
      mode = "local_ai";
    } catch (error) {
      console.error("SLA LOCAL AI DRAFT ERROR:", error.message);
    }
  } else if (provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      options = await generateWithOpenAi({ section: guide.title, answer, context });
      mode = "ai";
    } catch (error) {
      console.error("SLA AI DRAFT ERROR:", error.message);
    }
  }

  if (options.length < 4) options = fallbackOptions(section, answer);
  return res.json({
    mode,
    section,
    title: guide.title,
    question: guide.question,
    disclaimer: "These are editable draft suggestions, not legal advice. Both organizations should review the selected wording before approval.",
    options,
  });
});

module.exports = router;
