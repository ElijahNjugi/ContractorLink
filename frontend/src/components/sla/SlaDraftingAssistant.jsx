import { useState } from "react";
import { draftSlaClause } from "../../api/slaDraftingAssistant";

const SECTIONS = [
  { id: "skip", title: "No help needed right now", question: "" },
  { id: "services_in_scope", title: "Services in scope", question: "What work does the client need the provider to deliver?" },
  { id: "services_excluded", title: "Services excluded", question: "What should not be included unless both parties separately agree?" },
  { id: "client_responsibilities", title: "Client responsibilities", question: "What must the client provide or do for the work to succeed?" },
  { id: "contractor_responsibilities", title: "Provider responsibilities", question: "What service standard and communication should the provider commit to?" },
  { id: "service_assumptions", title: "Service assumptions", question: "What conditions do both parties assume will be in place?" },
  { id: "support_hours", title: "Support hours", question: "When is service available and what happens outside those hours?" },
  { id: "support_channels", title: "Service channels", question: "Which channels should both organizations use for tickets and escalation?" },
];

export default function SlaDraftingAssistant({ form, onUseDraft }) {
  const [section, setSection] = useState("skip");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const selected = SECTIONS.find((item) => item.id === section) || SECTIONS[0];

  async function generate() {
    setError("");
    setIsLoading(true);
    try {
      const context = [
        `Existing agreement scope: ${form.services_in_scope || "Not drafted yet"}`,
        `Client responsibilities: ${form.client_responsibilities || "Not drafted yet"}`,
        `Provider responsibilities: ${form.contractor_responsibilities || "Not drafted yet"}`,
      ].join("\n");
      setResult(await draftSlaClause({ section, answer, context }));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to generate SLA drafts right now.");
    } finally {
      setIsLoading(false);
    }
  }

  function changeSection(value) {
    setSection(value);
    setAnswer("");
    setResult(null);
    setError("");
  }

  if (section === "skip") {
    return <section className="panel sla-assistant sla-assistant-optional">
      <div className="sla-assistant-header">
        <div>
          <span className="eyebrow">Guided SLA drafting</span>
          <h3>Need help writing a clause?</h3>
          <p className="section-copy">This assistant is optional. You can fill the agreement yourself, or select a section below whenever you want four draft suggestions.</p>
        </div>
        <span className="assistant-badge">Optional</span>
      </div>
      <label className="field"><span>Which part would you like help with?</span><select value={section} onChange={(event) => changeSection(event.target.value)}>{SECTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    </section>;
  }

  return <section className="panel sla-assistant">
    <div className="sla-assistant-header">
      <div>
        <span className="eyebrow">Guided SLA drafting</span>
        <h3>Tell the assistant what you need in plain English</h3>
        <p className="section-copy">It turns your answer into four editable draft clauses. Nothing is added to the agreement until you choose an option.</p>
      </div>
      <span className="assistant-badge">Draft support</span>
    </div>
    <div className="stack-md">
      <label className="field"><span>Which part would you like help with?</span><select value={section} onChange={(event) => changeSection(event.target.value)}>{SECTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="assistant-question"><span>Assistant asks</span><strong>{selected.question}</strong><p>Write naturally. Include what the client needs, any limits, the location, timing, or expectations that matter.</p></div>
      <label className="field"><span>Your answer</span><textarea rows="4" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Example: We need the provider to transport office equipment between Nairobi and Nakuru, pack fragile items, and confirm delivery." required /></label>
      <div className="card-actions"><button type="button" className="button button-primary" onClick={generate} disabled={isLoading}>{isLoading ? "Preparing options..." : "Give me four draft options"}</button>{result ? <button type="button" className="button button-secondary" onClick={() => { setResult(null); setAnswer(""); }}>Ask about another section</button> : null}</div>
    </div>
    {error ? <p className="form-error">{error}</p> : null}
    {result ? <div className="assistant-results"><div className="assistant-results-heading"><div><span className="eyebrow">{result.mode === "ai" ? "AI-assisted options" : result.mode === "local_ai" ? "Private local AI options" : "Guided draft options"}</span><h4>Choose, edit, and apply one</h4></div><p>{result.disclaimer}</p></div><div className="assistant-options">{result.options.map((option, index) => <article className="assistant-option" key={`${result.section}-${index}`}><span>Option {index + 1}</span><p>{option}</p><button type="button" className="button button-secondary button-small" onClick={() => onUseDraft(result.section, option)}>Use this draft</button></article>)}</div></div> : null}
  </section>;
}
