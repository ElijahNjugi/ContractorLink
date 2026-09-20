import { jsPDF } from "jspdf";

function displayDate(value) {
  const normalized = value ? String(value).slice(0, 10) : "";
  return normalized ? new Date(`${normalized}T00:00:00`).toLocaleDateString() : "Not specified";
}

function displayPriority(level) {
  return ({ 1: "Critical - 3 stars", 2: "High - 2 stars", 3: "Normal - 1 star" })[Number(level)] || "Not specified";
}

function duration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "Not specified";
  if (value >= 1440) return `${value / 1440} day(s)`;
  if (value >= 60) return `${value / 60} hour(s)`;
  return `${value} minutes`;
}

export function downloadSlaAgreementPdf({ agreement, policies }) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  let y = 20;

  function pageFooter() {
    pdf.setDrawColor(214, 199, 174);
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
    pdf.setFontSize(8);
    pdf.setTextColor(106, 90, 71);
    pdf.text("ContractorLink SLA Platform - Agreement record", margin, pageHeight - 9);
    pdf.text(`Generated ${new Date().toLocaleString()}`, pageWidth - margin, pageHeight - 9, { align: "right" });
  }

  function nextPageIfNeeded(height = 18) {
    if (y + height <= pageHeight - 23) return;
    pageFooter();
    pdf.addPage();
    y = 20;
  }

  function heading(text) {
    nextPageIfNeeded(15);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(14, 107, 92);
    pdf.text(text, margin, y);
    y += 8;
  }

  function paragraph(text) {
    const value = String(text || "Not specified");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10.5);
    pdf.setTextColor(36, 27, 18);
    const lines = pdf.splitTextToSize(value, pageWidth - (margin * 2));
    nextPageIfNeeded((lines.length * 5) + 5);
    pdf.text(lines, margin, y);
    y += (lines.length * 5) + 5;
  }

  function field(label, value) {
    nextPageIfNeeded(13);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(106, 90, 71);
    pdf.text(label, margin, y);
    y += 4.5;
    paragraph(value);
  }

  pdf.setFillColor(14, 107, 92);
  pdf.rect(0, 0, pageWidth, 11, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(255, 255, 255);
  pdf.text("CONTRACTORLINK", margin, 7.5);
  y = 25;
  pdf.setFontSize(21);
  pdf.setTextColor(36, 27, 18);
  pdf.text("Service Level Agreement", margin, y);
  y += 9;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(106, 90, 71);
  pdf.text(agreement.agreement_name, margin, y);
  y += 13;

  heading("1. Agreement overview");
  field("Client organization", agreement.client_organization_name);
  field("Service provider", agreement.contractor_organization_name);
  field("Document owner", agreement.document_owner_name || agreement.created_by_name);
  field("Effective date", displayDate(agreement.effective_date));
  field("Term", String(agreement.renewal_type || "ONGOING").replace(/_/g, " "));
  field("End date", displayDate(agreement.end_date));
  field("Notice period", agreement.notice_period_days == null ? "Not specified" : `${agreement.notice_period_days} days`);
  field("Review frequency", agreement.review_interval_months == null ? "Not specified" : `${agreement.review_interval_months} months`);

  heading("2. Services and responsibilities");
  field("Services in scope", agreement.services_in_scope || agreement.description);
  field("Services excluded", agreement.services_excluded);
  field("Client responsibilities", agreement.client_responsibilities);
  field("Provider responsibilities", agreement.contractor_responsibilities);
  field("Service assumptions", agreement.service_assumptions);

  heading("3. Service management and targets");
  field("Support hours", agreement.support_hours);
  field("Approved service channels", agreement.support_channels);
  (policies || []).forEach((policy) => {
    field(`${displayPriority(policy.priority_level)} target`, `Respond within ${duration(policy.target_response_minutes)}. Resolve within ${duration(policy.target_resolution_minutes)}.`);
  });

  heading("4. Commercial and legal reference");
  field("Payment terms", agreement.payment_terms);
  field("Governing law", agreement.governing_law);
  field("Additional legal terms", agreement.legal_terms);

  heading("5. Agreement status");
  field("Current status", String(agreement.status || "DRAFT").replace(/_/g, " "));
  if (agreement.contractor_approved_at) field("Approved by the provider", `Approval recorded on ${new Date(agreement.contractor_approved_at).toLocaleString()}.`);
  if (agreement.status === "REVOKED") field("Revocation record", `Revoked on ${new Date(agreement.revoked_at).toLocaleString()}. Reason: ${agreement.revocation_reason || "Not specified"}`);

  nextPageIfNeeded(24);
  pdf.setFillColor(240, 231, 216);
  pdf.roundedRect(margin, y, pageWidth - (margin * 2), 20, 3, 3, "F");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.8);
  pdf.setTextColor(106, 90, 71);
  const recordNote = pdf.splitTextToSize("This PDF is a platform-generated record of the terms entered and approved in ContractorLink. Organizations should obtain independent legal advice for legal enforceability, signing authority, and applicable-law requirements.", pageWidth - (margin * 2) - 10);
  pdf.text(recordNote, margin + 5, y + 7);
  pageFooter();

  const filename = `${String(agreement.agreement_name || "sla-agreement").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-v${agreement.agreement_version || "1.0"}.pdf`;
  pdf.save(filename);
}
