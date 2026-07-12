import { LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

interface LocationState {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
}

export function Login() {
  const { user, isConfigured, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const returnLocation = (location.state as LocationState | null)?.from;
  const redirectTo = returnLocation?.pathname
    ? `${returnLocation.pathname}${returnLocation.search ?? ""}${returnLocation.hash ?? ""}`
    : "/dashboard";

  if (user) return <Navigate to={redirectTo} replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);
    const result = await signIn(email, password);
    setIsSubmitting(false);
    if (!result.ok) setMessage(result.message);
  };

  return (
    <main className="page auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Account Access</p>
          <h1>Login to ASEKE TRADE</h1>
          <p className="muted">Access your dashboard, saved guides, learning progress, and Trading Academy content.</p>
        </div>

        {!isConfigured && (
          <div className="warning-box">
            Supabase is not connected yet. Add your environment variables to enable live authentication.
          </div>
        )}

        <form className="stack-form" onSubmit={onSubmit}>
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
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {message && <p className="form-error">{message}</p>}

          <button className="primary-button full-width" type="submit" disabled={isSubmitting || !isConfigured}>
            <LockKeyhole size={17} />
            {isSubmitting ? "Logging in" : "Login"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/reset-password">Forgot password?</Link>
          <Link to="/register">Create an account</Link>
        </div>
      </section>
    </main>
  );
}
