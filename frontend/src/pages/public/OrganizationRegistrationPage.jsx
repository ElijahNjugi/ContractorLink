import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { submitOrganizationApplication } from "../../api/organizations";

const TYPE_OPTIONS = [
  {
    value: "CLIENT",
    title: "Register as a client",
    description:
      "Choose this if your organization needs contractors or service providers for operational work.",
  },
  {
    value: "CONTRACTOR",
    title: "Register as a contractor",
    description:
      "Choose this if your organization offers services such as support, maintenance, repairs, or field operations.",
  },
  {
    value: "HYBRID",
    title: "Register as both",
    description:
      "Choose this if your organization both needs services from other contractors and offers services to clients.",
  },
];

const DOCUMENT_TYPE_OPTIONS = [
  { value: "COMPANY_REGISTRATION", label: "Company registration / incorporation" },
  { value: "BUSINESS_PERMIT", label: "Business permit / operating licence" },
  { value: "TAX_COMPLIANCE", label: "Tax compliance certificate" },
  { value: "COMPANY_PROFILE", label: "Company profile" },
  { value: "REPRESENTATIVE_ID", label: "Representative ID / authorization letter" },
  { value: "INSURANCE_CERTIFICATE", label: "Insurance certificate" },
  { value: "SECTOR_CERTIFICATION", label: "Sector-specific certification" },
  { value: "SUPPORTING_DOCUMENT", label: "Other supporting document" },
];

const DEFAULT_DOCUMENTS = [
  { document_type: "COMPANY_REGISTRATION", document_label: "Company registration" },
  { document_type: "BUSINESS_PERMIT", document_label: "Business permit" },
];

