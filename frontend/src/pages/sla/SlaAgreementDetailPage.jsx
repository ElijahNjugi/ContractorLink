import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { decideSlaAgreement, fetchSlaAgreement, revokeSlaAgreement } from "../../api/slaAgreements";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../context/AuthContext";
import { downloadSlaAgreementPdf } from "../../utils/slaPdf";

const priorityNames = { 1: "Critical", 2: "High", 3: "Normal" };
function label(value) { return String(value || "DRAFT").toLowerCase().replace(/_/g, " "); }
function time(minutes) { const value = Number(minutes || 0); return value >= 1440 ? `${value / 1440} day${value === 1440 ? "" : "s"}` : value >= 60 ? `${value / 60} hour${value === 60 ? "" : "s"}` : `${value} minutes`; }
function date(value) {
  const normalized = value ? String(value).slice(0, 10) : "";
  return normalized ? new Date(`${normalized}T00:00:00`).toLocaleDateString() : "Not specified";
}
function Section({ eyebrow, title, children }) { return <article className="panel stack-md"><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div>{children}</article>; }
function Value({ label: title, value }) { return <div className="agreement-value"><span>{title}</span><p>{value || "Not specified"}</p></div>; }

export default function SlaAgreementDetailPage() {
  const { agreementId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revocationReason, setRevocationReason] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);
  const [contractorTerms, setContractorTerms] = useState({ contractor_payment_terms: "", breach_remedies: "", contractor_job_contact_name: "", contractor_job_contact_email: "", contractor_job_contact_phone: "", escalation_30m_emails: "", escalation_15m_emails: "", escalation_breach_emails: "" });

  async function load() {
    try { setData(await fetchSlaAgreement(agreementId)); } catch (err) { setError(err.response?.data?.error || "Unable to load SLA agreement."); }
  }
  useEffect(() => { load(); }, [agreementId]);

  async function decide(decision) {
    const deliveryEmail = contractorTerms.contractor_job_contact_email.trim();
    const approvalTerms = decision === "APPROVE"
      ? {
          ...contractorTerms,
          escalation_30m_emails: contractorTerms.escalation_30m_emails.trim() || deliveryEmail,
          escalation_15m_emails: contractorTerms.escalation_15m_emails.trim() || deliveryEmail,
          escalation_breach_emails: contractorTerms.escalation_breach_emails.trim() || deliveryEmail,
        }
      : contractorTerms;
    if (decision === "APPROVE" && (!contractorTerms.contractor_payment_terms.trim() || !contractorTerms.breach_remedies.trim() || !contractorTerms.contractor_job_contact_name.trim() || !deliveryEmail)) {
      setError("Complete payment terms, breach remedies, and the delivery contact before approving.");
      return;
    }
    setError(""); setIsSubmitting(true);
    try { await decideSlaAgreement(agreementId, { decision, review_note: reviewNote, ...approvalTerms }); await load(); }
    catch (err) { setError(err.response?.data?.error || "Unable to record SLA decision."); }
    finally { setIsSubmitting(false); }
  }

  async function revoke() {
    setError(""); setIsRevoking(true);
    try { await revokeSlaAgreement(agreementId, { reason: revocationReason }); await load(); }
    catch (err) { setError(err.response?.data?.error || "Unable to revoke SLA agreement."); }
    finally { setIsRevoking(false); }
  }

  if (!data) return <div className={error ? "panel form-error" : "panel"}>{error || "Loading SLA agreement..."}</div>;
  const { agreement, policies } = data;
  const isSuperAdmin = String(user?.role_code || "").toUpperCase() === "SUPER_ADMIN";
  const isContractorAdmin = String(user?.role_code || "").toUpperCase() === "ORG_ADMIN" && String(user?.organization_id) === String(agreement.contractor_organization_id);
  const isClientAdmin = String(user?.role_code || "").toUpperCase() === "ORG_ADMIN" && String(user?.organization_id) === String(agreement.client_organization_id);
  const mayDecide = isContractorAdmin && agreement.status === "PENDING_APPROVAL";
  const mayRevise = isClientAdmin && ["DRAFT", "REJECTED"].includes(agreement.status);

  return <section className="stack-lg">
    <PageHeader eyebrow={`Service agreement and SLA · v${agreement.agreement_version || "1.0"}`} title={agreement.agreement_name} description={`${agreement.client_organization_name} and ${agreement.contractor_organization_name}`} actions={<div className="card-actions">{["ACTIVE", "REVOKED"].includes(agreement.status) ? <button type="button" className="button button-secondary" onClick={() => downloadSlaAgreementPdf(data)}>Download PDF</button> : null}<Link to="/sla-agreements" className="button button-secondary">Back to agreements</Link></div>} />
    <article className="panel agreement-overview"><div><span className={`status-pill status-${String(agreement.status).toLowerCase().replace(/_/g, "-")}`}>{label(agreement.status)}</span><h3>Agreement status</h3><p>{agreement.status === "ACTIVE" ? "This SLA is active. Tickets will follow these agreed service targets." : agreement.status === "PENDING_APPROVAL" ? "The contractor must review the complete agreement before work begins." : "This agreement is being prepared or revised."}</p></div><div className="agreement-overview-meta"><div><span className="detail-label">Document owner</span><strong>{agreement.document_owner_name || agreement.created_by_name || "Client organization"}</strong></div><div><span className="detail-label">Next review</span><strong>{date(agreement.next_review_date)}</strong></div></div></article>
    <div className="split-layout agreement-detail-layout"><div className="stack-lg">
      <Section eyebrow="1. Agreement overview" title="Term and review"><div className="agreement-value-grid"><Value label="Effective date" value={date(agreement.effective_date)} /><Value label="Term" value={label(agreement.renewal_type)} /><Value label="End date" value={date(agreement.end_date)} /><Value label="Notice period" value={agreement.notice_period_days == null ? null : `${agreement.notice_period_days} days`} /><Value label="Review frequency" value={agreement.review_interval_months == null ? null : `${agreement.review_interval_months} months`} /></div></Section>
      <Section eyebrow="2. Service agreement" title="Scope and responsibilities"><Value label="Services in scope" value={agreement.services_in_scope || agreement.description} /><Value label="Services excluded" value={agreement.services_excluded} /><div className="form-grid"><Value label="Client responsibilities" value={agreement.client_responsibilities} /><Value label="Provider responsibilities" value={agreement.contractor_responsibilities} /></div><Value label="Service assumptions" value={agreement.service_assumptions} /></Section>
      <Section eyebrow="3. Service management" title="Availability and service targets"><div className="form-grid"><Value label="Support hours and availability" value={agreement.support_hours} /><Value label="Approved service channels" value={agreement.support_channels} /></div><div className="target-summary">{policies.map((policy) => <div key={policy.id}><span>{priorityNames[policy.priority_level]}</span><strong>Respond: {time(policy.target_response_minutes)} · Resolve: {time(policy.target_resolution_minutes)}</strong></div>)}</div></Section>
      <Section eyebrow="4. Additional terms" title="Commercial and legal reference"><Value label="Client payment terms" value={agreement.payment_terms} /><Value label="Provider payment terms" value={agreement.contractor_payment_terms} /><Value label="Breach remedies or service credits" value={agreement.breach_remedies} /><Value label="Governing law" value={agreement.governing_law} /><Value label="Additional legal terms" value={agreement.legal_terms} /></Section>
      <Section eyebrow="5. Delivery and escalation" title="Operational contacts"><div className="form-grid"><Value label="Provider delivery contact" value={agreement.contractor_job_contact_name ? `${agreement.contractor_job_contact_name} · ${agreement.contractor_job_contact_email || ""}` : null} /><Value label="30-minute warning recipients" value={agreement.escalation_30m_emails} /><Value label="15-minute warning recipients" value={agreement.escalation_15m_emails} /><Value label="Breach-time recipients" value={agreement.escalation_breach_emails} /></div></Section>
    </div><aside className="panel agreement-decision-card stack-md">{mayDecide ? <><span className="eyebrow">Contractor operational terms</span><h3>Complete your side before approval</h3><p className="section-copy">These details become part of the agreed SLA and drive automatic breach emails.</p><label className="field"><span>Provider payment terms</span><textarea rows="3" required value={contractorTerms.contractor_payment_terms} onChange={(e) => setContractorTerms({ ...contractorTerms, contractor_payment_terms: e.target.value })} placeholder="Invoice schedule, payment method, or reference to the commercial contract." /></label><label className="field"><span>Breach remedies or consequences</span><textarea rows="3" required value={contractorTerms.breach_remedies} onChange={(e) => setContractorTerms({ ...contractorTerms, breach_remedies: e.target.value })} placeholder="Service credit, corrective action, escalation, or other agreed remedy." /></label><label className="field"><span>Delivery contact name</span><input required value={contractorTerms.contractor_job_contact_name} onChange={(e) => setContractorTerms({ ...contractorTerms, contractor_job_contact_name: e.target.value })} /></label><div className="form-grid"><label className="field"><span>Delivery contact email</span><input type="email" required value={contractorTerms.contractor_job_contact_email} onChange={(e) => setContractorTerms({ ...contractorTerms, contractor_job_contact_email: e.target.value })} /></label><label className="field"><span>Phone</span><input value={contractorTerms.contractor_job_contact_phone} onChange={(e) => setContractorTerms({ ...contractorTerms, contractor_job_contact_phone: e.target.value })} /></label></div><label className="field"><span>30-minute warning emails</span><textarea required rows="2" value={contractorTerms.escalation_30m_emails} onChange={(e) => setContractorTerms({ ...contractorTerms, escalation_30m_emails: e.target.value })} placeholder="Separate multiple email addresses with commas." /></label><label className="field"><span>15-minute warning emails</span><textarea required rows="2" value={contractorTerms.escalation_15m_emails} onChange={(e) => setContractorTerms({ ...contractorTerms, escalation_15m_emails: e.target.value })} placeholder="Separate multiple email addresses with commas." /></label><label className="field"><span>Breach-time emails</span><textarea required rows="2" value={contractorTerms.escalation_breach_emails} onChange={(e) => setContractorTerms({ ...contractorTerms, escalation_breach_emails: e.target.value })} placeholder="Separate multiple email addresses with commas." /></label><label className="field"><span>Review note</span><textarea rows="3" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Optional approval note, or explain changes needed if rejecting." /></label><div className="card-actions"><button className="button button-primary" disabled={isSubmitting} onClick={() => decide("APPROVE")}>{isSubmitting ? "Saving..." : "Approve both-party SLA"}</button><button className="button button-secondary" disabled={isSubmitting} onClick={() => decide("REJECT")}>Reject for revision</button></div></> : isSuperAdmin && agreement.status === "ACTIVE" ? <><span className="eyebrow">Platform safeguard</span><h3>Revoke this SLA?</h3><p className="section-copy">This prevents new tickets from being created under the agreement. Both organizations receive an in-app notification. Platform administration cannot edit party terms.</p><label className="field"><span>Revocation reason</span><textarea rows="4" value={revocationReason} onChange={(event) => setRevocationReason(event.target.value)} placeholder="Explain why this agreement is being revoked." required /></label><button type="button" className="button button-secondary" disabled={isRevoking} onClick={revoke}>{isRevoking ? "Revoking..." : "Revoke SLA"}</button></> : <><span className="eyebrow">Agreement workflow</span><h3>{agreement.status === "ACTIVE" ? "Ready for tickets" : agreement.status === "REJECTED" ? "Revision requested" : agreement.status === "REVOKED" ? "Revoked by platform administration" : "Awaiting next action"}</h3>{agreement.contractor_review_note ? <div className="request-note"><span>Contractor review note</span><p>{agreement.contractor_review_note}</p></div> : null}{agreement.revocation_reason ? <div className="request-note"><span>Revocation reason</span><p>{agreement.revocation_reason}</p></div> : null}<p className="section-copy">{agreement.status === "PENDING_APPROVAL" ? "The contractor organization has been asked to review this agreement." : agreement.status === "REJECTED" ? "Update the requested details, then resubmit the agreement for contractor approval." : agreement.status === "REVOKED" ? "This agreement remains available as a record but cannot be used for new tickets." : "Download the approved agreement PDF or begin ticket creation under its service rules."}</p>{mayRevise ? <Link to={`/sla-agreements/${agreement.id}/edit`} className="button button-primary button-small">Revise agreement</Link> : null}</>}</aside></div>
    {error ? <div className="panel form-error">{error}</div> : null}
  </section>;
}
