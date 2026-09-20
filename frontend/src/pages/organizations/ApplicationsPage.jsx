import { useEffect, useMemo, useState } from "react";
import { fetchOrganizationApplications } from "../../api/organizations";
import PageHeader from "../../components/layout/PageHeader";
import ApplicationReviewPanel from "../../features/organizations/components/ApplicationReviewPanel";

export default function ApplicationsPage() {
  const [applications, setApplications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showHidden, setShowHidden] = useState(false);

  async function loadApplications() {
    setIsLoading(true);
    setError("");
    try {
      const data = await fetchOrganizationApplications({
        include_hidden: showHidden ? "true" : "false",
      });
      setApplications(data);
      return data;
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load applications.");
      return [];
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
  }, [showHidden]);

  const filteredApplications = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesStatus =
        statusFilter === "ALL" ? true : application.application_status === statusFilter;

      const haystack = [
        application.company_name,
        application.primary_contact_name,
        application.primary_contact_email,
        application.organization_type_requested,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = term ? haystack.includes(term) : true;

      return matchesStatus && matchesSearch;
    });
  }, [applications, searchTerm, statusFilter]);

  useEffect(() => {
    if (!filteredApplications.length) {
      setSelectedId(null);
      return;
    }

    const stillExists = filteredApplications.some((application) => application.id === selectedId);
    if (!stillExists) {
      setSelectedId(filteredApplications[0].id);
    }
  }, [filteredApplications, selectedId]);

  return (
    <section className="stack-lg">
      <PageHeader
        eyebrow="Onboarding"
        title="Organization applications"
        description="Review incoming company requests, capture notes, and approve the ones that are ready to join the platform."
      />

      <div className="panel stack-md">
        <div className="list-toolbar">
          <label className="field toolbar-search">
            <span>Search</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by company, contact, email, or type"
            />
          </label>

          <label className="field toolbar-filter">
            <span>Status filter</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="CONDITIONAL">Conditional</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>

          <label className="checkbox-field toolbar-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            <span>Show hidden</span>
          </label>
        </div>

        <p className="muted-text">
          Showing {filteredApplications.length} of {applications.length} application
          {applications.length === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="split-layout">
        <div className="panel">
          {isLoading ? <p>Loading applications...</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          {!isLoading && !error ? (
            <div className="table-shell">
              <table className="data-table selectable-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Primary contact</th>
                    <th>Documents</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.map((application) => (
                    <tr
                      key={application.id}
                      className={selectedId === application.id ? "is-selected" : ""}
                      onClick={() => setSelectedId(application.id)}
                    >
                      <td>
                        <div className="table-title-cell">
                          <strong>{application.company_name}</strong>
                          {application.is_hidden ? (
                            <span className="meta-chip">Hidden</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{application.organization_type_requested}</td>
                      <td>{application.primary_contact_name}</td>
                      <td>{application.document_count ?? 0}</td>
                      <td>{application.application_status}</td>
                    </tr>
                  ))}
                  {!filteredApplications.length ? (
                    <tr>
                      <td colSpan="5">No applications match the current search or filter.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {selectedId ? (
          <ApplicationReviewPanel
            applicationId={selectedId}
            onReviewed={loadApplications}
            onVisibilityChanged={async (applicationId, nextHidden) => {
              if (nextHidden && !showHidden && selectedId === applicationId) {
                setSelectedId(null);
              }
              await loadApplications();
            }}
          />
        ) : (
          <div className="panel">Select an application to review it.</div>
        )}
      </div>
    </section>
  );
}
