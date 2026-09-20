import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  confirmResetPassword,
  validateResetPasswordToken,
} from "../../api/auth";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [tokenState, setTokenState] = useState({
    isLoading: true,
    isValid: false,
    email: "",
    fullName: "",
    error: "",
  });
  const [form, setForm] = useState({
    new_password: "",
    confirm_password: "",
  });
  const [submitState, setSubmitState] = useState({
    isSubmitting: false,
    error: "",
    success: "",
  });

  useEffect(() => {
    if (!token) {
      setTokenState({
        isLoading: false,
        isValid: false,
        email: "",
        fullName: "",
        error: "Reset token is missing from this link.",
      });
      return;
    }

    validateResetPasswordToken(token)
      .then((data) => {
        setTokenState({
          isLoading: false,
          isValid: Boolean(data.valid),
          email: data.email,
          fullName: data.full_name,
          error: "",
        });
      })
      .catch((err) => {
        setTokenState({
          isLoading: false,
          isValid: false,
          email: "",
          fullName: "",
          error: err.response?.data?.error || "Unable to validate reset link.",
        });
      });
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitState({ isSubmitting: true, error: "", success: "" });

    if (form.new_password !== form.confirm_password) {
      setSubmitState({
        isSubmitting: false,
        error: "New password and confirmation do not match.",
        success: "",
      });
      return;
    }

    try {
      const result = await confirmResetPassword({
        token,
        new_password: form.new_password,
      });
      setSubmitState({
        isSubmitting: false,
        error: "",
        success: result.message || "Password updated successfully.",
      });
      setForm({ new_password: "", confirm_password: "" });
      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } catch (err) {
      setSubmitState({
        isSubmitting: false,
        error: err.response?.data?.error || "Unable to reset password.",
        success: "",
      });
    }
  }

  return (
    <div className="screen-center">
      <div className="panel auth-panel stack-md">
        <span className="brand-kicker">ContractorLink</span>
        <h2>Reset your password</h2>

        {tokenState.isLoading ? <p>Validating your secure link...</p> : null}
        {!tokenState.isLoading && !tokenState.isValid ? (
          <div className="form-error">{tokenState.error}</div>
        ) : null}

        {!tokenState.isLoading && tokenState.isValid ? (
          <>
            <p className="muted-text">
              This password update link belongs to{" "}
              <strong>{tokenState.fullName || tokenState.email}</strong>.
            </p>

            <form onSubmit={handleSubmit} className="stack-md">
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

              {submitState.error ? (
                <div className="form-error">{submitState.error}</div>
              ) : null}
              {submitState.success ? (
                <div className="form-success">
                  {submitState.success} <Link to="/login">Return to sign in</Link>
                </div>
              ) : null}

              <button
                type="submit"
                className="button button-primary"
                disabled={submitState.isSubmitting}
              >
                {submitState.isSubmitting ? "Saving..." : "Save new password"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
