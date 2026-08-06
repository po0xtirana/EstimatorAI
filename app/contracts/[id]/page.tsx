"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type CashflowRow = { contract_id: string; month: string; cost_cents: number; billing_cents: number; assumptions: Record<string, unknown> };
type StaffingRow = { contract_id: string; role_key: string; required_headcount: number; available_headcount: number | null };
type Actual = { id: string; actual_kind: string; task_key: string | null; hours: number | null; cost_cents: number | null; quantity: number | null; unit: string | null; occurred_on: string | null; notes: string | null };
type Contract = { id: string; name: string; status: string; tender_id: string | null; estimated_price_cents: number | null; estimated_cost_cents: number | null; duration_months: number | null; cashflow?: CashflowRow[]; staffing?: StaffingRow[] };

const money = (cents: number | null) => cents === null ? "-" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function ContractDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [contract, setContract] = useState<Contract | null>(null);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("labor");
  const [taskKey, setTaskKey] = useState("");
  const [hours, setHours] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [contractResponse, actualsResponse] = await Promise.all([fetch(`/api/contracts/${id}`), fetch(`/api/contracts/${id}/actuals`)]);
    const contractData = await contractResponse.json();
    const actualsData = await actualsResponse.json();
    if (!contractResponse.ok) throw new Error(contractData.error);
    setContract(contractData.contract);
    setActuals(actualsData.actuals ?? []);
  }

  useEffect(() => { if (!id) return; load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load contract")).finally(() => setLoading(false)); }, [id]);

  async function addActual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch(`/api/contracts/${id}/actuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualKind: kind, taskKey: taskKey || null, hours: hours ? Number(hours) : undefined, costCents: cost ? Math.round(Number(cost) * 100) : undefined, notes: notes || null }) });
    const data = await response.json();
    if (!response.ok) setError(data.error);
    else { setTaskKey(""); setHours(""); setCost(""); setNotes(""); await load(); }
    setSaving(false);
  }

  if (loading) return <main className="empty-page"><p className="eyebrow accent">Contract detail</p><h1>Editable contract workspace</h1><p>Loading...</p></main>;
  if (error || !contract) return <main className="empty-page"><p className="eyebrow accent">Contract detail</p><h1>Editable contract workspace</h1><p className="error-text">{error ?? "Contract not found"}</p></main>;

  const actualCostCents = actuals.reduce((sum, actual) => sum + (actual.cost_cents ?? 0), 0);
  const actualHours = actuals.reduce((sum, actual) => sum + (actual.hours ?? 0), 0);
  const costVarianceCents = contract.estimated_cost_cents === null ? null : actualCostCents - contract.estimated_cost_cents;

  return <main className="empty-page">
    <p className="eyebrow accent">Contract detail</p><h1>{contract.name}</h1><p className="empty-page-copy">Status: {contract.status}</p>
    <div className="detail-grid">
      <div className="empty-panel"><h2>Estimate assumptions</h2><p>Estimated price: {money(contract.estimated_price_cents)}</p><p>Estimated cost: {money(contract.estimated_cost_cents)}</p><p>Duration: {contract.duration_months ?? "-"} months</p></div>
      <div className="empty-panel"><h2>Staffing plan</h2>{contract.staffing?.length ? contract.staffing.map((row) => <p key={row.role_key}>{row.role_key}: {row.required_headcount} required{row.available_headcount !== null ? ` / ${row.available_headcount} available` : ""}</p>) : <p>Not configured</p>}</div>
      <div className="empty-panel"><h2>Monthly cashflow</h2>{contract.cashflow?.length ? contract.cashflow.map((row) => <div key={row.month} className="cashflow-row"><span>{new Date(row.month + "-01").toLocaleDateString("en-CA", { month: "short", year: "numeric" })}</span><span>Cost: {money(row.cost_cents)}</span><span>Billing: {money(row.billing_cents)}</span></div>) : <p>Not configured</p>}</div>
    </div>
    <section className="profile-card actuals-card"><div className="profile-card-heading"><div><h2>Actual job results</h2><p className="muted">Capture what really happened so future company assumptions can improve without changing this estimate.</p></div><span className="status-pill">{actuals.length} recorded</span></div>
      <div className="actual-summary"><div><span>Actual cost</span><strong>{money(actualCostCents)}</strong></div><div><span>Actual hours</span><strong>{actualHours.toFixed(1)} h</strong></div><div><span>Cost variance</span><strong className={costVarianceCents !== null && costVarianceCents > 0 ? "variance-negative" : "variance-positive"}>{costVarianceCents === null ? "-" : `${costVarianceCents > 0 ? "+" : ""}${money(costVarianceCents)}`}</strong></div></div>
      {actuals.map((actual) => <div className="input-row" key={actual.id}><div><span>{actual.actual_kind}{actual.task_key ? ` - ${actual.task_key}` : ""}</span><small>{actual.occurred_on ?? "Date not set"}{actual.hours !== null ? ` - ${actual.hours} hours` : ""}{actual.notes ? ` - ${actual.notes}` : ""}</small></div><strong>{money(actual.cost_cents)}</strong></div>)}
      <form className="stack-form" onSubmit={addActual}><div className="form-grid"><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="labor">Labor</option><option value="material">Material</option><option value="equipment">Equipment</option><option value="vehicle">Vehicle</option><option value="subcontractor">Subcontractor</option><option value="schedule">Schedule</option><option value="change_order">Change order</option><option value="rework">Rework</option></select><input value={taskKey} onChange={(event) => setTaskKey(event.target.value)} placeholder="Task or resource key" /></div><div className="form-grid"><input type="number" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="Actual hours" /><input type="number" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Actual cost (CAD)" /></div><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes, change-order context, or production conditions" /><button className="text-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Record actual result ->"}</button></form>
    </section>
  </main>;
}
