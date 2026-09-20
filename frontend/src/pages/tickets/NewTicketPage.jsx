import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSlaAgreements } from "../../api/slaAgreements";
import { createTicket, fetchTicket, fetchTicketAssignmentOptions } from "../../api/tickets";
import PageHeader from "../../components/layout/PageHeader";

export default function NewTicketPage() {
  const [agreements, setAgreements] = useState([]); const [options, setOptions] = useState({ departments: [], users: [] });
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [createdTicket, setCreatedTicket] = useState(null); const [prediction, setPrediction] = useState(null); const [assessmentFinished, setAssessmentFinished] = useState(false);
  const [form, setForm] = useState({ sla_agreement_id: "", title: "", description: "", location: "", priority_level: 1, assignment_scope: "ORGANIZATION", assigned_department_id: "", assigned_user_id: "" });
  useEffect(() => { fetchSlaAgreements().then((data) => setAgreements(data.filter((item) => item.status === "ACTIVE"))).catch(() => setError("Unable to load active SLA agreements.")); }, []);
  useEffect(() => {
    if (!createdTicket || prediction != null || assessmentFinished) return undefined;
    let attempts = 0;
    const checkPrediction = async () => {
      try {
        const ticket = await fetchTicket(createdTicket.id);
        if (ticket.predicted_breach_risk != null) {
          setPrediction(ticket);
          return;
        }
      } catch {
        // The ticket has already been created; keep the assessment non-blocking.
      }
      attempts += 1;
      if (attempts >= 12) setAssessmentFinished(true);
    };
    checkPrediction();
    const timer = window.setInterval(checkPrediction, 2000);
    return () => window.clearInterval(timer);
  }, [createdTicket, prediction, assessmentFinished]);
  const agreement = agreements.find((item) => item.id === form.sla_agreement_id);
  async function chooseAgreement(id) { setForm((current) => ({ ...current, sla_agreement_id: id, assigned_department_id: "", assigned_user_id: "" })); setOptions({ departments: [], users: [] }); const selected = agreements.find((item) => item.id === id); if (!selected) return; try { setOptions(await fetchTicketAssignmentOptions({ organization_id: selected.contractor_organization_id, sla_agreement_id: id })); } catch (err) { setError(err.response?.data?.error || "Unable to load the contractor assignment options."); } }
  async function submit(event) { event.preventDefault(); if (!agreement) return setError("Choose an active SLA agreement first."); setSaving(true); setError(""); try { const result = await createTicket({ ...form, assigned_organization_id: agreement.contractor_organization_id, assigned_department_id: form.assigned_department_id || null, assigned_user_id: form.assigned_user_id || null }); setCreatedTicket(result.ticket); } catch (err) { setError(err.response?.data?.error || "Unable to create ticket."); } finally { setSaving(false); } }
  const users = options.users.filter((user) => user.department_id === form.assigned_department_id);
  if (createdTicket) return <section className="stack-lg"><PageHeader eyebrow="Ticket created" title="Work request sent" description={`${createdTicket.ticket_number} is now assigned and follows the selected SLA.`} /><section className="panel ticket-assessment"><span className="eyebrow">ML breach assessment</span>{prediction ? <><h2>{Math.round(Number(prediction.predicted_breach_risk) * 100)}% predicted breach risk</h2><p>The model has reviewed the ticket details. This is an advisory score, not a decision; the SLA remains the rule for the work.</p><div className="ticket-assessment-actions"><Link className="button" to={`/tickets/${createdTicket.id}`}>Open ticket and full prediction</Link><Link className="button button-secondary" to="/tickets">Back to tickets</Link></div></> : <><h2>{assessmentFinished ? "Assessment is still running" : "Assessing ticket risk..."}</h2><p>{assessmentFinished ? "The ticket is already active. Open it anytime; the score will appear there when the background assessment finishes." : "Your ticket has already been created. ContractorLink is calculating an advisory breach-risk score in the background."}</p><div className="ticket-assessment-actions"><Link className="button" to={`/tickets/${createdTicket.id}`}>Open ticket</Link><Link className="button button-secondary" to="/tickets">Back to tickets</Link></div></>}</section></section>;
  return <section className="stack-lg"><PageHeader eyebrow="New work request" title="Create ticket" description="The SLA determines the response, resolution, breach, and escalation rules. Choose who should receive this work." />
    <form className="panel stack-md ticket-form" onSubmit={submit}><label className="field"><span>Active SLA agreement</span><select required value={form.sla_agreement_id} onChange={(e) => chooseAgreement(e.target.value)}><option value="">Choose an agreement</option>{agreements.map((item) => <option key={item.id} value={item.id}>{item.agreement_name} - {item.contractor_organization_name}</option>)}</select></label>
      <div className="form-grid"><label>Ticket title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short statement of the work needed" /></label><label>Priority<select value={form.priority_level} onChange={(e) => setForm({ ...form, priority_level: Number(e.target.value) })}><option value={1}>★ Normal</option><option value={2}>★★ Medium</option><option value={3}>★★★ High</option></select></label></div>
      <label>Short description<textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Explain what is needed, location, urgency, and any useful context." /></label><label>Location (optional)<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
      <fieldset className="assignment-fieldset"><legend>Assign within {agreement?.contractor_organization_name || "the contractor organization"}</legend><label><input type="radio" checked={form.assignment_scope === "ORGANIZATION"} onChange={() => setForm({ ...form, assignment_scope: "ORGANIZATION", assigned_department_id: "", assigned_user_id: "" })} /> Whole organization</label><label><input type="radio" checked={form.assignment_scope === "DEPARTMENT"} onChange={() => setForm({ ...form, assignment_scope: "DEPARTMENT", assigned_user_id: "" })} /> Department</label><label><input type="radio" checked={form.assignment_scope === "USER"} onChange={() => setForm({ ...form, assignment_scope: "USER" })} /> Specific person</label>{form.assignment_scope !== "ORGANIZATION" ? <label>Department<select required value={form.assigned_department_id} onChange={(e) => setForm({ ...form, assigned_department_id: e.target.value, assigned_user_id: "" })}><option value="">Choose department</option>{options.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}{form.assignment_scope === "USER" ? <label>Person<select required value={form.assigned_user_id} onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}><option value="">Choose person</option>{users.map((item) => <option key={item.id} value={item.id}>{item.full_name}{item.is_department_admin ? " (department admin)" : ""}</option>)}</select></label> : null}</fieldset>
      {error ? <div className="form-error">{error}</div> : null}<button className="button" disabled={saving}>{saving ? "Creating..." : "Create ticket"}</button></form></section>;
}
