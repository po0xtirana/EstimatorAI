"use client";

import { useCallback, useEffect, useState } from "react";

type Connection = { status: string; connection_type: string; forwarding_address: string | null; verified_at: string | null; last_email_at: string | null; processed_email_count: number; last_success_at: string | null; last_error: string | null };
type Source = { source_key: string; name: string; jurisdiction: string; source_category: string; access_mode: string; connector_kind: string; coverage_label: string; base_url: string | null; scan_interval_minutes: number; enabled: boolean; connection_status: string; last_success_at: string | null; last_error: string | null; organizationConnection: Connection | null; latestRun: { rows_seen: number; rows_selected: number; completed_at: string | null; status: string; error_message: string | null } | null };

const SOURCE_STEPS: Record<string, string[]> = {
  "ontario-tenders-portal": ["Sign in to the Ontario Tenders Portal.", "Add the private address below as a notification or forwarding recipient.", "Enable alerts for the categories and regions your company follows."],
  bidsandtenders: ["Open each Bids&Tenders supplier account your company uses.", "Send opportunity and addendum notifications to the private address below.", "EstimatorAI verifies the connection when the first alert arrives."],
  merx: ["Sign in to MERX and open Opportunity Matching or a saved search.", "Use the private address below for matching-tender and amendment emails.", "Keep the saved search broad; company capability matching happens inside EstimatorAI."],
  biddingo: ["Sign in to Biddingo and open bid-notification settings.", "Add or forward notifications to the private address below.", "The first verified notification activates this source."],
  bonfire: ["Open the supplier portal notification settings for each Bonfire buyer.", "Forward opportunity, addendum, and deadline emails to the private address below.", "Restricted documents remain attached to the company-specific opportunity."],
  "estimating-inbox": ["Create a forwarding rule in the estimating mailbox your company already monitors.", "Forward tender invitations and addenda to the private address below.", "EstimatorAI deduplicates revisions and sends the opportunity through company matching."]
};

