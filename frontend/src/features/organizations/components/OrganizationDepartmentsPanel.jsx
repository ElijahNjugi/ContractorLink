import { useMemo, useState } from "react";
import {
  createDepartment,
  fetchDepartmentUsers,
  updateDepartment,
} from "../../../api/organizations";

const initialForm = {
  name: "",
  description: "",
  is_active: true,
};

export default function OrganizationDepartmentsPanel({
  organizationId,
  departments,
  onRefresh,
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedDepartmentId, setExpandedDepartmentId] = useState(null);
  const [departmentUsers, setDepartmentUsers] = useState({});
  const [loadingDepartmentId, setLoadingDepartmentId] = useState(null);

  const orderedDepartments = useMemo(
    () =>
      [...departments].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      ),
    [departments]
  );

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await createDepartment({
        organization_id: organizationId,
        ...form,
      });
      setForm(initialForm);
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to create department.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleDepartment(department) {
    try {
      await updateDepartment(department.id, {
        is_active: !department.is_active,
      });
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update department.");
    }
  }

  async function toggleMembers(departmentId) {
    if (expandedDepartmentId === departmentId) {
      setExpandedDepartmentId(null);
      return;
    }

    setExpandedDepartmentId(departmentId);
    if (departmentUsers[departmentId]) {
      return;
    }

    setLoadingDepartmentId(departmentId);
    try {
      const users = await fetchDepartmentUsers(departmentId);
      setDepartmentUsers((current) => ({ ...current, [departmentId]: users }));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load department users.");
    } finally {
      setLoadingDepartmentId(null);
    }
  }

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Departments</span>
            <h3>Internal operating units</h3>
          </div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Users</th>
                <th>Admins</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orderedDepartments.map((department) => (
                <tr key={department.id}>
                  <td>
                    <strong>{department.name}</strong>
                    <div className="muted-table-text">
                      {department.description || "No description yet."}
                    </div>
                  </td>
                  <td>{department.active_user_count}</td>
                  <td>{department.admin_user_count}</td>
                  <td>{department.is_active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => toggleMembers(department.id)}
                      >
                        {expandedDepartmentId === department.id
                          ? "Hide members"
                          : "View members"}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => toggleDepartment(department)}
                      >
                        {department.is_active ? "Disable" : "Enable"}
                      </button>
                    </div>
                    {expandedDepartmentId === department.id ? (
                      <div className="embedded-list">
                        {loadingDepartmentId === department.id ? (
                          <p className="muted-text">Loading department members...</p>
                        ) : departmentUsers[department.id]?.length ? (
                          <ul className="detail-list">
                            {departmentUsers[department.id].map((user) => (
                              <li key={user.id}>
                                <strong>{user.full_name}</strong>{" "}
                                <span className="muted-text">
                                  {user.job_title || "No title"}
                                </span>
                                {user.is_department_admin ? " · Department admin" : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted-text">No department users assigned yet.</p>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!orderedDepartments.length ? (
                <tr>
                  <td colSpan="5">No departments created yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={handleCreate} className="panel stack-md">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Add department</span>
            <h3>Create a new department</h3>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_active: event.target.checked,
                }))
              }
            />
            <span>Department is active</span>
          </label>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea
            rows="3"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Creating department..." : "Create department"}
        </button>
      </form>
    </div>
  );
}
