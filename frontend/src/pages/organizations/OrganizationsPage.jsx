import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOrganizations, updateOrganization } from "../../api/organizations";
import PageHeader from "../../components/layout/PageHeader";
import OrganizationForm from "../../features/organizations/components/OrganizationForm";

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusMessage, setStatusMessage] = useState("");

  async function loadOrganizations() {
    setIsLoading(true);
    setError("");
    try {
      const data = await fetchOrganizations({
        include_inactive: showInactive,
      });
      setOrganizations(data);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load organizations.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadOrganizations();
  }, [showInactive]);

  const visibleOrganizations = organizations.filter((organization) => {
    const matchesSearch = searchTerm
      ? [
          organization.name,
          organization.organization_type,
          organization.email,
          organization.phone,
          organization.description,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(searchTerm.toLowerCase())
          )
      : true;

    const matchesType =
      typeFilter === "ALL" || organization.organization_type === typeFilter;

    return matchesSearch && matchesType;
  });

  async function toggleOrganization(organization) {
    setError("");
    setStatusMessage("");

    try {
      await updateOrganization(organization.id, {
        is_active: !organization.is_active,
      });
      setStatusMessage(
        organization.is_active
          ? `${organization.name} has been disabled.`
          : `${organization.name} has been re-enabled.`
      );
      loadOrganizations();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update organization.");
    }
  }

  return (
    <section className="stack-lg">
      <PageHeader
        eyebrow="Companies"
        title="Organizations"
        description="Approved companies live here. Create new company profiles or open a workspace to manage their contacts and internal team accounts."
        actions={
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setShowCreateForm((current) => !current)}
          >
            {showCreateForm ? "Hide form" : "Create organization"}
          </button>
        }
      />

      {showCreateForm ? (
        <OrganizationForm
          onSuccess={() => {
            setShowCreateForm(false);
            loadOrganizations();
          }}
          submitLabel="Create organization"
        />
      ) : null}

      <div className="panel stack-md">
        <div className="toolbar-grid">
          <label className="field">
            <span>Search organizations</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by company, email, phone, or description"
            />
          </label>
          <label className="field">
            <span>Type filter</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="ALL">All organization types</option>
              <option value="CLIENT">Client</option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="HYBRID">Hybrid</option>
              <option value="PLATFORM_INTERNAL">Platform internal</option>
            </select>
          </label>
          <label className="field checkbox-field toolbar-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            <span>Show inactive organizations</span>
          </label>
        </div>

        <div className="toolbar-summary">
          Showing {visibleOrganizations.length} of {organizations.length} organizations.
        </div>
      </div>

      <div className="grid-cards">
        {isLoading ? <div className="panel">Loading organizations...</div> : null}
        {error ? <div className="panel form-error">{error}</div> : null}
        {statusMessage ? <div className="panel form-success">{statusMessage}</div> : null}
        {!isLoading &&
          !error &&
          visibleOrganizations.map((organization) => (
            <article key={organization.id} className="panel organization-card">
              <div className="tag-row">
                <span className="tag">{organization.organization_type}</span>
                <span className={organization.is_active ? "status-dot online" : "status-dot"}>
                  {organization.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <h3>{organization.name}</h3>
              <p>{organization.description || "No description yet."}</p>
              <div className="meta-line">
                <span>{organization.user_count} users</span>
                <span>{organization.asset_count} assets</span>
              </div>
              <div className="card-actions">
                <Link
                  to={`/organizations/${organization.id}?section=profile`}
                  className="button button-secondary button-small"
                >
                  View details
                </Link>
                <Link
                  to={`/organizations/${organization.id}?section=contacts`}
                  className="button button-secondary button-small"
                >
                  View contacts
                </Link>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => toggleOrganization(organization)}
                >
                  {organization.is_active ? "Disable" : "Enable"}
                </button>
              </div>
            </article>
          ))}
        {!isLoading && !error && !visibleOrganizations.length ? (
          <div className="panel">No organizations found yet.</div>
        ) : null}
      </div>
    </section>
  );
}
