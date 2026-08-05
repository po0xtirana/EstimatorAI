"use client";

import { FormEvent, useEffect, useState } from "react";

type Profile = { id: string; name: string; trade_slug: string; target_markup_percent: number; contingency_percent: number; current_pipeline_load_percent: number | null };
type Template = { tradeSlug: string; name: string };

export default function TradeProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tradeSlug, setTradeSlug] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/trade-profiles");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load operating model");
    setProfiles(data.profiles ?? []); setTemplates(data.templates ?? []);
    if (!tradeSlug && data.templates?.[0]) setTradeSlug(data.templates[0].tradeSlug);
  }

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load operating model")); }, []);

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/trade-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tradeSlug }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to create profile");
      await load(); window.location.href = `/trade-profiles/${data.profile.id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create profile"); }
    finally { setBusy(false); }
  }

  return <main className="profile-page">
    <div className="profile-header"><div><p className="eyebrow accent">Company operating model</p><h1>Teach EstimatorAI how your teams deliver.</h1><p className="profile-copy">This is the single source of truth for company capability, resources, costs, crews, productivity, and commercial assumptions. Every estimate reads the selected trade profile from here.</p></div></div>
    {message && <p className="auth-message auth-error" role="alert">{message}</p>}
    <section className="profile-card setup-callout"><div><p className="eyebrow">Start with a trade</p><h2>Choose the work you want to price.</h2><p className="muted">We will create an editable starter model. Replace every system default with your company’s real assumptions before using it to bid.</p></div><form className="inline-form" onSubmit={createProfile}><select value={tradeSlug} onChange={(event) => setTradeSlug(event.target.value)}>{templates.map((template) => <option value={template.tradeSlug} key={template.tradeSlug}>{template.name}</option>)}</select><button className="button" type="submit" disabled={busy || !tradeSlug}>{busy ? "Creating..." : "Create trade profile →"}</button></form></section>
    <div className="section-heading"><div><p className="eyebrow">Configured profiles</p><h3>Your operating models</h3></div><span className="muted">{profiles.length} trade profile{profiles.length === 1 ? "" : "s"}</span></div>
    <div className="profile-grid">{profiles.map((profile) => <a className="profile-card profile-link-card" href={`/trade-profiles/${profile.id}`} key={profile.id}><div className="profile-card-heading"><div><p className="eyebrow accent">{profile.trade_slug}</p><h2>{profile.name}</h2></div><span className="status-pill">Open →</span></div><div className="profile-summary"><span><small>Markup</small><strong>{Number(profile.target_markup_percent).toFixed(1)}%</strong></span><span><small>Contingency</small><strong>{Number(profile.contingency_percent).toFixed(1)}%</strong></span><span><small>Pipeline</small><strong>{profile.current_pipeline_load_percent === null ? "Not set" : `${profile.current_pipeline_load_percent}%`}</strong></span></div></a>)}</div>
  </main>;
}
