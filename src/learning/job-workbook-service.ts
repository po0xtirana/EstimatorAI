import { createHash } from "node:crypto";
import { parseEstimatorWorkbook, WORKBOOK_PARSER_VERSION, type ParsedWorkbookLine, type WorkbookKind } from "./estimator-workbook";
import { recordActualLearningEvidence, refreshLearningModel } from "./learning-service";
import { applyRememberedWorkbookMapping, rememberReviewedCostCode, rememberWorkbookMapping } from "./workbook-service";

const actualKinds = new Set<WorkbookKind>(["labor", "material", "equipment", "subcontractor", "overhead"]);

function actualRow(organizationId: string, contractId: string, estimateRunId: string, workbookImportId: string, workbookLineId: string, line: ParsedWorkbookLine, reconciliationStatus: "partial" | "reconciled") {
  return {
    organization_id: organizationId,
    contract_id: contractId,
    estimate_run_id: estimateRunId,
    workbook_import_id: workbookImportId,
    workbook_line_id: workbookLineId,
    actual_kind: line.normalizedKind,
    task_key: line.taskKey,
    resource_key: line.resourceKey,
    quantity: line.quantity,
    unit: line.unit,
    hours: line.hours,
    cost_cents: line.amountCents + Number(line.taxCents ?? 0),
    occurred_on: line.occurredOn ?? new Date().toISOString().slice(0, 10),
    reconciliation_status: reconciliationStatus,
    event_classification: "baseline",
    quality_score: line.extractionConfidence,
    notes: `${line.sourceSheet}, row ${line.sourceRow}${line.costCode ? ` · cost code ${line.costCode}` : ""}`
  };
}

