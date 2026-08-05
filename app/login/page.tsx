"use client";

import { FormEvent, useState } from "react";
import { createClient } from "../../src/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const supabase = createClient();
    if (!supabase) { setMessage("Authentication is not configured for this environment."); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/confirm` } });
    setMessage(error ? "We could not send the sign-in link. Check the address and try again." : "Check your email for a secure sign-in link.");
    setBusy(false);
  }

  return <main className="auth-page"><div className="auth-card"><div className="brand auth-brand"><span className="brand-mark">B</span><span>BidPilot</span></div><p className="eyebrow accent">Contractor workspace</p><h1>Sign in to BidPilot</h1><p className="auth-copy">Use your work email to receive a secure sign-in link.</p><form onSubmit={submit}><label htmlFor="email">Work email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@company.ca" /><button className="button auth-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}<span>→</span></button></form>{message && <p className="auth-message" role="status">{message}</p>}</div></main>;
}
