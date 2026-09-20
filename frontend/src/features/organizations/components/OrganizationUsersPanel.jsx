import { useState } from "react";
import {
  createOrganizationUser,
  resetOrganizationUserAccess,
  updateOrganizationUser,
} from "../../../api/organizations";
import { USER_ROLE_OPTIONS } from "../constants";
import { getFriendlyRoleLabel } from "../utils";
import { useAuth } from "../../../context/AuthContext";

const initialForm = {
  full_name: "",
  email: "",
  phone: "",
  job_title: "",
  role_code: "ORG_STAFF",
  department_id: "",
  is_department_admin: false,
};

export default function OrganizationUsersPanel({
  organizationId,
  users,
  departments,
  onRefresh,
}) {
  const { user: currentUser } = useAuth();
  const isSuperAdmin = String(currentUser?.role_code || "").toUpperCase() === "SUPER_ADMIN";
  const canResetAccess = isSuperAdmin || String(currentUser?.role_code || "").toUpperCase() === "ORG_ADMIN";
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeDepartments = departments.filter((department) => department.is_active);

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setTempPassword(null);
    setIsSubmitting(true);

    try {
      const result = await createOrganizationUser({
        organization_id: organizationId,
        ...form,
        department_id: form.department_id || null,
      });
      setTempPassword({
        password: result.tempPassword,
        email: result.user?.email || form.email,
        delivery: result.email_delivery || "skipped",
      });
      setForm(initialForm);
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to create user.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleUser(user) {
    try {
      await updateOrganizationUser(user.id, {
        is_active: !user.is_active,
      });
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update user.");
    }
  }

  async function handleResetAccess(user) {
    setError("");
    setTempPassword(null);

    try {
      const result = await resetOrganizationUserAccess(user.id);
      setTempPassword({
        password: result.tempPassword,
        email: result.email || user.email,
        delivery: result.email_delivery || "skipped",
      });
      onRefresh?.();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to reset user access.");
    }
  }

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Organization users</span>
            <h3>Team accounts</h3>
          </div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Email</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.full_name}</strong>
                    <div className="muted-table-text">{user.job_title || "No job title"}</div>
                  </td>
                  <td>{getFriendlyRoleLabel(user.role_code, user.role_name)}</td>
                  <td>
                    {user.department_name || "Organization-wide"}
                    {user.is_department_admin ? (
                      <div className="muted-table-text">Department admin</div>
                    ) : null}
                  </td>
                  <td>{user.email}</td>
                  <td>{user.is_active ? "Active" : "Inactive"}</td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => toggleUser(user)}
                    >
                      {user.is_active ? "Disable" : "Enable"}
                    </button>
                    {canResetAccess ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => handleResetAccess(user)}
                      >
                        Reset access
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan="6">No users created yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={handleCreate} className="panel stack-md">
        <div className="detail-header">
          <div>
            <span className="eyebrow">Add user</span>
            <h3>Invite organization account</h3>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Full name</span>
            <input
              value={form.full_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, full_name: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Job title</span>
            <input
              value={form.job_title}
              onChange={(event) =>
                setForm((current) => ({ ...current, job_title: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={form.role_code}
              onChange={(event) => {
                const nextRole = event.target.value;
                setForm((current) => ({
                  ...current,
                  role_code: nextRole,
                  department_id:
                    nextRole === "ORG_ADMIN" ? "" : current.department_id,
                  is_department_admin:
                    nextRole === "ORG_ADMIN" ? false : current.is_department_admin,
                }));
              }}
            >
              {USER_ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Department</span>
            <select
              value={form.department_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  department_id: event.target.value,
                }))
              }
              disabled={form.role_code === "ORG_ADMIN"}
              required={form.role_code !== "ORG_ADMIN"}
            >
              <option value="">
                {form.role_code === "ORG_ADMIN"
                  ? "Organization admin is not tied to one department"
                  : activeDepartments.length
                    ? "Select department"
                    : "Create a department first"}
              </option>
              {activeDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={form.is_department_admin}
              disabled={form.role_code === "ORG_ADMIN" || !form.department_id}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_department_admin: event.target.checked,
                }))
              }
            />
            <span>Department admin privileges</span>
          </label>
        </div>

        {form.role_code !== "ORG_ADMIN" && !activeDepartments.length ? (
          <div className="form-error">
            Create at least one active department before inviting non-organization-admin
            users.
          </div>
        ) : null}

        {tempPassword ? (
          <div className="success-card">
            <div>
              <strong>Temporary password created</strong>
              <p>
                Share this safely with <strong>{tempPassword.email}</strong> and ask
                them to change it immediately after first login.
              </p>
              <p className="muted-text">
                Email delivery:{" "}
                <strong>
                  {tempPassword.delivery === "sent"
                    ? "sent"
                    : tempPassword.delivery === "failed"
                      ? "failed"
                      : "not configured"}
                </strong>
              </p>
              <code>{tempPassword.password}</code>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => navigator.clipboard?.writeText(tempPassword.password)}
            >
              Copy password
            </button>
          </div>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}

        <button
          type="submit"
          className="button button-primary"
          disabled={
            isSubmitting ||
            (form.role_code !== "ORG_ADMIN" && !activeDepartments.length)
          }
        >
          {isSubmitting ? "Creating user..." : "Create user"}
        </button>
      </form>
    </div>
  );
}
