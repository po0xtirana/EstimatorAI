"use client";

import { useEffect, useState } from "react";

type Tender = {
  id: string;
  title_en: string | null;
  title_fr: string | null;
  buyer_name: string | null;
  published_at: string | null;
  closing_at: string | null;
  estimated_value_cents: number | null;
  procurement_category: string;
  source_url: string | null;
};

type OrgTender = {
  tender_id: string;
  match_score: number | null;
  status: string;
  tenders: Tender;
  team_fit_score: number | null;
};

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function TendersPage() {
  const [tenders, setTenders] = useState<OrgTender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/tenders");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setTenders(data.tenders ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load tenders");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <main className="empty-page"><p className="eyebrow accent">Tender feed</p><h1>CanadaBuys opportunities</h1><p>Loading tenders…</p></main>;
  }

  if (error) {
    return <main className="empty-page"><p className="eyebrow accent">Tender feed</p><h1>CanadaBuys opportunities</h1><p className="error-text">{error}</p><p>Sign in to your workspace to see matching tenders.</p></main>;
  }

  if (!tenders.length) {
    return (
      <main className="empty-page">
        <p className="eyebrow accent">Tender feed</p>
        <h1>CanadaBuys opportunities</h1>
        <p className="empty-page-copy">The complete CanadaBuys feed refreshes automatically every day. EstimatorAI scans every tender, then shows only the opportunities that match your company capabilities.</p>
        <div className="empty-panel">
          <div className="empty-icon">⌁</div>
          <h2>No capability matches yet</h2>
          <p>The daily worker ingests every CanadaBuys tender and hides opportunities that do not match your configured trades, geography, certifications, bonding, or available capacity. No tender upload is required.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="empty-page">
      <p className="eyebrow accent">Tender feed</p>
      <h1>CanadaBuys opportunities</h1>
      <p className="empty-page-copy">{tenders.length} matched opportunities from the automated daily CanadaBuys feed. Newest publication dates appear first.</p>
      <div className="tender-list">
        {tenders.map((orgTender) => {
          const t = orgTender.tenders;
          const title = t.title_en ?? t.title_fr ?? "Untitled tender";
          const score = orgTender.match_score;
          const teamFit = orgTender.team_fit_score;
          return (
            <article className="tender-card" key={t.id}>
              <div className="tender-head">
                <h2>{title}</h2>
                <div className="tender-badges">{score !== null && <span className="match-badge">Match {Math.round(score)}%</span>}{teamFit !== null && <span className="match-badge team-fit-badge">Team fit {Math.round(teamFit)}%</span>}</div>
              </div>
              {t.title_en && t.title_fr && <p className="muted">FR: {t.title_fr}</p>}
              <div className="tender-meta">
                <span>Buyer: {t.buyer_name ?? "—"}</span>
                <span>Published: {formatDate(t.published_at)}</span>
                <span>Closes: {formatDate(t.closing_at)}</span>
                <span>Value: {formatCents(t.estimated_value_cents)}</span>
                <span>Status: {orgTender.status}</span>
              </div>
              <div className="tender-actions"><a href={`/tenders/${t.id}`}>Build estimate →</a>{t.source_url && <a href={t.source_url} target="_blank" rel="noopener noreferrer">View source →</a>}</div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
