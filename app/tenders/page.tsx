"use client";

import { useEffect, useMemo, useState } from "react";

type Tender = { id: string; source: string; title_en: string | null; title_fr: string | null; description_en: string | null; buyer_name: string | null; published_at: string | null; closing_at: string | null; estimated_value_cents: number | null; procurement_category: string; source_url: string | null; amendment_at: string | null };
type Analysis = { detected_trades: string[]; matched_trades: string[]; decision: string; match_score: number | null; capability_gaps: Array<{ message?: string }>; reasons: string[]; project_type: string | null; urgency: string | null; expected_estimating_effort_minutes: number | null; recommended_action: string | null };
type OrgTender = { tender_id: string; match_score: number | null; status: string; decision: string | null; recommended_action: string | null; urgency: string | null; estimating_effort_minutes: number | null; tenders: Tender; analysis: Analysis | null; relevance_feedback: { label: string; reason: string | null } | null; processing_job: { status: string; stage: string; last_error: string | null } | null; team_fit_score: number | null };

function money(cents: number | null): string { return cents === null ? "Value not published" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100); }
function date(value: string | null): string { return value ? new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Not published"; }
function sourceName(source: string): string { return ({ canadabuys: "CanadaBuys", bidsandtenders: "Bids&Tenders", merx: "MERX", biddingo: "Biddingo", bonfire: "Bonfire", "ontario-tenders-portal": "Ontario Tenders Portal", "estimating-inbox": "Estimating inbox" } as Record<string, string>)[source] ?? source.replaceAll("-", " "); }
function urgencyLabel(value: string | null): string { return value ? `${value[0].toUpperCase()}${value.slice(1)} urgency` : "Deadline pending"; }

export default function TendersPage() {
  const [view, setView] = useState<"recommended" | "all">("recommended");
  const [rows, setRows] = useState<OrgTender[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(selectedView = view) {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/tenders?view=${selectedView}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load opportunities");
      setRows(payload.tenders ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load opportunities"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(view); }, [view]);
  const filtered = useMemo(() => rows.filter((row) => [row.tenders?.title_en, row.tenders?.title_fr, row.tenders?.buyer_name, row.tenders?.source].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())), [rows, query]);

  async function feedback(tenderId: string, label: "relevant" | "not_relevant") {
    setBusyId(tenderId);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/relevance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save feedback");
      await load(view);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save feedback"); }
    finally { setBusyId(null); }
  }

  return <main className="empty-page opportunities-page">
    <header className="opportunities-header"><div><p className="eyebrow accent">Connected tender intelligence</p><h1>Opportunities your company can act on</h1><p className="empty-page-copy">Every connected and authorized source is scanned on schedule. Your primary feed stays focused on work that fits your trades, people, geography, capacity, and commercial rules.</p></div><a className="secondary-button source-coverage-link" href="/tender-sources">Source coverage →</a></header>
    <section className="opportunity-toolbar" aria-label="Opportunity filters"><div className="view-switch" role="group" aria-label="Feed view"><button className={view === "recommended" ? "active" : ""} onClick={() => setView("recommended")}>Recommended</button><button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All scanned</button></div><label className="opportunity-search"><span className="sr-only">Search opportunities</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search buyer, title, or source" /></label><span className="result-count">{filtered.length} {view === "recommended" ? "qualified" : "scanned"}</span></section>
    {error && <div className="inline-alert error-text" role="alert">{error} <button onClick={() => void load(view)}>Try again</button></div>}
    {loading ? <section className="opportunity-skeletons" aria-label="Loading opportunities">{[1, 2, 3].map((item) => <div className="opportunity-skeleton" key={item} />)}</section> : !filtered.length ? <section className="empty-panel opportunity-empty"><div className="empty-icon">✓</div><h2>{view === "recommended" ? "No qualified opportunity needs attention" : "No tenders match this search"}</h2><p>{view === "recommended" ? "Scanning continues automatically. Complete your operating model to improve matching, or inspect all scanned tenders to train relevance." : "Clear the search or return to the recommended feed."}</p><div className="tender-actions"><a href="/trade-profiles">Review operating model →</a><a href="/tender-sources">Check source health →</a></div></section> : <section className="opportunity-feed">
      {filtered.map((row) => {
        const tender = row.tenders;
        const analysis = row.analysis;
        const score = Math.round(row.match_score ?? analysis?.match_score ?? 0);
        const reasons = (analysis?.reasons ?? []).slice(0, 3);
        const decision = row.decision ?? analysis?.decision ?? (row.status === "no_go" ? "not_viable" : "review");
        const action = row.recommended_action ?? analysis?.recommended_action ?? "Review tender details";
        return <article className="opportunity-card" key={row.tender_id}>
          <div className="opportunity-score"><strong>{score}<small>%</small></strong><span>company fit</span><div className={`decision-pill ${decision}`}>{decision.replace("_", " ")}</div></div>
          <div className="opportunity-body"><div className="opportunity-kicker"><span>{sourceName(tender.source)}</span>{tender.amendment_at && <span className="amendment-chip">Updated</span>}<span>{analysis?.project_type?.replaceAll("-", " ") ?? tender.procurement_category}</span></div><h2><a href={`/tenders/${tender.id}`}>{tender.title_en ?? tender.title_fr ?? "Untitled opportunity"}</a></h2><p className="opportunity-buyer">{tender.buyer_name ?? "Buyer not published"}</p>
            <div className="opportunity-facts"><div><span>Closing</span><strong>{date(tender.closing_at)}</strong><small className={`urgency ${row.urgency ?? analysis?.urgency ?? "normal"}`}>{urgencyLabel(row.urgency ?? analysis?.urgency ?? null)}</small></div><div><span>Published value</span><strong>{money(tender.estimated_value_cents)}</strong><small>Confirm in tender package</small></div><div><span>Estimating effort</span><strong>{row.estimating_effort_minutes ?? analysis?.expected_estimating_effort_minutes ?? 60} min</strong><small>Expected first-review time</small></div><div><span>Document processing</span><strong>{row.processing_job?.stage?.replaceAll("_", " ") ?? "Awaiting scan"}</strong><small>{row.processing_job?.last_error ? "Action required" : row.processing_job?.status ?? "Queued automatically"}</small></div></div>
            <div className="match-explanation"><strong>Why this recommendation</strong>{reasons.length ? <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>Analysis is queued. The card will update as capability and document checks finish.</p>}</div>
            <div className="recommended-action"><span>Recommended next action</span><strong>{action}</strong></div>
            <div className="opportunity-actions"><a className="button" href={`/tenders/${tender.id}`}>Open opportunity</a>{tender.source_url && <a className="secondary-button" href={tender.source_url} target="_blank" rel="noopener noreferrer">View source</a>}<div className="relevance-controls" aria-label="Recommendation feedback"><span>Is this a fit?</span><button disabled={busyId === row.tender_id} className={row.relevance_feedback?.label === "relevant" ? "selected" : ""} onClick={() => void feedback(row.tender_id, "relevant")}>Yes</button><button disabled={busyId === row.tender_id} className={row.relevance_feedback?.label === "not_relevant" ? "selected negative" : ""} onClick={() => void feedback(row.tender_id, "not_relevant")}>No</button></div></div>
          </div>
        </article>;
      })}
    </section>}
  </main>;
}
