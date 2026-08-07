"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Estimate = { id: string; status: string; recommended_price_cents: number; labor_subtotal_cents: number; material_subtotal_cents: number; equipment_subtotal_cents: number; overhead_subtotal_cents: number; risk_reserve_cents: number; markup_cents: number; confidence_score: number | null; bid_score: number | null; schedule_days: number | null; trade_profiles?: { name: string }; tenders?: { title_en: string | null } };
type Line = { id: string; kind: string; label: string; quantity: number; unit: string; amount_cents: number; confidence: number | null; formula: string | null; source_type: string; source_page: number | null; evidence_text: string | null };
type Exception = { id: string; title: string; message: string; severity: string; resolved: boolean };

const money = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function EstimateDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`/api/estimates/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setEstimate(data.estimate); setLines(data.lines ?? []); setExceptions(data.exceptions ?? []);
  }

  useEffect(() => { if (id) load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load estimate")); }, [id]);

  async function resolve(exceptionId: string) {
    const response = await fetch(`/api/estimates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exceptionId, resolved: true, resolution: "Reviewed by estimator" }) });
    if (response.ok) await load(); else { const data = await response.json(); setMessage(data.error ?? "Unable to resolve exception"); }
  }

  async function approve() {
    const response = await fetch(`/api/estimates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
    const data = await response.json();
    if (!response.ok) setMessage(data.error ?? "Unable to approve estimate"); else { setMessage("Estimate approved for bid preparation."); await load(); }
  }

  if (!estimate) return <main className="empty-page"><p className="eyebrow accent">Estimate review</p><h1>Loading estimate</h1><p>{message ?? "Generating the review workspace..."}</p></main>;
  const openBlocking = exceptions.some((exception) => !exception.resolved && exception.severity === "blocking");
  return <main className="empty-page"><div className="profile-header"><div><p className="eyebrow accent">{estimate.trade_profiles?.name ?? "Trade estimate"}</p><h1>{estimate.tenders?.title_en ?? "Tender estimate"}</h1><p className="empty-page-copy">Review the exceptions and evidence before approving this draft bid.</p></div><button className="button" type="button" onClick={approve} disabled={openBlocking || estimate.status === "approved"}>Approve estimate →</button></div>{message && <p className="auth-message" role="status">{message}</p>}<div className="estimate-metric-grid"><Metric label="Recommended price" value={money(estimate.recommended_price_cents)} /><Metric label="Confidence" value={estimate.confidence_score === null ? "—" : `${Math.round(estimate.confidence_score)}%`} /><Metric label="Bid score" value={estimate.bid_score === null ? "—" : `${Math.round(estimate.bid_score)}%`} /><Metric label="Schedule" value={estimate.schedule_days === null ? "—" : `${estimate.schedule_days} days`} /></div><section className="profile-card"><div className="profile-card-heading"><div><h2>Review queue</h2><p className="muted">Resolve blocking items before approving the estimate.</p></div><span className="status-pill">{exceptions.filter((exception) => !exception.resolved).length} open</span></div>{exceptions.length ? exceptions.map((exception) => <div className={`exception-row ${exception.severity}`} key={exception.id}><div><strong>{exception.title}</strong><p>{exception.message}</p></div>{exception.resolved ? <span className="status-pill">Resolved</span> : <button className="text-button" type="button" onClick={() => resolve(exception.id)}>Mark reviewed</button>}</div>) : <p className="muted">No exceptions were generated.</p>}</section><section className="profile-card"><div className="profile-card-heading"><div><h2>Evidence-backed estimate lines</h2><p className="muted">Every line identifies whether it came from tender evidence or a company assumption.</p></div></div><div className="estimate-lines">{lines.map((line) => <div className="estimate-line" key={line.id}><div><strong>{line.label}</strong><small>{line.kind} · {line.quantity} {line.unit} · {line.source_type}{line.source_page ? ` · page ${line.source_page}` : ""}</small>{line.evidence_text && <small className="evidence-text">Evidence: {line.evidence_text}</small>}</div><span>{money(line.amount_cents)}</span></div>)}</div></section><section className="detail-grid"><div className="empty-panel"><h2>Cost summary</h2><p>Labor: {money(estimate.labor_subtotal_cents)}</p><p>Materials: {money(estimate.material_subtotal_cents)}</p><p>Equipment: {money(estimate.equipment_subtotal_cents)}</p><p>Overhead: {money(estimate.overhead_subtotal_cents)}</p><p>Risk reserve: {money(estimate.risk_reserve_cents)}</p><p>Markup: {money(estimate.markup_cents)}</p></div><div className="empty-panel"><h2>Next step</h2><p>After award, record actual labor, purchasing, equipment, schedule, and change-order results against the contract to improve future defaults.</p><a href="/reports">Open portfolio reports →</a></div></section></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><p className="muted">{label}</p><strong>{value}</strong></article>; }
