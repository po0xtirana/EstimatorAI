"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WorkbookImport = { id: string; file_name: string; status: string; row_count: number; extraction_confidence: number | null; total_amount_cents: number; warnings: string[]; created_at: string; error_message: string | null };
type WorkbookLine = { id: string; source_sheet: string; source_row: number; raw_label: string; normalized_kind: string; amount_cents: number; extraction_confidence: number; review_status: string; mapping_reason: string };
type CategoryComparison = { aiCents: number; estimatorCents: number; varianceCents: number; variancePercent: number | null };
type Comparison = { ai_total_cents: number; estimator_total_cents: number; variance_cents: number; variance_percent: number | null; category_comparison: Record<string, CategoryComparison>; overall_confidence: number; status: string };
type Calibration = { id: string; normalized_kind: string; sample_count: number; weighted_factor: number; applied_factor: number; confidence: number; status: string };
type WorkbookLearning = { imports: WorkbookImport[]; latestImport: WorkbookImport | null; lines: WorkbookLine[]; comparison: Comparison | null; calibrations: Calibration[]; duplicate?: boolean };

const categories = ["labor", "material", "equipment", "subcontractor", "overhead", "risk", "markup", "unknown"];
const categoryLabels: Record<string, string> = { labor: "Labor", material: "Materials", equipment: "Equipment & vehicles", subcontractor: "Subcontractors", overhead: "Overhead & mobilization", risk: "Contingency & risk", markup: "Markup & profit", unknown: "Needs category" };
const money = (cents: number | null | undefined) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(cents ?? 0) / 100);
const signedMoney = (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`;
const signedPercent = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export default function EstimatorWorkbookPanel({ estimateId }: { estimateId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<WorkbookLearning | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kindByLine, setKindByLine] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch(`/api/estimates/${estimateId}/workbooks`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load estimator workbooks");
    setData(payload);
  }, [estimateId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load estimator workbooks")); }, [load]);

  async function upload(file: File) {
    setBusy(true); setMessage(null);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/estimates/${estimateId}/workbooks`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to process workbook");
      setData(payload);
      setMessage(payload.duplicate ? "This workbook was already compared with this estimate." : `Compared ${file.name} with the platform estimate.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to process workbook"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function review(line: WorkbookLine, accepted: boolean) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/estimates/${estimateId}/workbooks`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: line.id, normalizedKind: kindByLine[line.id] ?? line.normalized_kind, accepted }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to review workbook line");
      setData(payload); setMessage(accepted ? "Line accepted and the comparison was recalculated." : "Line excluded from this comparison.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review workbook line"); }
    finally { setBusy(false); }
  }

  const latest = data?.latestImport;
  const comparison = data?.comparison;
  const reviewLines = data?.lines.filter((line) => line.review_status === "needs_review") ?? [];
  const comparisonRows = comparison ? Object.entries(comparison.category_comparison ?? {}).filter(([, value]) => value.aiCents || value.estimatorCents) : [];

  return <section className="profile-card workbook-panel" aria-labelledby="workbook-title">
    <div className="profile-card-heading workbook-heading"><div><p className="eyebrow accent">Estimator comparison</p><h2 id="workbook-title">Drop in the estimator&apos;s Excel workbook</h2><p className="muted">The platform finds cost tables, compares the estimator&apos;s judgment with its own estimate, and builds a company-specific learning signal. No manual re-entry.</p></div>{latest && <span className={`workbook-status ${latest.status}`}>{latest.status === "needs_review" ? "Quick review needed" : latest.status === "processed" ? "Compared" : latest.status}</span>}</div>

    <div className={`workbook-dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
      <div className="workbook-icon" aria-hidden="true">XL</div><div><strong>{busy ? "Reading and comparing the workbook…" : latest ? "Upload another estimator version" : "Drag the estimate workbook here"}</strong><span>.xlsx, .xlsm, or .csv · up to 12 MB</span></div><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Processing" : "Choose file"}</button><input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xlsm,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    <p className="workbook-privacy">The original file is not retained. The platform stores its hash, extracted cost lines, mapping evidence, and comparison history for audit and learning.</p>
    {message && <p className="auth-message" role="status">{message}</p>}

    {latest && <div className="workbook-file-row"><div><strong>{latest.file_name}</strong><span>{latest.row_count} cost lines · {Math.round(Number(latest.extraction_confidence ?? 0))}% extraction confidence · {new Date(latest.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</span></div><strong>{money(latest.total_amount_cents)}</strong></div>}

    {comparison && <>
      <div className="workbook-summary-grid"><article><span>Platform estimate</span><strong>{money(comparison.ai_total_cents)}</strong></article><article><span>Estimator workbook</span><strong>{money(comparison.estimator_total_cents)}</strong></article><article className={comparison.variance_cents > 0 ? "variance-up" : "variance-down"}><span>Estimator variance</span><strong>{signedMoney(comparison.variance_cents)}</strong><small>{signedPercent(comparison.variance_percent)} from platform</small></article><article><span>Comparison confidence</span><strong>{Math.round(Number(comparison.overall_confidence))}%</strong></article></div>
      <div className="workbook-comparison-table" role="table" aria-label="Platform and estimator cost comparison"><div className="workbook-comparison-head" role="row"><span>Cost category</span><span>Platform</span><span>Estimator</span><span>Variance</span></div>{comparisonRows.map(([kind, value]) => <div className="workbook-comparison-row" role="row" key={kind}><strong>{categoryLabels[kind] ?? kind}</strong><span>{money(value.aiCents)}</span><span>{money(value.estimatorCents)}</span><span className={value.varianceCents > 0 ? "variance-up" : value.varianceCents < 0 ? "variance-down" : ""}>{signedMoney(value.varianceCents)} <small>{signedPercent(value.variancePercent)}</small></span></div>)}</div>
    </>}

    {reviewLines.length > 0 && <div className="workbook-review"><div className="workbook-subheading"><div><h3>Confirm {reviewLines.length} uncertain line{reviewLines.length === 1 ? "" : "s"}</h3><p className="muted">Only rows the importer could not classify confidently need attention.</p></div></div>{reviewLines.map((line) => <div className="workbook-review-row" key={line.id}><div><strong>{line.raw_label}</strong><span>{line.source_sheet} · row {line.source_row} · {money(line.amount_cents)} · {Math.round(line.extraction_confidence)}% confidence</span><small>{line.mapping_reason}</small></div><label><span className="sr-only">Cost category for {line.raw_label}</span><select value={kindByLine[line.id] ?? line.normalized_kind} onChange={(event) => setKindByLine((current) => ({ ...current, [line.id]: event.target.value }))}>{categories.map((kind) => <option key={kind} value={kind}>{categoryLabels[kind]}</option>)}</select></label><button className="button" type="button" disabled={busy} onClick={() => review(line, true)}>Accept</button><button className="text-button" type="button" disabled={busy} onClick={() => review(line, false)}>Exclude</button></div>)}</div>}

    {(data?.calibrations.length ?? 0) > 0 && <div className="calibration-section"><div className="workbook-subheading"><div><h3>Company learning</h3><p className="muted">Consistent comparisons become a bounded adjustment on future estimates. Company rates stay unchanged.</p></div></div><div className="calibration-grid">{data?.calibrations.map((model) => <article key={model.id}><div><strong>{categoryLabels[model.normalized_kind] ?? model.normalized_kind}</strong><span className={`calibration-status ${model.status}`}>{model.status === "active" ? "Active" : `${model.sample_count}/3 samples`}</span></div><p>{model.status === "active" ? `${Number(model.applied_factor) >= 1 ? "+" : ""}${((Number(model.applied_factor) - 1) * 100).toFixed(1)}% adjustment` : "Learning pattern"}</p><small>{Math.round(Number(model.confidence))}% model confidence</small></article>)}</div></div>}
  </section>;
}
