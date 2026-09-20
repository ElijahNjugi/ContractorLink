import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await login(form);
      if (result.user?.must_change_password) {
        navigate("/change-password", { replace: true });
        return;
      }

      const nextPath = location.state?.from?.pathname || "/dashboard";
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-hero">
        <span className="brand-kicker">ContractorLink</span>
        <h1>Build accountable service partnerships.</h1>
        <p>
          Manage companies, contractors, SLAs, tickets, holds, and escalation
          workflows from one connected platform.
        </p>

        <div className="hero-actions">
          <Link to="/register-organization" className="button button-secondary">
            Register organization
          </Link>
          <Link to="/application-status" className="button button-secondary">
            Check application status
          </Link>
        </div>
      </div>

      <div className="auth-card">
        <h2>Sign in</h2>
        <p className="auth-copy">Use your platform account to continue.</p>

        <form onSubmit={handleSubmit} className="stack-md">
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
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="auth-footer-link">
          <span className="muted-text">Forgot your password?</span>
          <Link to="/forgot-password">Reset it here</Link>
        </div>
        <div className="auth-footer-link">
          <span className="muted-text">New here?</span>
          <Link to="/register-organization">Submit an organization application</Link>
        </div>
        <div className="auth-footer-link">
          <span className="muted-text">Already applied?</span>
          <Link to="/application-status">Track application review</Link>
        </div>
      </div>
    </div>
  );
}
