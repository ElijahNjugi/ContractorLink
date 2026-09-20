import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchOrganizationApplicationStatus,
  respondToConditionalApplication,
} from "../../api/organizations";

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

function emptyDocumentRow() {
  return {
    document_type: "SUPPORTING_DOCUMENT",
    document_label: "",
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

export default function ApplicationStatusPage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({
    application_id: searchParams.get("application_id") || "",
    email: searchParams.get("email") || "",
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conditionalForm, setConditionalForm] = useState({
    primary_contact_phone: "",
    service_summary: "",
    description: "",
    coverage_area: "",
    applicant_response_notes: "",
  });
  const [conditionalDocuments, setConditionalDocuments] = useState([emptyDocumentRow()]);
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [resubmitMessage, setResubmitMessage] = useState("");

  useEffect(() => {
    const applicationId = searchParams.get("application_id") || "";
    const email = searchParams.get("email") || "";

    if (applicationId && email) {
      handleLookup(applicationId, email);
    }
  }, []);

  function hydrateConditionalForm(data) {
    setConditionalForm({
      primary_contact_phone: data.primary_contact_phone || "",
      service_summary: data.service_summary || "",
      description: data.description || "",
      coverage_area: data.coverage_area || "",
      applicant_response_notes: data.applicant_response_notes || "",
    });
    setConditionalDocuments([emptyDocumentRow()]);
  }

  async function handleLookup(applicationIdArg, emailArg) {
    const applicationId = (applicationIdArg ?? form.application_id).trim();
    const email = (emailArg ?? form.email).trim().toLowerCase();

    if (!applicationId || !email) {
      setError("Enter both the application reference ID and the primary contact email.");
      setResult(null);
      return;
    }

    setIsLoading(true);
    setError("");
    setResubmitMessage("");

    try {
      const data = await fetchOrganizationApplicationStatus(applicationId, email);
      setResult(data);
      setForm({
        application_id: applicationId,
        email,
      });
      hydrateConditionalForm(data);
    } catch (err) {
      setResult(null);
      setError(
        err.response?.data?.error || "Unable to find an application with those details."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function updateConditionalField(key, value) {
    setConditionalForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateDocument(index, key, value) {
    setConditionalDocuments((current) =>
      current.map((document, currentIndex) =>
        currentIndex === index ? { ...document, [key]: value } : document
      )
    );
  }

  function addDocument() {
    setConditionalDocuments((current) => [...current, emptyDocumentRow()]);
  }

  function removeDocument(index) {
    setConditionalDocuments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleConditionalSubmit(event) {
    event.preventDefault();

    if (!result) {
      return;
    }

    setIsResubmitting(true);
    setError("");
    setResubmitMessage("");

    try {
      const documents = await Promise.all(
        conditionalDocuments
          .filter((document) => document.file)
          .map(async (document) => ({
            document_type: document.document_type,
            document_label: document.document_label.trim() || "Additional supporting document",
            file_name: document.file.name,
            mime_type: document.file.type || "application/octet-stream",
            content_base64: await fileToBase64(document.file),
            document_number: document.document_number.trim(),
            issue_date: document.issue_date || null,
            expiry_date: document.expiry_date || null,
            notes: document.notes.trim(),
          }))
      );

      const response = await respondToConditionalApplication(result.id, {
        email: form.email.trim().toLowerCase(),
        primary_contact_phone: conditionalForm.primary_contact_phone.trim(),
        service_summary: conditionalForm.service_summary.trim(),
        description: conditionalForm.description.trim(),
        coverage_area: conditionalForm.coverage_area.trim(),
        applicant_response_notes: conditionalForm.applicant_response_notes.trim(),
        documents,
      });

      setResult(response);
      setResubmitMessage(
        "Your update has been submitted successfully. The application has been returned for administrative review."
      );
      hydrateConditionalForm(response);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          "Unable to resubmit the conditional application."
      );
    } finally {
      setIsResubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-hero">
        <span className="brand-kicker">ContractorLink</span>
        <h1>Track your organization application.</h1>
        <p>
          Use the reference ID from your submission together with the primary
          contact email to check whether your application is pending, under
          review, conditional, approved, or rejected.
        </p>
      </div>

      <div className="auth-card auth-card-wide">
        <div className="auth-card-header">
          <div>
            <h2>Check application status</h2>
            <p className="auth-copy">
              Enter the exact contact email used during registration.
            </p>
          </div>
          <div className="action-row">
            <Link to="/register-organization" className="button button-secondary button-small">
              New registration
            </Link>
            <Link to="/login" className="button button-secondary button-small">
              Back to sign in
            </Link>
          </div>
        </div>

        <form
          className="stack-md"
          onSubmit={(event) => {
            event.preventDefault();
            handleLookup();
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Application reference ID</span>
              <input
                type="text"
                value={form.application_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    application_id: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className="field">
              <span>Primary contact email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </label>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
          {resubmitMessage ? <div className="form-success">{resubmitMessage}</div> : null}

          <button type="submit" className="button button-primary" disabled={isLoading}>
            {isLoading ? "Checking status..." : "Check application"}
          </button>
        </form>

        {result ? (
          <div className="panel inset-panel stack-md">
            <div className="detail-header">
              <div>
                <span className="eyebrow">Application result</span>
                <h3>{result.company_name}</h3>
              </div>
              <span
                className={`status-pill status-${String(result.application_status).toLowerCase()}`}
              >
                {result.application_status}
              </span>
            </div>

            <div className="detail-grid">
              <div>
                <span className="detail-label">Requested type</span>
                <strong>{result.organization_type_requested}</strong>
              </div>
              <div>
                <span className="detail-label">Reference ID</span>
                <strong>{result.id}</strong>
              </div>
              <div>
                <span className="detail-label">Documents on file</span>
                <strong>{result.document_count}</strong>
              </div>
              <div>
                <span className="detail-label">Review summary</span>
                <strong>{result.status_summary}</strong>
              </div>
            </div>

            {result.review_notes ? (
              <div className="panel inset-panel">
                <span className="detail-label">Review notes</span>
                <p>{result.review_notes}</p>
              </div>
            ) : null}

            {result.rejection_reason ? (
              <div className="panel inset-panel">
                <span className="detail-label">Rejection reason</span>
                <p>{result.rejection_reason}</p>
              </div>
            ) : null}

            {result.applicant_response_notes ? (
              <div className="panel inset-panel">
                <span className="detail-label">Your latest response</span>
                <p>{result.applicant_response_notes}</p>
              </div>
            ) : null}

            {result.approved_organization_name ? (
              <div className="panel inset-panel">
                <span className="detail-label">Approved organization</span>
                <p>{result.approved_organization_name}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {result?.application_status === "CONDITIONAL" ? (
          <form onSubmit={handleConditionalSubmit} className="panel inset-panel stack-md">
            <div>
              <span className="eyebrow">Respond to review</span>
              <h3>Upload more documents or clarify your application</h3>
              <p className="muted-text">
                Update the details below only if they help address the conditional review notes.
              </p>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Primary contact phone</span>
                <input
                  type="text"
                  value={conditionalForm.primary_contact_phone}
                  onChange={(event) =>
                    updateConditionalField("primary_contact_phone", event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span>Coverage area</span>
                <input
                  type="text"
                  value={conditionalForm.coverage_area}
                  onChange={(event) =>
                    updateConditionalField("coverage_area", event.target.value)
                  }
                />
              </label>
            </div>

            <label className="field">
              <span>Service summary</span>
              <textarea
                rows="3"
                value={conditionalForm.service_summary}
                onChange={(event) =>
                  updateConditionalField("service_summary", event.target.value)
                }
              />
            </label>

            <label className="field">
              <span>Organization description</span>
              <textarea
                rows="4"
                value={conditionalForm.description}
                onChange={(event) =>
                  updateConditionalField("description", event.target.value)
                }
              />
            </label>

            <label className="field">
              <span>Applicant response notes</span>
              <textarea
                rows="4"
                value={conditionalForm.applicant_response_notes}
                onChange={(event) =>
                  updateConditionalField("applicant_response_notes", event.target.value)
                }
                placeholder="Explain the extra documents or corrections you are submitting."
              />
            </label>

            <div className="section-heading">
              <div>
                <span className="eyebrow">Additional documents</span>
                <h4>Upload more files</h4>
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
              {conditionalDocuments.map((document, index) => (
                <div key={`conditional-document-${index}`} className="document-card">
                  <div className="section-heading">
                    <strong>Document {index + 1}</strong>
                    {conditionalDocuments.length > 1 ? (
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
                        placeholder="Describe this additional file"
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
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2-2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 14h8M8 17h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                    />
                  </label>
                </div>
              ))}
            </div>

            <button type="submit" className="button button-primary" disabled={isResubmitting}>
              {isResubmitting ? "Resubmitting..." : "Resubmit for review"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
