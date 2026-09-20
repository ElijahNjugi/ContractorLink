import { useEffect, useState } from "react";
import {
  fetchOrganizationApplication,
  reviewOrganizationApplication,
  updateOrganizationApplicationVisibility,
} from "../../../api/organizations";

const REVIEW_OPTIONS = [
  { value: "UNDER_REVIEW", label: "Mark under review" },
  { value: "CONDITIONAL", label: "Mark conditional" },
  { value: "APPROVED", label: "Approve" },
  { value: "REJECTED", label: "Reject" },
];

function canStillBeReviewed(status) {
  return ["PENDING", "UNDER_REVIEW", "CONDITIONAL"].includes(status);
}

const initialReviewForm = {
  status: "UNDER_REVIEW",
  review_notes: "",
  rejection_reason: "",
};

export default function ApplicationReviewPanel({
  applicationId,
  onReviewed,
  onVisibilityChanged,
}) {
  const [application, setApplication] = useState(null);
  const [form, setForm] = useState(initialReviewForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    setSuccessMessage("");

    fetchOrganizationApplication(applicationId)
      .then((data) => {
        if (!active) return;
        setApplication(data);
        setForm({
          status:
            data.application_status === "PENDING"
              ? "UNDER_REVIEW"
              : canStillBeReviewed(data.application_status)
              ? data.application_status
              : "APPROVED",
          review_notes: data.review_notes || "",
          rejection_reason: data.rejection_reason || "",
        });
      })
      .catch((err) => {
        if (!active) return;
        setError(err.response?.data?.error || "Unable to load application details.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applicationId]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await reviewOrganizationApplication(applicationId, form);
      setApplication(response);
      setForm((current) => ({
        ...current,
        review_notes: response.review_notes || current.review_notes,
        rejection_reason: response.rejection_reason || current.rejection_reason,
      }));

      if (response.application_status === "APPROVED") {
        setSuccessMessage(
          response.created_admin_email
            ? `Application approved. Admin account created for ${response.created_admin_email}.`
            : "Application approved successfully."
        );
      } else if (response.application_status === "CONDITIONAL") {
        setSuccessMessage(
          "Application marked as conditional. Feedback email sent to the applicant."
        );
      } else if (response.application_status === "REJECTED") {
        setSuccessMessage("Application rejected. Rejection email sent to the applicant.");
      } else {
        setSuccessMessage("Application review status updated.");
      }

      await onReviewed?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to review this application.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVisibilityToggle() {
    if (!application) {
      return;
    }

    setIsUpdatingVisibility(true);
    setError("");
    setSuccessMessage("");

    try {
      const nextHidden = !application.is_hidden;
      await updateOrganizationApplicationVisibility(application.id, nextHidden);
      setApplication((current) =>
        current
          ? {
              ...current,
              is_hidden: nextHidden,
            }
          : current
      );
      setSuccessMessage(
        nextHidden
          ? "Application hidden from the default applications list."
          : "Application is visible in the list again."
      );

      if (onVisibilityChanged) {
        await onVisibilityChanged(application.id, nextHidden);
      } else {
        await onReviewed?.();
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update application visibility.");
    } finally {
      setIsUpdatingVisibility(false);
    }
  }

  if (isLoading) {
    return <div className="panel">Loading application details...</div>;
  }

  if (error && !application) {
    return <div className="panel form-error">{error}</div>;
  }

  return (
    <div className="panel stack-md">
      <div className="detail-header">
        <div>
          <span className="eyebrow">Selected application</span>
          <h3>{application.company_name}</h3>
        </div>
        <div className="action-row">
          <span
            className={`status-pill status-${String(application.application_status).toLowerCase()}`}
          >
            {application.application_status}
          </span>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={handleVisibilityToggle}
            disabled={isUpdatingVisibility}
          >
            {isUpdatingVisibility
              ? "Saving..."
              : application.is_hidden
              ? "Unhide"
              : "Hide"}
          </button>
        </div>
      </div>

      {application.is_hidden ? (
        <div className="panel inset-panel">
          <span className="detail-label">Visibility</span>
          <p>
            This application is hidden from the default list.
            {application.hidden_by_name ? ` Hidden by ${application.hidden_by_name}.` : ""}
          </p>
        </div>
      ) : null}

      <div className="detail-grid">
        <div>
          <span className="detail-label">Requested type</span>
          <strong>{application.organization_type_requested}</strong>
        </div>
        <div>
          <span className="detail-label">Primary contact</span>
          <strong>{application.primary_contact_name}</strong>
          <p>{application.primary_contact_email}</p>
          {application.primary_contact_phone ? <p>{application.primary_contact_phone}</p> : null}
        </div>
        <div>
          <span className="detail-label">Coverage area</span>
          <strong>{application.coverage_area || "Not provided"}</strong>
        </div>
        <div>
          <span className="detail-label">Service summary</span>
          <strong>{application.service_summary || "Not provided"}</strong>
        </div>
      </div>

      <div className="panel inset-panel">
        <span className="detail-label">Description</span>
        <p>{application.description || "No description submitted."}</p>
      </div>

      {application.applicant_response_notes ? (
        <div className="panel inset-panel">
          <span className="detail-label">Applicant response notes</span>
          <p>{application.applicant_response_notes}</p>
        </div>
      ) : null}

      <div className="panel inset-panel stack-sm">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Supporting documents</span>
            <h4>Uploaded files</h4>
          </div>
          <span className="meta-chip">{application.documents?.length || 0} uploaded</span>
        </div>

        {application.documents?.length ? (
          <div className="table-shell">
            <table className="data-table compact-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Label</th>
                  <th>Document no.</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {application.documents.map((document) => (
                  <tr key={document.id}>
                    <td>{document.document_type || "SUPPORTING_DOCUMENT"}</td>
                    <td>{document.document_label}</td>
                    <td>{document.document_number || "—"}</td>
                    <td>
                      <a
                        href={document.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="table-link"
                      >
                        {document.file_name}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">No supporting documents were uploaded.</p>
        )}
      </div>

      {canStillBeReviewed(application.application_status) ? (
        <form onSubmit={handleSubmit} className="stack-md">
          <div className="inline-fields">
            <label className="field">
              <span>Decision</span>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                {REVIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Review notes</span>
            <textarea
              rows="4"
              value={form.review_notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  review_notes: event.target.value,
                }))
              }
              placeholder={
                form.status === "CONDITIONAL"
                  ? "Explain what is missing or needs to be corrected."
                  : "Optional review notes."
              }
            />
          </label>

          {form.status === "REJECTED" ? (
            <label className="field">
              <span>Rejection reason</span>
              <textarea
                rows="3"
                value={form.rejection_reason}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rejection_reason: event.target.value,
                  }))
                }
                placeholder="State the reason the organization cannot be approved."
              />
            </label>
          ) : null}

          {error ? <div className="form-error">{error}</div> : null}
          {successMessage ? <div className="form-success">{successMessage}</div> : null}

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving decision..." : "Submit review"}
          </button>
        </form>
      ) : (
        <div className="panel inset-panel stack-sm">
          <span className="detail-label">Review outcome</span>
          <p>{application.review_notes || "No review notes recorded."}</p>
          {application.rejection_reason ? (
            <p>
              Rejection reason: <strong>{application.rejection_reason}</strong>
            </p>
          ) : null}
          {application.approved_organization_name ? (
            <p>
              Approved into: <strong>{application.approved_organization_name}</strong>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
