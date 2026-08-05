"use client";

import { useEffect, useState } from "react";

type Report = { contracts: Array<{ id: string; name: string; status: string }>; totals: { priceCents: number; costCents: number; marginCents: number }; monthly: Array<{ month: string; costCents: number; billingCents: number; netCashflowCents: number }> };
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);

export default function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/reports").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to load reports"); setReport(data); }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load reports")); }, []);
  if (error) return <main className="empty-page"><p className="eyebrow accent">Financial reporting</p><h1>Portfolio reports</h1><p className="error-text">{error}</p></main>;
  if (!report) return <main className="empty-page"><p className="eyebrow accent">Financial reporting</p><h1>Portfolio reports</h1><p>Loading report data...</p></main>;
  if (!report.contracts.length) return <main className="empty-page"><p className="eyebrow accent">Financial reporting</p><h1>Portfolio reports</h1><p className="empty-page-copy">Monthly cashflow, projected margin, and portfolio rollups are calculated from saved contract assumptions.</p><div className="empty-panel"><div className="empty-icon">Sum</div><h2>Reports will appear after your first contract</h2><p>Every figure will link back to editable estimate lines and monthly assumptions.</p><a href="/trade-profiles">Set up your operating model -&gt;</a></div></main>;
  return <main className="empty-page"><p className="eyebrow accent">Financial reporting</p><h1>Portfolio reports</h1><p className="empty-page-copy">A traceable view of saved contract assumptions and projected cashflow.</p><div className="report-metrics"><Metric label="Estimated revenue" value={money(report.totals.priceCents)} /><Metric label="Estimated cost" value={money(report.totals.costCents)} /><Metric label="Projected margin" value={money(report.totals.marginCents)} /></div><section className="report-card"><div className="section-heading"><div><p className="eyebrow">Monthly view</p><h2>Projected cashflow</h2></div></div>{report.monthly.length ? report.monthly.map((row) => <div className="report-row" key={row.month}><span>{new Date(`${row.month}-01`).toLocaleDateString("en-CA", { month: "short", year: "numeric" })}</span><span>Cost {money(row.costCents)}</span><span>Billing {money(row.billingCents)}</span><strong>{money(row.netCashflowCents)}</strong></div>) : <p className="muted">No monthly cashflow has been entered yet.</p>}</section><section className="report-card"><div className="section-heading"><div><p className="eyebrow">Contracts</p><h2>Estimate portfolio</h2></div></div>{report.contracts.map((contract) => <a className="report-row report-link" href={`/contracts/${contract.id}`} key={contract.id}><span>{contract.name}</span><span className="muted">{contract.status}</span><span>Open detail -&gt;</span></a>)}</section></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="metric"><p className="muted">{label}</p><strong>{value}</strong></article>; }
