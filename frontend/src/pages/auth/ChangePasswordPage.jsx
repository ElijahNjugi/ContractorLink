import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { changePassword } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [form, setForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (form.new_password !== form.confirm_password) {
      setError("New password and confirmation do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword({
        current_password: form.current_password,
        new_password: form.new_password,
      });
      logout();
      setSuccess("Password updated successfully. Redirecting to sign in...");
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to update password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="screen-center">
      <div className="panel auth-panel">
        <h2>Change password</h2>
        <p className="muted-text">
          Update your password to secure your account before continuing.
        </p>

        <form onSubmit={handleSubmit} className="stack-md">
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={form.current_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  current_password: event.target.value,
                }))
              }
              required
            />
          </label>

          <label className="field">
            <span>New password</span>
            <input
              type="password"
              value={form.new_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  new_password: event.target.value,
                }))
              }
              required
            />
          </label>

          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={form.confirm_password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confirm_password: event.target.value,
                }))
              }
              required
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}
          {success ? (
            <div className="form-success">
              {success} <Link to="/login">Back to sign in</Link>
            </div>
          ) : null}

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
