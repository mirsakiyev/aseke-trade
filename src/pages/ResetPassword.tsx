import { MailCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function ResetPassword() {
  const { isConfigured, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);
    const result = await resetPassword(email);
    setIsSubmitting(false);
    setMessage(result.message);
    setIsSuccess(result.ok);
  };

  return (
    <main className="page auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Password Reset</p>
          <h1>Reset your password</h1>
          <p className="muted">Supabase will send a secure reset link when the email belongs to an account.</p>
        </div>

        {!isConfigured && (
          <div className="warning-box">Supabase is not connected yet. Add environment variables first.</div>
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

          {message && <p className={isSuccess ? "form-success" : "form-error"}>{message}</p>}

          <button className="primary-button full-width" type="submit" disabled={isSubmitting || !isConfigured}>
            <MailCheck size={17} />
            {isSubmitting ? "Sending link" : "Send reset link"}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">Back to login</Link>
        </div>
      </section>
    </main>
  );
}
