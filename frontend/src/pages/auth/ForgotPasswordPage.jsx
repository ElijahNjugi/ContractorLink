import { useState } from "react";
import { Link } from "react-router-dom";
import { requestForgotPassword } from "../../api/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitState, setSubmitState] = useState({
    isSubmitting: false,
    error: "",
    success: "",
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitState({
      isSubmitting: true,
      error: "",
      success: "",
    });

    try {
      const result = await requestForgotPassword({ email });
      setSubmitState({
        isSubmitting: false,
        error: "",
        success:
          result.message ||
          "If an account exists for that email, a password reset link has been sent.",
      });
    } catch (err) {
      setSubmitState({
        isSubmitting: false,
        error: err.response?.data?.error || "Unable to process forgot password request.",
        success: "",
      });
    }
  }

  return (
    <div className="screen-center">
      <div className="panel auth-panel stack-md">
        <span className="brand-kicker">ContractorLink</span>
        <h2>Forgot password</h2>
        <p className="muted-text">
          Enter your account email and we will send you a password reset link.
        </p>

        <form onSubmit={handleSubmit} className="stack-md">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          {submitState.error ? <div className="form-error">{submitState.error}</div> : null}
          {submitState.success ? (
            <div className="form-success">{submitState.success}</div>
          ) : null}

          <button
            type="submit"
            className="button button-primary"
            disabled={submitState.isSubmitting}
          >
            {submitState.isSubmitting ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="auth-footer-link">
          <span className="muted-text">Remembered your password?</span>
          <Link to="/login">Return to sign in</Link>
        </div>
      </div>
    </div>
  );
}