async function contractEstimate(admin: any, organizationId: string, contractId: string) {
  const contractResult = await admin.from("contracts").select("id, tender_id, status, name").eq("id", contractId).eq("organization_id", organizationId).maybeSingle();
  if (contractResult.error || !contractResult.data) throw new Error("Job not found");
  if (!contractResult.data.tender_id) throw new Error("Link this job to its tender estimate before importing final costs");
  const estimateResult = await admin.from("estimate_runs").select("id, trade_profile_id").eq("organization_id", organizationId).eq("tender_id", contractResult.data.tender_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (estimateResult.error || !estimateResult.data) throw new Error("No original estimate is linked to this job");
  return { contract: contractResult.data, estimate: estimateResult.data };
}

async function insertWorkbookLines(admin: any, organizationId: string, workbookImportId: string, lines: ParsedWorkbookLine[]) {
  const result = await admin.from("estimator_workbook_lines").insert(lines.map((line) => ({
    organization_id: organizationId,
    workbook_import_id: workbookImportId,
    source_sheet: line.sourceSheet,
    source_row: line.sourceRow,
    source_range: line.sourceRange,
    raw_label: line.rawLabel,
    normalized_kind: line.normalizedKind,
    task_key: line.taskKey,
    resource_key: line.resourceKey,
    cost_code: line.costCode,
    quantity: line.quantity,
    unit: line.unit,
    hours: line.hours,
    unit_cost_cents: line.unitCostCents,
    tax_cents: line.taxCents,
    currency_code: line.currencyCode,
    occurred_on: line.occurredOn,
    amount_cents: line.amountCents,
    extraction_confidence: line.extractionConfidence,
    review_status: line.reviewStatus,
    mapping_reason: line.mappingReason,
    raw_row: line.rawRow
  }))).select("*");
  if (result.error) throw new Error("Failed to save extracted job-cost lines");
  return result.data ?? [];
}

export async function importActualJobWorkbook(admin: any, options: {
  organizationId: string;
  authSubject: string;
  contractId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  finalReconciled: boolean;
  controlTotalCents?: number | null;
}) {
  const { contract, estimate } = await contractEstimate(admin, options.organizationId, options.contractId);
  const fileHash = createHash("sha256").update(options.buffer).digest("hex");
  const duplicate = await admin.from("estimator_workbook_imports").select("*").eq("organization_id", options.organizationId).eq("contract_id", options.contractId).eq("purpose", "job_actual").eq("file_hash", fileHash).maybeSingle();
  if (duplicate.data) return { workbookImport: duplicate.data, duplicate: true };
  const previous = await admin.from("estimator_workbook_imports").select("id, version_number").eq("organization_id", options.organizationId).eq("contract_id", options.contractId).eq("purpose", "job_actual").is("superseded_by", null).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const versionNumber = Number(previous.data?.version_number ?? 0) + 1;
  const importResult = await admin.from("estimator_workbook_imports").insert({
    organization_id: options.organizationId,
    estimate_run_id: estimate.id,
    contract_id: options.contractId,
    trade_profile_id: estimate.trade_profile_id,
    uploaded_by: options.authSubject,
    file_name: options.fileName,
    file_hash: fileHash,
    mime_type: options.mimeType || null,
    file_size_bytes: options.buffer.length,
    purpose: "job_actual",
    version_number: versionNumber,
    reconciliation_status: options.finalReconciled ? "reconciled" : "partial",
    status: "processing",
    parser_version: WORKBOOK_PARSER_VERSION
  }).select("*").single();
  if (importResult.error || !importResult.data) throw new Error("Failed to register the job-cost workbook");
  const importId = importResult.data.id;
  try {
    const parsed = await applyRememberedWorkbookMapping(admin, options.organizationId, "job_actual", await parseEstimatorWorkbook(options.buffer, options.fileName));
    await rememberWorkbookMapping(admin, options.organizationId, "job_actual", parsed);
    const savedLines = await insertWorkbookLines(admin, options.organizationId, importId, parsed.lines);
    const acceptedLines = savedLines.filter((row: any) => row.review_status !== "needs_review" && actualKinds.has(row.normalized_kind));
    const acceptedTotal = acceptedLines.reduce((sum: number, row: any) => sum + Number(row.amount_cents ?? 0) + Number(row.tax_cents ?? 0), 0);
    const controlTotal = options.controlTotalCents ?? parsed.totalAmountCents;
    const difference = Math.abs(controlTotal - acceptedTotal);
    const reconciled = options.finalReconciled && difference <= Math.max(100, controlTotal * 0.01) && acceptedLines.length > 0;
    const reconciliationStatus: "partial" | "reconciled" = reconciled ? "reconciled" : "partial";
    const actualInsert = acceptedLines.length ? await admin.from("contract_actuals").insert(acceptedLines.map((row: any) => actualRow(options.organizationId, options.contractId, estimate.id, importId, row.id, {
      sourceSheet: row.source_sheet,
      sourceRow: Number(row.source_row),
      sourceRange: row.source_range,
      rawLabel: row.raw_label,
      normalizedKind: row.normalized_kind,
      taskKey: row.task_key,
      resourceKey: row.resource_key,
      costCode: row.cost_code,
      quantity: row.quantity === null ? null : Number(row.quantity),
      unit: row.unit,
      hours: row.hours === null ? null : Number(row.hours),
      unitCostCents: row.unit_cost_cents === null ? null : Number(row.unit_cost_cents),
      taxCents: row.tax_cents === null ? null : Number(row.tax_cents),
      currencyCode: row.currency_code ?? "CAD",
      occurredOn: row.occurred_on,
      amountCents: Number(row.amount_cents),
      extractionConfidence: Number(row.extraction_confidence),
      reviewStatus: row.review_status,
      mappingReason: row.mapping_reason,
      rawRow: row.raw_row ?? []
    }, reconciliationStatus))).select("*") : { data: [], error: null };
    if (actualInsert.error) throw new Error("Failed to create job actuals from the workbook");

    if (previous.data?.id) {
      await admin.from("estimator_workbook_imports").update({ superseded_by: importId, updated_at: new Date().toISOString() }).eq("id", previous.data.id).eq("organization_id", options.organizationId);
      await admin.from("contract_actuals").update({ reconciliation_status: "rejected" }).eq("organization_id", options.organizationId).eq("workbook_import_id", previous.data.id);
      await admin.from("learning_evidence").update({ status: "superseded" }).eq("organization_id", options.organizationId).eq("workbook_import_id", previous.data.id).eq("status", "accepted");
    }
    for (const actual of actualInsert.data ?? []) await recordActualLearningEvidence(admin, { organizationId: options.organizationId, contractId: options.contractId, actual, createdBy: options.authSubject, deferRefresh: true });
    const model = await refreshLearningModel(admin, options.organizationId, estimate.trade_profile_id, options.authSubject);
    const reviewCount = savedLines.filter((row: any) => row.review_status === "needs_review").length;
    const status = reviewCount ? "needs_review" : "processed";
    const update = await admin.from("estimator_workbook_imports").update({
      status,
      reconciliation_status: reconciliationStatus,
      workbook_metadata: { ...parsed.metadata, contractName: contract.name },
      mapping_metadata: parsed.mappingMetadata,
      category_totals: parsed.categoryTotals,
      warnings: [...parsed.warnings, ...(!reconciled && options.finalReconciled ? [`Accepted lines differ from the control total by $${(difference / 100).toFixed(2)}; learning was weighted as partial.`] : [])],
      row_count: parsed.lines.length,
      total_amount_cents: parsed.totalAmountCents,
      control_total_cents: controlTotal,
      reconciled_total_cents: acceptedTotal,
      extraction_confidence: parsed.extractionConfidence,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", importId).eq("organization_id", options.organizationId).select("*").single();
    if (update.error || !update.data) throw new Error("Failed to finalize the job-cost import");
    return { workbookImport: update.data, lines: savedLines, actuals: actualInsert.data ?? [], model, duplicate: false };
  } catch (error) {
    await admin.from("estimator_workbook_imports").update({ status: "failed", error_message: error instanceof Error ? error.message : "Job-cost workbook processing failed", updated_at: new Date().toISOString() }).eq("id", importId).eq("organization_id", options.organizationId);
    throw error;
  }
}

export async function loadActualJobWorkbook(admin: any, organizationId: string, contractId: string) {
  const imports = await admin.from("estimator_workbook_imports").select("*").eq("organization_id", organizationId).eq("contract_id", contractId).eq("purpose", "job_actual").order("version_number", { ascending: false }).limit(10);
  if (imports.error) throw new Error("Failed to load job-cost workbook history");
  const latest = imports.data?.[0] ?? null;
  const lines = latest ? await admin.from("estimator_workbook_lines").select("*").eq("organization_id", organizationId).eq("workbook_import_id", latest.id).order("source_sheet, source_row") : { data: [], error: null };
  if (lines.error) throw new Error("Failed to load extracted job-cost lines");
  return { imports: imports.data ?? [], latestImport: latest, lines: lines.data ?? [] };
}

export async function reviewActualJobWorkbookLine(admin: any, options: {
  organizationId: string;
  authSubject: string;
  contractId: string;
  lineId: string;
  normalizedKind: WorkbookKind;
  accepted: boolean;
}) {
  const lineResult = await admin.from("estimator_workbook_lines").select("*").eq("id", options.lineId).eq("organization_id", options.organizationId).maybeSingle();
  if (lineResult.error || !lineResult.data) throw new Error("Workbook line not found");
  const line = lineResult.data;
  const importResult = await admin.from("estimator_workbook_imports").select("*").eq("id", line.workbook_import_id).eq("organization_id", options.organizationId).eq("contract_id", options.contractId).eq("purpose", "job_actual").maybeSingle();
  if (importResult.error || !importResult.data) throw new Error("Job-cost workbook not found");
  const workbookImport = importResult.data;
  const reviewStatus = options.accepted ? "accepted" : "rejected";
  const update = await admin.from("estimator_workbook_lines").update({ normalized_kind: options.normalizedKind, review_status: reviewStatus }).eq("id", options.lineId).eq("organization_id", options.organizationId).select("*").single();
  if (update.error || !update.data) throw new Error("Failed to review the job-cost line");
  if (options.accepted) await rememberReviewedCostCode(admin, options.organizationId, "job_actual", workbookImport.mapping_metadata, line.cost_code, options.normalizedKind);
  const existingActual = await admin.from("contract_actuals").select("*").eq("organization_id", options.organizationId).eq("workbook_line_id", options.lineId).maybeSingle();
  if (!options.accepted || !actualKinds.has(options.normalizedKind)) {
    if (existingActual.data) {
      await admin.from("contract_actuals").update({ reconciliation_status: "rejected" }).eq("id", existingActual.data.id).eq("organization_id", options.organizationId);
      await admin.from("learning_evidence").update({ status: "superseded" }).eq("contract_actual_id", existingActual.data.id).eq("organization_id", options.organizationId).eq("status", "accepted");
      await refreshLearningModel(admin, options.organizationId, workbookImport.trade_profile_id, options.authSubject);
    }
  } else if (!existingActual.data) {
    const parsed: ParsedWorkbookLine = {
      sourceSheet: update.data.source_sheet,
      sourceRow: Number(update.data.source_row),
      sourceRange: update.data.source_range,
      rawLabel: update.data.raw_label,
      normalizedKind: options.normalizedKind,
      taskKey: update.data.task_key,
      resourceKey: update.data.resource_key,
      costCode: update.data.cost_code,
      quantity: update.data.quantity === null ? null : Number(update.data.quantity),
      unit: update.data.unit,
      hours: update.data.hours === null ? null : Number(update.data.hours),
      unitCostCents: update.data.unit_cost_cents === null ? null : Number(update.data.unit_cost_cents),
      taxCents: update.data.tax_cents === null ? null : Number(update.data.tax_cents),
      currencyCode: update.data.currency_code ?? "CAD",
      occurredOn: update.data.occurred_on,
      amountCents: Number(update.data.amount_cents),
      extractionConfidence: Math.max(80, Number(update.data.extraction_confidence)),
      reviewStatus: "auto_accepted",
      mappingReason: update.data.mapping_reason,
      rawRow: update.data.raw_row ?? []
    };
    const inserted = await admin.from("contract_actuals").insert(actualRow(options.organizationId, options.contractId, workbookImport.estimate_run_id, workbookImport.id, update.data.id, parsed, workbookImport.reconciliation_status === "reconciled" ? "reconciled" : "partial")).select("*").single();
    if (inserted.error || !inserted.data) throw new Error("Failed to add the reviewed job actual");
    await recordActualLearningEvidence(admin, { organizationId: options.organizationId, contractId: options.contractId, actual: inserted.data, createdBy: options.authSubject });
  }
  const remaining = await admin.from("estimator_workbook_lines").select("id", { count: "exact", head: true }).eq("organization_id", options.organizationId).eq("workbook_import_id", workbookImport.id).eq("review_status", "needs_review");
  await admin.from("estimator_workbook_imports").update({ status: Number(remaining.count ?? 0) ? "needs_review" : "processed", updated_at: new Date().toISOString() }).eq("id", workbookImport.id).eq("organization_id", options.organizationId);
  return loadActualJobWorkbook(admin, options.organizationId, options.contractId);
}
