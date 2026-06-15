import { ExternalLink, HelpCircle, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FaqAccordion, type FaqItem } from "../components/FaqAccordion";
import { useAuth } from "../contexts/AuthContext";
import { SUPPORT_CATEGORIES, submitSupportRequest } from "../lib/supportApi";
import { sanitizeMultilineText, sanitizePlainText, validateEmail } from "../lib/validation";

const supportFaqItems: FaqItem[] = [
  {
    question: "What is ASEKE TRADE?",
    answer:
      "ASEKE TRADE is a crypto trading education platform focused on safety, structure, risk management, and disciplined learning."
  },
  {
    question: "How do I access the Trading Academy?",
    answer:
      "Create an account, choose a Trading Academy plan, and complete checkout. Active members can open the Academy dashboard from the main navigation."
  },
  {
    question: "What is included with premium access?",
    answer:
      "Premium access unlocks the Trading Academy, advanced lessons, risk tools, educational signals, AML checks, and direct Telegram support."
  },
  {
    question: "How do I join the Telegram community?",
    answer:
      "Use the Telegram community link on this page to join the ASEKE TRADE community channel in a new browser tab."
  },
  {
    question: "How do I contact support?",
    answer:
      "Use the support form on this page for regular questions. Trading Academy members can message premium support directly on Telegram."
  },
  {
    question: "Where can I view or manage my account/subscription?",
    answer:
      "Sign in and open your dashboard to review account details, payments, balance activity, and Trading Academy access."
  }
];

const blankSupportForm = {
  name: "",
  email: "",
  subject: "",
  category: "",
  message: ""
};

export function Support() {
  const { user, profile } = useAuth();
  const [form, setForm] = useState(blankSupportForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setForm((currentForm) => ({
      ...currentForm,
      name: currentForm.name || profile?.full_name || profile?.username || "",
      email: currentForm.email || user?.email || ""
    }));
  }, [profile, user]);

  const submitSupport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const nextForm = {
      name: sanitizePlainText(form.name, 120),
      email: sanitizePlainText(form.email, 180).toLowerCase(),
      subject: sanitizePlainText(form.subject, 180),
      category: sanitizePlainText(form.category, 60),
      message: sanitizeMultilineText(form.message, 2500)
    };

    const error =
      validateSupportField("name", nextForm.name) ??
      validateEmail(nextForm.email) ??
      validateSupportField("subject", nextForm.subject) ??
      validateSupportField("category", nextForm.category) ??
      validateSupportField("message", nextForm.message);

    if (error) {
      setFormError(error);
      setFormSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      await submitSupportRequest(nextForm);
      setForm({
        ...blankSupportForm,
        name: nextForm.name,
        email: nextForm.email
      });
      setFormSuccess("Support request sent. The ASEKE TRADE team will review it soon.");
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "Support request could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page page-stack support-page">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Support</p>
          <h1>ASEKE TRADE Support</h1>
          <p className="muted">
            Get help with your account, billing, Trading Academy access, payments, and platform questions.
          </p>
        </div>
      </section>

      <section className="support-overview-grid">
        <article className="section-panel support-info-panel">
          <div className="support-card-kicker">
            <span className="feature-icon">
              <HelpCircle size={20} />
            </span>
            <p className="eyebrow">Help Center</p>
          </div>
          <h2>Start with quick answers</h2>
          <p className="muted">
            Find the common ASEKE TRADE questions below, then send a support request if you still need help.
          </p>
        </article>

        <article className="section-panel support-info-panel">
          <div className="support-card-kicker">
            <span className="feature-icon">
              <MessageCircle size={20} />
            </span>
            <p className="eyebrow">Community</p>
          </div>
          <h2>Telegram community</h2>
          <p className="muted">
            Join the ASEKE TRADE Telegram Community for platform updates and community discussion.
          </p>
          <a
            className="ghost-button compact"
            href="https://t.me/aseketrade"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join the ASEKE TRADE Telegram Community
            <ExternalLink size={15} />
          </a>
        </article>

        <article className="section-panel support-info-panel">
          <div className="support-card-kicker">
            <span className="feature-icon">
              <ShieldCheck size={20} />
            </span>
            <p className="eyebrow">Account</p>
          </div>
          <h2>Manage access</h2>
          <p className="muted">
            Signed-in users can review payments, balance activity, and Trading Academy access from the dashboard.
          </p>
          <Link className="ghost-button compact" to={user ? "/dashboard" : "/login"}>
            {user ? "Open Dashboard" : "Login"}
          </Link>
        </article>
      </section>

      <section className="support-content-grid">
        <article className="section-panel support-form-panel">
          <div>
            <p className="eyebrow">Contact</p>
            <h2>Send a support request</h2>
            <p className="muted">Use this form for regular ASEKE TRADE support. Premium members can use direct Telegram support from the Academy dashboard.</p>
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          {formSuccess && (
            <p className="form-success" role="status">
              {formSuccess}
            </p>
          )}

          <form className="stack-form" onSubmit={submitSupport}>
            <div className="form-row">
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, name: event.target.value }))}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, email: event.target.value }))}
                  maxLength={180}
                  required
                />
              </label>
            </div>
            <label>
              Subject
              <input
                value={form.subject}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, subject: event.target.value }))}
                maxLength={180}
                required
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, category: event.target.value }))}
                required
              >
                <option value="">Choose category</option>
                {SUPPORT_CATEGORIES.map((category) => (
                  <option value={category} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Message
              <textarea
                value={form.message}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, message: event.target.value }))}
                maxLength={2500}
                rows={7}
                required
              />
            </label>
            <button className="primary-button full-width" type="submit" disabled={isSubmitting}>
              <Send size={17} />
              {isSubmitting ? "Sending" : "Send Support Request"}
            </button>
          </form>
        </article>

        <article className="section-panel support-faq-panel">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2>Common questions</h2>
          </div>
          <FaqAccordion items={supportFaqItems} />
        </article>
      </section>
    </main>
  );
}

function validateSupportField(field: "name" | "subject" | "category" | "message", value: string): string | null {
  if (field === "name" && !value) return "Name is required.";
  if (field === "subject" && !value) return "Subject is required.";
  if (field === "category" && !SUPPORT_CATEGORIES.includes(value as (typeof SUPPORT_CATEGORIES)[number])) {
    return "Choose a support category.";
  }
  if (field === "message" && !value) return "Message is required.";
  return null;
}
