import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchPartnerships } from "../../api/partnerships";
import { createSlaAgreement, fetchSlaAgreement, saveSlaPolicy, submitSlaAgreement, updateSlaAgreement } from "../../api/slaAgreements";
import PageHeader from "../../components/layout/PageHeader";
import SlaDraftingAssistant from "../../components/sla/SlaDraftingAssistant";
import { useAuth } from "../../context/AuthContext";

const PRIORITIES = [
  { level: 1, label: "Critical", help: "Essential service is unavailable", response: "60", resolution: "240" },
  { level: 2, label: "High", help: "Major service degradation", response: "120", resolution: "480" },
  { level: 3, label: "Normal", help: "Standard request or non-critical issue", response: "240", resolution: "1440" },
];

function nextReviewDate(months) {
  const value = new Date();
  value.setMonth(value.getMonth() + Number(months || 12));
  return value.toISOString().slice(0, 10);
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

export default function NewSlaAgreementPage() {
  const [params] = useSearchParams();
  const { agreementId } = useParams();
  const partnershipId = params.get("partnershipId");
  const navigate = useNavigate();
  const { user } = useAuth();
  const [partnership, setPartnership] = useState(null);
  const [existingAgreement, setExistingAgreement] = useState(null);
  const [form, setForm] = useState({
    name: "", effective_date: new Date().toISOString().slice(0, 10), end_date: "",
    renewal_type: "ONGOING", notice_period_days: "30", review_interval_months: "12",
    document_owner_name: user?.full_name || "", services_in_scope: "", services_excluded: "",
    client_responsibilities: "", contractor_responsibilities: "", service_assumptions: "",
    support_hours: "Monday to Friday, 8:00 AM to 5:00 PM", support_channels: "Platform ticket portal and email",
    payment_terms: "", governing_law: "Kenya", legal_terms: "",
    targets: Object.fromEntries(PRIORITIES.map((item) => [item.level, { response: item.response, resolution: item.resolution }])),
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantRef = useRef(null);
  const dragState = useRef(null);
  const dragged = useRef(false);
  const [assistantPosition, setAssistantPosition] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem("contractorlink-sla-ai-position")) || { left: 28, bottom: 24 }; }
    catch { return { left: 28, bottom: 24 }; }
  });
  const assistantPositionRef = useRef(assistantPosition);
  const steps = ["Partnership", "Scope", "Service levels", "Terms", "Review"];

  useEffect(() => {
    async function load() {
      try {
        if (agreementId) {
          const data = await fetchSlaAgreement(agreementId);
          const agreement = data.agreement;
          if (!["DRAFT", "REJECTED"].includes(agreement.status)) throw new Error("Only draft or rejected agreements can be revised.");
          if (String(agreement.client_organization_id) !== String(user?.organization_id)) throw new Error("Only the client organization can revise this agreement.");
          const targets = Object.fromEntries(PRIORITIES.map((priority) => {
            const saved = data.policies.find((policy) => Number(policy.priority_level) === priority.level);
            return [priority.level, { response: String(saved?.target_response_minutes || priority.response), resolution: String(saved?.target_resolution_minutes || priority.resolution) }];
          }));
          setExistingAgreement(agreement);
          setPartnership({
            id: agreement.partnership_id,
            client_organization_id: agreement.client_organization_id,
            contractor_organization_id: agreement.contractor_organization_id,
            client_organization_name: agreement.client_organization_name,
            contractor_organization_name: agreement.contractor_organization_name,
          });
          setForm({
            name: agreement.agreement_name || "", effective_date: new Date().toISOString().slice(0, 10), end_date: dateInputValue(agreement.end_date),
            renewal_type: agreement.renewal_type || "ONGOING", notice_period_days: String(agreement.notice_period_days ?? 30), review_interval_months: String(agreement.review_interval_months ?? 12),
            document_owner_name: agreement.document_owner_name || user?.full_name || "", services_in_scope: agreement.services_in_scope || agreement.description || "", services_excluded: agreement.services_excluded || "",
            client_responsibilities: agreement.client_responsibilities || "", contractor_responsibilities: agreement.contractor_responsibilities || "", service_assumptions: agreement.service_assumptions || "",
            support_hours: agreement.support_hours || "", support_channels: agreement.support_channels || "",
            payment_terms: agreement.payment_terms || "", governing_law: agreement.governing_law || "Kenya", legal_terms: agreement.legal_terms || "", targets,
          });
          return;
        }
        const partnerships = await fetchPartnerships();
        const current = partnerships.find((item) => String(item.id) === String(partnershipId));
        if (!current || current.status !== "ACTIVE") throw new Error("Choose an active partnership before drafting an SLA.");
        if (String(current.client_organization_id) !== String(user?.organization_id)) throw new Error("Only the client organization can draft the first SLA.");
        setPartnership(current);
        setForm((value) => ({ ...value, name: `${current.client_organization_name} - ${current.contractor_organization_name} Service Agreement` }));
      } catch (err) {
        setError(err.response?.data?.error || err.message || "Unable to prepare SLA agreement.");
      } finally { setIsLoading(false); }
    }
    load();
  }, [agreementId, partnershipId, user?.organization_id]);

  useEffect(() => {
    if (!assistantOpen) return undefined;
    function closeOnOutsideClick(event) {
      if (assistantRef.current && !assistantRef.current.contains(event.target)) setAssistantOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [assistantOpen]);

  useEffect(() => {
    assistantPositionRef.current = assistantPosition;
    window.localStorage.setItem("contractorlink-sla-ai-position", JSON.stringify(assistantPosition));
  }, [assistantPosition]);

  function startAssistantDrag(event) {
    if (event.button !== 0) return;
    dragged.current = false;
    const position = assistantPositionRef.current;
    dragState.current = { startX: event.clientX, startY: event.clientY, left: position.left, bottom: position.bottom };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveAssistantDrag(event) {
    if (!dragState.current) return;
    const deltaX = event.clientX - dragState.current.startX;
    const deltaY = event.clientY - dragState.current.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) dragged.current = true;
    const left = Math.min(Math.max(12, dragState.current.left + deltaX), Math.max(12, window.innerWidth - 180));
    const bottom = Math.min(Math.max(12, dragState.current.bottom - deltaY), Math.max(12, window.innerHeight - 70));
    const position = { left, bottom };
    assistantPositionRef.current = position;
    // Update the floating element directly while dragging to avoid rerendering the full form every pixel.
    if (assistantRef.current) {
      assistantRef.current.style.left = `${left}px`;
      assistantRef.current.style.bottom = `${bottom}px`;
    }
    event.preventDefault();
  }
  function endAssistantDrag() {
    if (!dragState.current) return;
    dragState.current = null;
    setAssistantPosition(assistantPositionRef.current);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateTarget(level, field, value) {
    setForm((current) => ({ ...current, targets: { ...current.targets, [level]: { ...current.targets[level], [field]: value } } }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const payload = {
        client_organization_id: partnership.client_organization_id,
        contractor_organization_id: partnership.contractor_organization_id,
        partnership_id: partnership.id,
        agreement_name: form.name,
        description: form.services_in_scope,
        agreement_version: "1.0",
        effective_date: form.effective_date,
        end_date: form.end_date,
        renewal_type: form.renewal_type,
        notice_period_days: form.notice_period_days,
        review_interval_months: form.review_interval_months,
        next_review_date: nextReviewDate(form.review_interval_months),
        document_owner_name: form.document_owner_name,
        services_in_scope: form.services_in_scope,
        services_excluded: form.services_excluded,
        client_responsibilities: form.client_responsibilities,
        contractor_responsibilities: form.contractor_responsibilities,
        service_assumptions: form.service_assumptions,
        support_hours: form.support_hours,
        support_channels: form.support_channels,
        payment_terms: form.payment_terms,
        governing_law: form.governing_law,
        legal_terms: form.legal_terms,
      };
      const created = existingAgreement
        ? await updateSlaAgreement(existingAgreement.id, payload)
        : await createSlaAgreement(payload);
      await Promise.all(PRIORITIES.map((priority) => saveSlaPolicy(created.id, {
        priority_level: priority.level,
        target_response_minutes: Number(form.targets[priority.level].response),
        target_resolution_minutes: Number(form.targets[priority.level].resolution),
        is_active: true,
      })));
      await submitSlaAgreement(created.id);
      navigate(`/sla-agreements/${created.id}`);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save SLA agreement.");
    } finally { setIsSubmitting(false); }
  }

  if (isLoading) return <div className="panel">Preparing agreement workspace...</div>;
  if (error && !partnership) return <div className="panel form-error">{error}</div>;

  return <section className="stack-lg">
    <PageHeader eyebrow="Service agreement and SLA" title={existingAgreement ? "Revise agreement" : "Create a guided agreement"} description={existingAgreement ? `Address the contractor's review note, then resubmit the revised terms to ${partnership.contractor_organization_name}.` : `Complete the terms for ${partnership.client_organization_name} and ${partnership.contractor_organization_name}. The contractor reviews every section before approval.`} actions={<Link to={existingAgreement ? `/sla-agreements/${existingAgreement.id}` : "/partnerships"} className="button button-secondary">{existingAgreement ? "Back to agreement" : "Back to partnerships"}</Link>} />
    {existingAgreement?.contractor_review_note ? <section className="panel request-note"><span>Contractor revision note</span><p>{existingAgreement.contractor_review_note}</p></section> : null}
    <form className="stack-lg sla-wizard" onSubmit={submit}>
      <nav className="sla-stepper" aria-label="Agreement creation progress">{steps.map((label, index) => <button type="button" key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} onClick={() => index + 1 < step && setStep(index + 1)}><span>{step > index + 1 ? "OK" : index + 1}</span><b>{label}</b></button>)}</nav>
      {step === 1 ? <section className="panel stack-md agreement-form-section">
        <div><span className="eyebrow">1. Agreement overview</span><h3>Who is agreeing, and for how long?</h3><p className="section-copy">Set a clear name, ownership, effective date, term, and review cycle.</p></div>
        <div className="form-grid">
          <label className="field"><span>Agreement name</span><input value={form.name} onChange={(event) => updateField("name", event.target.value)} required /></label>
          <label className="field"><span>Document owner</span><input value={form.document_owner_name} onChange={(event) => updateField("document_owner_name", event.target.value)} placeholder="Write the name of the person who will look after this agreement." required /></label>
          <div className="agreement-parties"><span>Client</span><strong>{partnership.client_organization_name}</strong><span>Service provider</span><strong>{partnership.contractor_organization_name}</strong></div>
          <label className="field"><span>Effective date</span><input type="date" value={form.effective_date} onChange={(event) => updateField("effective_date", event.target.value)} required /></label>
          <label className="field"><span>Agreement term</span><select value={form.renewal_type} onChange={(event) => updateField("renewal_type", event.target.value)}><option value="ONGOING">Ongoing until notice</option><option value="FIXED_TERM">Fixed-term contract</option><option value="AUTO_RENEW">Fixed term with automatic renewal</option></select></label>
          {form.renewal_type !== "ONGOING" ? <label className="field"><span>End date</span><input type="date" value={form.end_date} onChange={(event) => updateField("end_date", event.target.value)} required /></label> : null}
          <label className="field"><span>Termination notice (days)</span><input type="number" min="0" value={form.notice_period_days} onChange={(event) => updateField("notice_period_days", event.target.value)} /></label>
          <label className="field"><span>Review frequency (months)</span><input type="number" min="1" value={form.review_interval_months} onChange={(event) => updateField("review_interval_months", event.target.value)} required /></label>
        </div>
      </section> : null}

      {step === 2 ? <section className="panel stack-md agreement-form-section">
        <div><span className="eyebrow">2. Services and responsibilities</span><h3>Define the work clearly</h3><p className="section-copy">State what is included and excluded so later tickets are easy to classify and enforce.</p></div>
        <label className="field"><span>Services in scope</span><textarea rows="5" value={form.services_in_scope} onChange={(event) => updateField("services_in_scope", event.target.value)} placeholder="Write the work the provider WILL do for the client. Keep it clear and list each service." required /></label>
        <label className="field"><span>Services excluded</span><textarea rows="3" value={form.services_excluded} onChange={(event) => updateField("services_excluded", event.target.value)} placeholder="Write the work the provider will NOT do under this agreement. Leave blank only if nothing is excluded." /></label>
        <div className="form-grid"><label className="field"><span>Client responsibilities</span><textarea rows="5" value={form.client_responsibilities} onChange={(event) => updateField("client_responsibilities", event.target.value)} placeholder="Write what the client must do to help the work happen, such as giving information, access, approval, or payment." required /></label><label className="field"><span>Provider responsibilities</span><textarea rows="5" value={form.contractor_responsibilities} onChange={(event) => updateField("contractor_responsibilities", event.target.value)} placeholder="Write what the provider promises to do, such as doing the work well, giving updates, and replying on time." required /></label></div>
        <label className="field"><span>Service assumptions</span><textarea rows="3" value={form.service_assumptions} onChange={(event) => updateField("service_assumptions", event.target.value)} placeholder="Write anything that must already be true before work can start, such as site access, electricity, or correct information." /></label>
      </section> : null}

      {step === 3 ? <section className="panel stack-md agreement-form-section">
        <div><span className="eyebrow">3. Service management and targets</span><h3>Set measurable expectations</h3><p className="section-copy">These become the rules ContractorLink uses when tickets are created under this agreement.</p></div>
        <div className="form-grid"><label className="field"><span>Support hours and availability</span><textarea rows="3" value={form.support_hours} onChange={(event) => updateField("support_hours", event.target.value)} required /></label><label className="field"><span>Approved service channels</span><textarea rows="3" value={form.support_channels} onChange={(event) => updateField("support_channels", event.target.value)} required /></label></div>
        <div className="priority-targets">{PRIORITIES.map((priority) => <div className="priority-target priority-target-wide" key={priority.level}><div><strong>{priority.label}</strong><span>{priority.help}</span></div><label className="target-input"><span>Respond</span><input type="number" min="1" value={form.targets[priority.level].response} onChange={(event) => updateTarget(priority.level, "response", event.target.value)} required /><em>minutes</em></label><label className="target-input"><span>Resolve</span><input type="number" min="1" value={form.targets[priority.level].resolution} onChange={(event) => updateTarget(priority.level, "resolution", event.target.value)} required /><em>minutes</em></label></div>)}</div>
      </section> : null}

      {step === 4 ? <section className="panel stack-md agreement-form-section">
        <div><span className="eyebrow">4. Optional commercial and legal terms</span><h3>Record additional contract terms</h3><p className="section-copy">Use legal review for financial or legal clauses. ContractorLink records the terms but does not replace legal advice.</p></div>
        <div className="form-grid"><label className="field"><span>Payment terms or reference</span><textarea rows="4" value={form.payment_terms} onChange={(event) => updateField("payment_terms", event.target.value)} placeholder="Optional: write how and when the client will pay, or say where the separate payment agreement can be found." /></label><label className="field"><span>Governing law</span><input value={form.governing_law} onChange={(event) => updateField("governing_law", event.target.value)} placeholder="Write the country whose laws apply to this agreement." /></label></div>
        <label className="field"><span>Additional legal terms</span><textarea rows="4" value={form.legal_terms} onChange={(event) => updateField("legal_terms", event.target.value)} placeholder="Optional: write any other important rule both sides agreed to. Ask a lawyer for legal advice when needed." /></label>
      </section> : null}

      {error ? <div className="panel form-error">{error}</div> : null}
      {step === 5 ? <section className="panel agreement-submit-panel"><div><span className="eyebrow">Final review</span><h3>{existingAgreement ? "Resubmit the revised agreement" : "Send the agreement to the contractor"}</h3><p>Check the agreement name, service scope, targets, escalation-ready contacts, and any commercial terms. The contractor reviews the complete agreement before it becomes active.</p><div className="sla-review-list"><span><b>Agreement</b>{form.name || "Not named"}</span><span><b>Scope</b>{form.services_in_scope ? "Added" : "Still required"}</span><span><b>Service targets</b>{PRIORITIES.length} priority levels ready</span></div></div><button className="button button-primary" disabled={isSubmitting}>{isSubmitting ? "Submitting agreement..." : existingAgreement ? "Resubmit revised agreement" : "Submit to contractor for approval"}</button></section> : null}
      <div className="sla-wizard-actions"><button type="button" className="button button-secondary" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>Back</button>{step < steps.length ? <button type="button" className="button button-primary" onClick={() => setStep((current) => current + 1)}>Continue to {steps[step]}</button> : null}</div>
    </form>
    <div className="sla-ai-float" ref={assistantRef} style={{ left: assistantPosition.left, bottom: assistantPosition.bottom }}>{assistantOpen ? <div className="sla-ai-popover"><button type="button" className="sla-ai-close" onClick={() => setAssistantOpen(false)} aria-label="Close drafting assistant">x</button><SlaDraftingAssistant form={form} onUseDraft={(field, draft) => updateField(field, draft)} /></div> : null}<button type="button" className="sla-ai-button" onPointerDown={startAssistantDrag} onPointerMove={moveAssistantDrag} onPointerUp={endAssistantDrag} onPointerCancel={endAssistantDrag} onClick={() => { if (!dragged.current) setAssistantOpen((open) => !open); }} aria-expanded={assistantOpen}>AI drafting help</button></div>
  </section>;
}
