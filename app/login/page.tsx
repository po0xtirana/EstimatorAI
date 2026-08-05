"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "../../src/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState(false);

  useEffect(() => {
    setLocalPreview(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const error = new URLSearchParams(window.location.search).get("error");
    const messages: Record<string, string> = {
      invalid_link: "That sign-in link is incomplete. Request a fresh link below.",
      expired_link: "That sign-in link has expired. Request a fresh link below.",
      auth_callback_failed: "We could not complete that sign-in link. Request a fresh link below.",
      auth_not_configured: "Authentication is not configured for this environment."
    };
    if (error && messages[error]) setErrorMessage(messages[error]);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setErrorMessage(null);
    const supabase = createClient();
    if (!supabase) {
      setErrorMessage("Authentication is not configured for this environment.");
      setBusy(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` }
    });
    setErrorMessage(error ? `We could not send the sign-in link. ${error.message}` : null);
    setMessage(error ? null : `Link sent to ${email}. Open it from the same browser to finish signing in.`);
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand auth-brand"><span className="brand-mark">E</span><span>EstimatorAI</span></div>
        <p className="eyebrow accent">Private contractor workspace</p>
        <h1>Sign in to EstimatorAI</h1>
        <p className="auth-copy">Use your work email to receive a secure sign-in link.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@company.ca" />
          <button className="button auth-button" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Email me a sign-in link"}<span>→</span>
          </button>
        </form>
        {message && <div className="auth-message auth-success" role="status"><strong>{message}</strong><span>Check your inbox and spam folder. The link is single-use and expires.</span></div>}
        {errorMessage && <p className="auth-message auth-error" role="alert">{errorMessage}</p>}
        {localPreview && <a className="auth-preview-link" href="/preview">Preview the interface without email</a>}
      </div>
    </main>
  );
}
