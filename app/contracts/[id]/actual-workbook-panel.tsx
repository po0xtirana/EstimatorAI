"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WorkbookLine = { id: string; raw_label: string; normalized_kind: string; source_sheet: string; source_row: number; amount_cents: number; extraction_confidence: number; review_status: string; mapping_reason: string };
type WorkbookImport = { id: string; file_name: string; status: string; reconciliation_status: string; row_count: number; total_amount_cents: number; control_total_cents: number | null; reconciled_total_cents: number | null; extraction_confidence: number; version_number: number; warnings: string[]; superseded_by: string | null; created_at: string };
type WorkbookData = { imports: WorkbookImport[]; latestImport: WorkbookImport | null; lines: WorkbookLine[] };

const categories = ["labor", "material", "equipment", "subcontractor", "overhead", "unknown"];
const labels: Record<string, string> = { labor: "Labor", material: "Materials", equipment: "Equipment / vehicles", subcontractor: "Subcontractors", overhead: "Project overhead", unknown: "Exclude / unknown" };
const money = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function ActualWorkbookPanel({ jobId, jobComplete }: { jobId: string; jobComplete: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<WorkbookData | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [finalReconciled, setFinalReconciled] = useState(jobComplete);
  const [controlTotal, setControlTotal] = useState("");
  const [kindByLine, setKindByLine] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/jobs/${jobId}/actual-workbooks`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load job-cost workbooks");
    setData(payload);
  }, [jobId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load job-cost workbooks")); }, [load]);

  async function upload(file: File) {
    setBusy(true); setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("finalReconciled", String(finalReconciled));
      if (controlTotal) form.append("controlTotalCents", String(Math.round(Number(controlTotal) * 100)));
      const response = await fetch(`/api/jobs/${jobId}/actual-workbooks`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to process the job-cost workbook");
      setData(payload);
      setMessage(payload.duplicate ? "This workbook version was already imported." : `Imported ${file.name}; accepted rows updated the company learning model automatically.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to process the job-cost workbook"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function review(line: WorkbookLine, accepted: boolean) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/actual-workbooks`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: line.id, normalizedKind: kindByLine[line.id] ?? line.normalized_kind, accepted }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to review this workbook line");
      setData(payload); setMessage(accepted ? "Line accepted and the active learning model was updated." : "Line excluded from learning.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review this workbook line"); }
    finally { setBusy(false); }
  }

  const latest = data?.latestImport;
  const reviewLines = data?.lines.filter((line) => line.review_status === "needs_review") ?? [];
  return <section className="profile-card workbook-panel actual-workbook-panel" aria-labelledby="actual-workbook-title">
    <div className="profile-card-heading workbook-heading"><div><p className="eyebrow accent">Automatic actuals</p><h2 id="actual-workbook-title">Drop in the final job-cost workbook</h2><p className="muted">EstimatorAI reads payroll hours, purchases, equipment, subcontractors, and overhead, compares them with the original estimate, then updates future estimates automatically.</p></div>{latest && <span className={`workbook-status ${latest.status}`}>{latest.status === "needs_review" ? "Quick review needed" : latest.reconciliation_status === "reconciled" ? "Reconciled" : "Partially reconciled"}</span>}</div>
    <div className="actual-import-controls"><label className="check-field"><input type="checkbox" checked={finalReconciled} onChange={(event) => setFinalReconciled(event.target.checked)} /><span><strong>This is the final reconciled job-cost report</strong><small>Completed-job actuals receive the strongest learning weight.</small></span></label><label className="form-field compact-field"><span>Workbook control total (optional, CAD)</span><input type="number" min="0" step="0.01" value={controlTotal} onChange={(event) => setControlTotal(event.target.value)} placeholder="e.g. 128450.00" /></label></div>
    <div className={`workbook-dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
      <div className="workbook-icon" aria-hidden="true">XL</div><div><strong>{busy ? "Reading, reconciling, and learning…" : latest ? "Upload a revised final workbook" : "Drag the completed job workbook here"}</strong><span>.xlsx, .xlsm, or .csv · up to 12 MB · original file is not retained</span></div><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Processing" : "Choose file"}</button><input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.xlsm,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    {message && <p className="auth-message" role="status">{message}</p>}
    {latest && <div className="workbook-file-row"><div><strong>Version {latest.version_number} · {latest.file_name}</strong><span>{latest.row_count} extracted lines · {Math.round(Number(latest.extraction_confidence ?? 0))}% extraction confidence · {new Date(latest.created_at).toLocaleDateString("en-CA")}</span></div><div className="actual-import-totals"><small>Accepted / control total</small><strong>{money(latest.reconciled_total_cents)} / {money(latest.control_total_cents)}</strong></div></div>}
    {latest?.warnings?.length ? <div className="workbook-warnings">{latest.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div> : null}
    {reviewLines.length > 0 && <div className="workbook-review"><div className="workbook-subheading"><div><h3>Confirm {reviewLines.length} uncertain cost line{reviewLines.length === 1 ? "" : "s"}</h3><p className="muted">Only ambiguous rows need attention. Accepted rows immediately update the active model.</p></div></div>{reviewLines.map((line) => <div className="workbook-review-row" key={line.id}><div><strong>{line.raw_label}</strong><span>{line.source_sheet} · row {line.source_row} · {money(line.amount_cents)} · {Math.round(line.extraction_confidence)}% confidence</span><small>{line.mapping_reason}</small></div><label><span className="sr-only">Cost category for {line.raw_label}</span><select value={kindByLine[line.id] ?? line.normalized_kind} onChange={(event) => setKindByLine((current) => ({ ...current, [line.id]: event.target.value }))}>{categories.map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label><button className="button" type="button" disabled={busy} onClick={() => review(line, true)}>Accept</button><button className="text-button" type="button" disabled={busy} onClick={() => review(line, false)}>Exclude</button></div>)}</div>}
    {(data?.imports.length ?? 0) > 1 && <div className="learning-history"><strong>Import history</strong>{data?.imports.map((item) => <small key={item.id}>Version {item.version_number}: {item.file_name} · {item.superseded_by ? "superseded" : item.reconciliation_status}</small>)}</div>}
  </section>;
}
