"use client";

import { useEffect, useState } from "react";

type Source = { source_key: string; name: string; jurisdiction: string; source_category: string; access_mode: string; coverage_label: string; base_url: string | null; scan_interval_minutes: number; enabled: boolean; connection_status: string; last_success_at: string | null; last_error: string | null; organizationConnection: { status: string; connection_type: string; last_success_at: string | null; last_error: string | null } | null; latestRun: { rows_seen: number; rows_selected: number; completed_at: string | null; status: string; error_message: string | null } | null };

function date(value: string | null | undefined): string { return value ? new Date(value).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not scanned yet"; }
function interval(minutes: number): string { return minutes < 120 ? `Every ${minutes} minutes` : `Every ${Math.round(minutes / 60)} hours`; }

export default function TenderSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [summary, setSummary] = useState({ connected: 0, available: 0, healthy: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/tender-sources", { cache: "no-store" }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to load sources"); setSources(payload.sources ?? []); setSummary(payload.summary ?? { connected: 0, available: 0, healthy: 0 }); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load sources")).finally(() => setLoading(false)); }, []);

  return <main className="empty-page sources-page"><header className="sources-header"><div><p className="eyebrow accent">Source coverage</p><h1>One intelligent feed across connected tender sources</h1><p className="empty-page-copy">EstimatorAI uses public feeds where available and licensed or customer-authorized connections where access is restricted. Source outages and missing access stay visible.</p></div><a className="button" href="/tenders">Open opportunities →</a></header>
    <section className="source-summary"><article><span>Connected</span><strong>{summary.connected}</strong><small>Feeds available to your company</small></article><article><span>Healthy</span><strong>{summary.healthy}</strong><small>Last run completed without an outage</small></article><article><span>Coverage registry</span><strong>{summary.available}</strong><small>Public, licensed, and authorized options</small></article></section>
    <div className="source-policy"><strong>Access policy</strong><p>EstimatorAI does not bypass portal controls. Restricted sources require a permitted licence, contractor-authorized access, or forwarded tender notifications.</p></div>
    {error && <p className="inline-alert error-text" role="alert">{error}</p>}
    {loading ? <div className="opportunity-skeletons"><div className="opportunity-skeleton" /><div className="opportunity-skeleton" /></div> : <section className="source-list">{sources.map((source) => {
      const status = source.organizationConnection?.status ?? source.connection_status;
      const connected = status === "connected";
      const lastSuccess = source.organizationConnection?.last_success_at ?? source.last_success_at ?? source.latestRun?.completed_at;
      const failure = source.organizationConnection?.last_error ?? source.last_error ?? source.latestRun?.error_message;
      return <article className="source-card" key={source.source_key}><div className="source-mark">{source.name.slice(0, 2).toUpperCase()}</div><div className="source-main"><div className="source-title"><div><h2>{source.name}</h2><p>{source.coverage_label}</p></div><span className={`source-status ${connected ? "connected" : status === "outage" || status === "error" ? "outage" : "required"}`}>{status.replaceAll("_", " ")}</span></div><div className="source-details"><span>{source.jurisdiction}</span><span>{source.access_mode.replaceAll("_", " ")}</span><span>{interval(source.scan_interval_minutes)}</span><span>Last success: {date(lastSuccess)}</span>{source.latestRun && <span>{source.latestRun.rows_seen.toLocaleString("en-CA")} records checked</span>}</div>{failure && <p className="source-error">{failure}</p>}<div className="source-actions">{source.base_url && <a href={source.base_url} target="_blank" rel="noopener noreferrer">Source website →</a>}<span>{connected ? "Automatic monitoring is active" : source.access_mode === "public_feed" ? "Connector rollout pending" : "Authorized connection required"}</span></div></div></article>;
    })}</section>}
  </main>;
}
