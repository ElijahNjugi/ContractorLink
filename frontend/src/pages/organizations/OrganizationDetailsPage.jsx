import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  fetchDepartments,
  fetchOrganization,
  fetchOrganizationContacts,
  fetchOrganizationUsers,
} from "../../api/organizations";
import PageHeader from "../../components/layout/PageHeader";
import OrganizationForm from "../../features/organizations/components/OrganizationForm";
import OrganizationContactsPanel from "../../features/organizations/components/OrganizationContactsPanel";
import OrganizationDepartmentsPanel from "../../features/organizations/components/OrganizationDepartmentsPanel";
import OrganizationMarketplacePanel from "../../features/organizations/components/OrganizationMarketplacePanel";
import OrganizationUsersPanel from "../../features/organizations/components/OrganizationUsersPanel";
import { useAuth } from "../../context/AuthContext";

export default function OrganizationDetailsPage() {
  const { organizationId } = useParams();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [organization, setOrganization] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const activeSection = searchParams.get("section") || "profile";
  const supportsMarketplace = ["CONTRACTOR", "HYBRID"].includes(
    String(organization?.organization_type || "").toUpperCase()
  );

  const sections = useMemo(
    () =>
      [
        { key: "profile", label: "Profile" },
        supportsMarketplace ? { key: "marketplace", label: "Marketplace" } : null,
        { key: "contacts", label: `Contacts (${contacts.length})` },
        { key: "departments", label: `Departments (${departments.length})` },
        { key: "users", label: `Users (${users.length})` },
      ].filter(Boolean),
    [contacts.length, departments.length, supportsMarketplace, users.length]
  );

  async function loadOrganizationWorkspace() {
    setIsLoading(true);
    setError("");

    try {
      const [organizationData, contactData, departmentData, userData] = await Promise.all([
        fetchOrganization(organizationId),
        fetchOrganizationContacts(organizationId),
        fetchDepartments(organizationId),
        fetchOrganizationUsers(organizationId),
      ]);

      setOrganization(organizationData);
      setContacts(contactData);
      setDepartments(departmentData);
      setUsers(userData);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load organization workspace.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadOrganizationWorkspace();
  }, [organizationId]);

  if (isLoading) {
    return <div className="panel">Loading organization workspace...</div>;
  }

  if (error) {
    return <div className="panel form-error">{error}</div>;
  }

  return (
    <section className="stack-lg">
      <PageHeader
        eyebrow="Organization workspace"
        title={organization.name}
        description="Manage the company profile, contacts, and internal team accounts from one place."
        actions={
          <Link
            to={user?.role_code === "SUPER_ADMIN" ? "/organizations" : "/dashboard"}
            className="button button-secondary"
          >
            {user?.role_code === "SUPER_ADMIN" ? "Back to organizations" : "Back to dashboard"}
          </Link>
        }
      />

      <div className="grid-cards">
        <article className="panel metric-card">
          <span className="metric-label">Organization type</span>
          <strong>{organization.organization_type}</strong>
          <p>{organization.is_active ? "Active on platform" : "Inactive on platform"}</p>
        </article>
        <article className="panel metric-card">
          <span className="metric-label">Contacts</span>
          <strong>{contacts.length}</strong>
          <p>{contacts.filter((contact) => contact.is_primary).length} marked as primary</p>
        </article>
        <article className="panel metric-card">
          <span className="metric-label">Team users</span>
          <strong>{users.length}</strong>
          <p>{users.filter((user) => user.is_active).length} currently active</p>
        </article>
        <article className="panel metric-card">
          <span className="metric-label">Departments</span>
          <strong>{departments.length}</strong>
          <p>{departments.filter((department) => department.is_active).length} active units</p>
        </article>
      </div>

      <div className="section-switcher">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={
              activeSection === section.key
                ? "section-tab active"
                : "section-tab"
            }
            onClick={() => setSearchParams({ section: section.key })}
          >
            {section.label}
          </button>
        ))}
      </div>

      {activeSection === "profile" ? (
        <OrganizationForm organization={organization} onSuccess={setOrganization} />
      ) : null}
      {activeSection === "marketplace" && supportsMarketplace ? (
        <OrganizationMarketplacePanel
          organization={organization}
          onSuccess={setOrganization}
        />
      ) : null}
      {activeSection === "contacts" ? (
        <OrganizationContactsPanel
          organizationId={organizationId}
          contacts={contacts}
          onRefresh={loadOrganizationWorkspace}
        />
      ) : null}
      {activeSection === "departments" ? (
        <OrganizationDepartmentsPanel
          organizationId={organizationId}
          departments={departments}
          onRefresh={loadOrganizationWorkspace}
        />
      ) : null}
      {activeSection === "users" ? (
        <OrganizationUsersPanel
          organizationId={organizationId}
          users={users}
          departments={departments}
          onRefresh={loadOrganizationWorkspace}
        />
      ) : null}
    </section>
  );
}
