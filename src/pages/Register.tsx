import { UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function Register() {
  const { user, isConfigured, signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    if (!termsAccepted) {
      setMessage("You must accept the Terms of Agreement to continue.");
      return;
    }

    setIsSubmitting(true);
    const result = await signUp(fullName, email, password, termsAccepted);
    setIsSubmitting(false);
    setMessage(result.message);
    setIsSuccess(result.ok);
  };

  return (
    <main className="page auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Create Account</p>
          <h1>Join ASEKE TRADE</h1>
          <p className="muted">
            Create your account to save guides, track progress, and unlock verified Premium Trading Academy access.
          </p>
        </div>

        {!isConfigured && (
          <div className="warning-box">
            Supabase is not connected yet. Add your environment variables to enable account creation.
          </div>
        )}

        <form className="stack-form" onSubmit={onSubmit}>
          <label>
            Full name
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="checkbox-label terms-checkbox-label">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
            <span>
              I agree to the ASEKE TRADE{" "}
              <Link className="inline-form-link" to="/terms" onClick={(event) => event.stopPropagation()}>
                Terms of Agreement
              </Link>
              .
            </span>
          </label>

          {message && <p className={isSuccess ? "form-success" : "form-error"}>{message}</p>}

          <button className="primary-button full-width" type="submit" disabled={isSubmitting || !isConfigured}>
            <UserPlus size={17} />
            {isSubmitting ? "Creating account" : "Create account"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">Already have an account?</Link>
        </div>
      </section>
    </main>
  );
}
