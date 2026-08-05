"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type CashflowRow = {
  contract_id: string;
  month: string;
  cost_cents: number;
  billing_cents: number;
  assumptions: Record<string, unknown>;
};

type StaffingRow = {
  contract_id: string;
  role_key: string;
  required_headcount: number;
  available_headcount: number | null;
};

type Contract = {
  id: string;
  name: string;
  status: string;
  tender_id: string | null;
  estimated_price_cents: number | null;
  estimated_cost_cents: number | null;
  duration_months: number | null;
  cashflow?: CashflowRow[];
  staffing?: StaffingRow[];
};

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export default function ContractDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/contracts/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setContract(data.contract);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load contract");
      } finally {
        setLoading(false);
      }
    }
    if (id) load();
  }, [id]);

  if (loading) {
    return <main className="empty-page"><p className="eyebrow accent">Contract detail</p><h1>Editable contract workspace</h1><p>Loading…</p></main>;
  }

  if (error) {
    return <main className="empty-page"><p className="eyebrow accent">Contract detail</p><h1>Editable contract workspace</h1><p className="error-text">{error}</p></main>;
  }

  if (!contract) {
    return <main className="empty-page"><p className="eyebrow accent">Contract detail</p><h1>Editable contract workspace</h1><p className="empty-page-copy">This view will combine assumptions, cost breakdown, staffing, match reasoning, and monthly cashflow for one contract.</p><div className="detail-grid"><div className="empty-panel"><h2>Estimate assumptions</h2><p>Not configured</p></div><div className="empty-panel"><h2>Go / no-go reasoning</h2><p>Not configured</p></div><div className="empty-panel"><h2>Monthly cashflow</h2><p>Not configured</p></div></div></main>;
  }

  const cashflow = contract.cashflow ?? [];
  const staffing = contract.staffing ?? [];

  return (
    <main className="empty-page">
      <p className="eyebrow accent">Contract detail</p>
      <h1>{contract.name}</h1>
      <p className="empty-page-copy">Status: {contract.status}</p>

      <div className="detail-grid">
        <div className="empty-panel">
          <h2>Estimate assumptions</h2>
          <p>Estimated price: {formatCents(contract.estimated_price_cents)}</p>
          <p>Estimated cost: {formatCents(contract.estimated_cost_cents)}</p>
          <p>Duration: {contract.duration_months ?? "—"} months</p>
        </div>

        <div className="empty-panel">
          <h2>Staffing plan</h2>
          {staffing.length > 0 ? staffing.map((row) => (
            <p key={row.role_key}>{row.role_key}: {row.required_headcount} required{row.available_headcount !== null ? ` / ${row.available_headcount} available` : ""}</p>
          )) : <p>Not configured</p>}
        </div>

        <div className="empty-panel">
          <h2>Monthly cashflow</h2>
          {cashflow.length > 0 ? cashflow.map((row) => (
            <div key={row.month} className="cashflow-row">
              <span>{new Date(row.month + "-01").toLocaleDateString("en-CA", { month: "short", year: "numeric" })}</span>
              <span>Cost: {formatCents(row.cost_cents)}</span>
              <span>Billing: {formatCents(row.billing_cents)}</span>
            </div>
          )) : <p>Not configured</p>}
        </div>
      </div>
    </main>
  );
}