function emptyDocumentRow(seed = {}) {
  return {
    document_type: seed.document_type || "SUPPORTING_DOCUMENT",
    document_label: seed.document_label || "",
    document_number: "",
    issue_date: "",
    expiry_date: "",
    notes: "",
    file: null,
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, content = ""] = result.split(",");
      resolve(content);
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function OrganizationRegistrationPage() {
  const [form, setForm] = useState({
    company_name: "",
    organization_type_requested: "CLIENT",
    primary_contact_name: "",
    primary_contact_email: "",
    primary_contact_phone: "",
    description: "",
    service_summary: "",
    coverage_area: "",
  });
  const [documents, setDocuments] = useState(DEFAULT_DOCUMENTS.map(emptyDocumentRow));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submittedApplication, setSubmittedApplication] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedType = useMemo(
    () =>
      TYPE_OPTIONS.find((option) => option.value === form.organization_type_requested) ||
      TYPE_OPTIONS[0],
    [form.organization_type_requested]
  );

  function updateField(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateDocument(index, key, value) {
    setDocuments((current) =>
      current.map((document, currentIndex) =>
        currentIndex === index
          ? {
              ...document,
              [key]: value,
              ...(key === "document_type" && !document.document_label
                ? {
                    document_label:
                      DOCUMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ||
                      document.document_label,
                  }
                : {}),
            }
          : document
      )
    );
  }

  function addDocument() {
    setDocuments((current) => [...current, emptyDocumentRow()]);
  }

  function removeDocument(index) {
    setDocuments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const documentPayload = await Promise.all(
        documents
          .filter((document) => document.file)
          .map(async (document) => ({
            document_type: document.document_type,
            document_label: document.document_label.trim() || "Supporting document",
            file_name: document.file.name,
            mime_type: document.file.type || "application/octet-stream",
            content_base64: await fileToBase64(document.file),
            document_number: document.document_number.trim(),
            issue_date: document.issue_date || null,
            expiry_date: document.expiry_date || null,
            notes: document.notes.trim(),
          }))
      );

      if (!documentPayload.length) {
        throw new Error("Upload at least one supporting document before submitting.");
      }

      const payload = {
        ...form,
        company_name: form.company_name.trim(),
        primary_contact_name: form.primary_contact_name.trim(),
        primary_contact_email: form.primary_contact_email.trim().toLowerCase(),
        primary_contact_phone: form.primary_contact_phone.trim(),
        description: form.description.trim(),
        service_summary: form.service_summary.trim(),
        coverage_area: form.coverage_area.trim(),
        documents: documentPayload,
      };

      const application = await submitOrganizationApplication(payload);
      setSubmittedApplication(application);
      setSuccess(
        "Application submitted successfully. Keep your reference ID safe so you can check your review status later."
      );
      setForm({
        company_name: "",
        organization_type_requested: "CLIENT",
        primary_contact_name: "",
        primary_contact_email: "",
        primary_contact_phone: "",
        description: "",
        service_summary: "",
        coverage_area: "",
      });
      setDocuments(DEFAULT_DOCUMENTS.map(emptyDocumentRow));
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          "Failed to submit organization application."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-hero">
        <span className="brand-kicker">ContractorLink</span>
        <h1>Bring verified companies onto one service platform.</h1>
        <p>
          Apply as a client or contractor organization, upload your supporting
          documents, and move into structured SLA-driven coordination after
          approval.
        </p>

        <div className="panel inset-panel stack-md public-info-panel">
          <div>
            <span className="eyebrow">How it works</span>
            <h3>Registration process</h3>
          </div>

          <div className="grid-cards">
            <article className="metric-card">
              <span className="metric-label">Step 1</span>
              <strong>Submit your organization request</strong>
              <p>
                Provide your company details, choose whether you are joining as a
                client or contractor, and upload your supporting documents.
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Step 2</span>
              <strong>Await administrative review</strong>
              <p>
                The platform administrator checks your details, documents, and
                compliance readiness before making a decision.
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Step 3</span>
              <strong>Track status or receive onboarding access</strong>
              <p>
                Use your reference ID to check status. If approved, your contact
                email becomes the first organization admin account.
              </p>
            </article>
          </div>

          <div className="stack-md">
            <div>
              <span className="eyebrow">Typical verification items</span>
              <h3>Prepare these details for review</h3>
            </div>
            <ul className="info-list">
              <li>Company registration or incorporation document</li>
              <li>Business permit or operating licence</li>
              <li>Tax or compliance certificate</li>
              <li>Representative identification and supporting proof</li>
            </ul>
            <p className="muted-text">
              The super admin may still mark an application as conditional if
              more evidence or clarification is needed.
            </p>
          </div>
        </div>
      </div>

      <div className="auth-card auth-card-wide">
        <div className="auth-card-header">
          <div>
            <h2>Register your organization</h2>
            <p className="auth-copy">
              Complete the application below. Approved requests receive an
              organization admin account.
            </p>
          </div>
          <div className="action-row">
            <Link to="/application-status" className="button button-secondary button-small">
              Check application status
            </Link>
            <Link to="/login" className="button button-secondary button-small">
              Back to sign in
            </Link>
          </div>
        </div>

        <div className="type-card-grid">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`type-card ${
                form.organization_type_requested === option.value ? "selected" : ""
              }`}
              onClick={() => updateField("organization_type_requested", option.value)}
            >
              <span className="eyebrow">{option.value}</span>
              <strong>{option.title}</strong>
              <p>{option.description}</p>
            </button>
          ))}
        </div>

        <div className="panel inset-panel registration-context">
          <span className="eyebrow">Selected path</span>
          <h3>{selectedType.title}</h3>
          <p>{selectedType.description}</p>
        </div>

        <form onSubmit={handleSubmit} className="stack-md">
          <div className="form-grid">
            <label className="field">
              <span>Organization name</span>
              <input
                type="text"
                value={form.company_name}
                onChange={(event) => updateField("company_name", event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Primary contact name</span>
              <input
                type="text"
                value={form.primary_contact_name}
                onChange={(event) =>
                  updateField("primary_contact_name", event.target.value)
                }
                required
              />
            </label>

            <label className="field">
              <span>Primary contact email</span>
              <input
                type="email"
                value={form.primary_contact_email}
                onChange={(event) =>
                  updateField("primary_contact_email", event.target.value)
                }
                required
              />
            </label>

            <label className="field">
              <span>Primary contact phone</span>
              <input
                type="text"
                value={form.primary_contact_phone}
                onChange={(event) =>
                  updateField("primary_contact_phone", event.target.value)
                }
              />
            </label>

            <label className="field">
              <span>Coverage area</span>
              <input
                type="text"
                value={form.coverage_area}
                onChange={(event) => updateField("coverage_area", event.target.value)}
                placeholder="County, town, or operational region"
              />
            </label>
          </div>

          <label className="field">
            <span>Service summary</span>
            <textarea
              rows="3"
              value={form.service_summary}
              onChange={(event) => updateField("service_summary", event.target.value)}
              placeholder="Briefly describe the services your organization offers or needs."
            />
          </label>

          <label className="field">
            <span>Organization description</span>
            <textarea
              rows="4"
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
              placeholder="Provide more context about your organization and operational needs."
            />
          </label>

          <div className="panel inset-panel stack-md">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Supporting documents</span>
                <h3>Upload files for verification</h3>
              </div>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={addDocument}
              >
                Add document
              </button>
            </div>

            <div className="stack-md">
              {documents.map((document, index) => (
                <div key={`${document.document_type}-${index}`} className="document-card">
                  <div className="section-heading">
                    <strong>Document {index + 1}</strong>
                    {documents.length > 1 ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => removeDocument(index)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>Document type</span>
                      <select
                        value={document.document_type}
                        onChange={(event) =>
                          updateDocument(index, "document_type", event.target.value)
                        }
                      >
                        {DOCUMENT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Document label</span>
                      <input
                        type="text"
                        value={document.document_label}
                        onChange={(event) =>
                          updateDocument(index, "document_label", event.target.value)
                        }
                        placeholder="How should the admin recognize this file?"
                      />
                    </label>

                    <label className="field">
                      <span>Document number</span>
                      <input
                        type="text"
                        value={document.document_number}
                        onChange={(event) =>
                          updateDocument(index, "document_number", event.target.value)
                        }
                        placeholder="Optional registration, permit, or policy number"
                      />
                    </label>

                    <label className="field">
                      <span>Upload file</span>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.zip"
                        onChange={(event) =>
                          updateDocument(index, "file", event.target.files?.[0] || null)
                        }
                      />
                      <div className={document.file ? "selected-file selected" : "selected-file"} title={document.file?.name || "No file selected"}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 14h8M8 17h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span>{document.file ? document.file.name : "No file chosen yet"}</span>
                      </div>
                    </label>

                    <label className="field">
                      <span>Issue date</span>
                      <input
                        type="date"
                        value={document.issue_date}
                        onChange={(event) =>
                          updateDocument(index, "issue_date", event.target.value)
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Expiry date</span>
                      <input
                        type="date"
                        value={document.expiry_date}
                        onChange={(event) =>
                          updateDocument(index, "expiry_date", event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Notes</span>
                    <textarea
                      rows="2"
                      value={document.notes}
                      onChange={(event) =>
                        updateDocument(index, "notes", event.target.value)
                      }
                      placeholder="Optional notes to help the administrator understand this file."
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
          {success ? (
            <div className="form-success stack-sm">
              <strong>Application received.</strong>
              <p>{success}</p>
              {submittedApplication ? (
                <>
                  <p className="meta-line">
                    <span>Application status: {submittedApplication.application_status}</span>
                    <span>Reference ID: {submittedApplication.id}</span>
                  </p>
                  <Link
                    to={`/application-status?application_id=${submittedApplication.id}&email=${encodeURIComponent(
                      submittedApplication.primary_contact_email
                    )}`}
                    className="button button-secondary button-small"
                  >
                    Track this application
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? "Submitting application..." : "Submit application"}
          </button>
        </form>
      </div>
    </div>
  );
}