function date(value: string | null | undefined): string { return value ? new Date(value).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not received yet"; }
function interval(minutes: number): string { return minutes < 120 ? `Every ${minutes} minutes` : `Every ${Math.round(minutes / 60)} hours`; }

export default function TenderSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [summary, setSummary] = useState({ connected: 0, available: 0, healthy: 0 });
  const [canManage, setCanManage] = useState(false);
  const [inboundConfigured, setInboundConfigured] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/tender-sources", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load sources");
    setSources(payload.sources ?? []);
    setSummary(payload.summary ?? { connected: 0, available: 0, healthy: 0 });
    setCanManage(Boolean(payload.canManage));
    setInboundConfigured(Boolean(payload.inboundConfigured));
  }, []);

  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load sources")).finally(() => setLoading(false)); }, [load]);

  async function connect(sourceKey: string) {
    setBusy(sourceKey); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/tender-sources/${sourceKey}/connection`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create private tender inbox");
      await load(); setExpanded(sourceKey); setMessage("Private address created. The connection becomes active when its first verified alert arrives.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect source"); }
    finally { setBusy(null); }
  }

  async function disconnect(sourceKey: string) {
    setBusy(sourceKey); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/tender-sources/${sourceKey}/connection`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to revoke source connection");
      await load(); setExpanded(null); setMessage("The private address was revoked. New messages sent to it will be rejected.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke source"); }
    finally { setBusy(null); }
  }

  async function copyAddress(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Private tender address copied.");
  }

  return <main className="empty-page sources-page"><header className="sources-header"><div><p className="eyebrow accent">Source coverage</p><h1>One intelligent feed across connected tender sources</h1><p className="empty-page-copy">Public feeds run directly. Restricted portals connect through company-authorized notification emails, so EstimatorAI can receive opportunities and attachments without bypassing portal controls.</p></div><a className="button" href="/tenders">Open opportunities →</a></header>
    <section className="source-summary"><article><span>Connected</span><strong>{summary.connected}</strong><small>Feeds available to your company</small></article><article><span>Healthy</span><strong>{summary.healthy}</strong><small>Connected without an unresolved error</small></article><article><span>Coverage registry</span><strong>{summary.available}</strong><small>Public, licensed, and authorized options</small></article></section>
    <div className="source-policy"><strong>How restricted sources connect</strong><p>EstimatorAI gives your company a private address for each portal. Add it to that portal’s permitted notification settings or an email forwarding rule. The verified email, linked documents, and PDF attachments are then deduplicated, scanned, matched, and queued for analysis.</p></div>
    {message && <p className="inline-alert source-success" role="status">{message}</p>}
    {error && <p className="inline-alert error-text" role="alert">{error}</p>}
    {!inboundConfigured && <div className="source-configuration-warning"><strong>Inbound receiving needs deployment configuration</strong><p>The connector code is ready, but an administrator must verify the receiving domain and add the Resend API key and webhook secret before private addresses can be issued.</p></div>}
    {loading ? <div className="opportunity-skeletons"><div className="opportunity-skeleton" /><div className="opportunity-skeleton" /></div> : <section className="source-list">{sources.map((source) => {
      const status = source.organizationConnection?.status ?? source.connection_status;
      const publicConnection = source.connector_kind === "canadabuys_csv";
      const connected = status === "connected";
      const verifying = status === "verifying";
      const lastSuccess = source.organizationConnection?.last_success_at ?? source.last_success_at ?? source.latestRun?.completed_at;
      const failure = source.organizationConnection?.last_error ?? source.last_error ?? source.latestRun?.error_message;
      const isExpanded = expanded === source.source_key;
      const address = source.organizationConnection?.forwarding_address;
      const canConnect = !publicConnection && source.source_key !== "seao";
      return <article className={`source-card ${isExpanded ? "expanded" : ""}`} key={source.source_key}><div className="source-mark">{source.name.slice(0, 2).toUpperCase()}</div><div className="source-main"><div className="source-title"><div><h2>{source.name}</h2><p>{source.coverage_label}</p></div><span className={`source-status ${connected ? "connected" : status === "outage" || status === "error" ? "outage" : "required"}`}>{verifying ? "waiting for first alert" : status.replaceAll("_", " ")}</span></div><div className="source-details"><span>{source.jurisdiction}</span><span>{publicConnection ? "Public feed" : "Authorized email connection"}</span><span>{publicConnection ? interval(source.scan_interval_minutes) : `${source.organizationConnection?.processed_email_count ?? 0} alerts received`}</span><span>{publicConnection ? `Last success: ${date(lastSuccess)}` : `Last alert: ${date(source.organizationConnection?.last_email_at)}`}</span>{source.latestRun && publicConnection && <span>{source.latestRun.rows_seen.toLocaleString("en-CA")} records checked</span>}</div>{failure && <p className="source-error">{failure}</p>}<div className="source-actions">{source.base_url && <a href={source.base_url} target="_blank" rel="noopener noreferrer">Source website →</a>}<span>{connected ? publicConnection ? "Automatic monitoring is active" : "Authorized alert intake is active" : verifying ? "Send one portal alert to finish verification" : canConnect ? "Connect the portal’s notification emails" : "Not available for new connections"}</span>{canConnect && <button className="text-button" type="button" onClick={() => setExpanded(isExpanded ? null : source.source_key)}>{isExpanded ? "Close setup" : address ? "View connection" : "Connect source"}</button>}</div>
        {isExpanded && canConnect && <div className="source-connection-panel"><div><p className="eyebrow">Authorized connection</p><h3>{address ? "Send this source’s alerts to EstimatorAI" : "Create a private tender address"}</h3><p>{address ? "Only verified messages delivered to this address enter your company workspace." : "A separate address keeps this source auditable and can be revoked without affecting other portals."}</p></div>{address ? <><div className="source-address"><code>{address}</code><button type="button" onClick={() => copyAddress(address)}>Copy address</button></div><ol>{(SOURCE_STEPS[source.source_key] ?? SOURCE_STEPS["estimating-inbox"]).map((step) => <li key={step}>{step}</li>)}</ol><div className="source-connection-meta"><span><strong>Status</strong>{verifying ? "Waiting for first verified alert" : connected ? "Connected and receiving" : status.replaceAll("_", " ")}</span><span><strong>Last received</strong>{date(source.organizationConnection?.last_email_at)}</span></div>{canManage && <button className="danger-link" type="button" disabled={busy === source.source_key} onClick={() => disconnect(source.source_key)}>{busy === source.source_key ? "Revoking…" : "Revoke private address"}</button>}</> : <div className="source-connect-cta"><p>EstimatorAI will not ask for or store your portal password. You authorize only the tender notifications you choose to forward.</p><button className="button" type="button" disabled={!canManage || !inboundConfigured || busy === source.source_key} onClick={() => connect(source.source_key)}>{busy === source.source_key ? "Creating…" : "Create private address"}</button>{!canManage && <small>An organization owner or admin must create this connection.</small>}</div>}</div>}
      </div></article>;
    })}</section>}
  </main>;
}
