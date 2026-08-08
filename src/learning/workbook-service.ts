import { createHash } from "node:crypto";
import { calculateCalibration, compareEstimatorWorkbook, parseEstimatorWorkbook, WORKBOOK_PARSER_VERSION, type ParsedWorkbookLine, type WorkbookKind } from "./estimator-workbook";
import { recordEstimatorWorkbookEvidence } from "./learning-service";

const comparisonKinds: WorkbookKind[] = ["labor", "material", "equipment", "subcontractor", "overhead", "risk", "markup"];

function mappingFingerprint(mappingMetadata: Awaited<ReturnType<typeof parseEstimatorWorkbook>>["mappingMetadata"]) {
  const fingerprintSource = mappingMetadata.sheets.map((sheet) => ({ name: sheet.name.toLowerCase(), headerRow: sheet.headerRow, columns: sheet.columns })).sort((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256").update(JSON.stringify(fingerprintSource)).digest("hex");
}

function costCodeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function applyRememberedWorkbookMapping(admin: any, organizationId: string, purpose: "estimator_estimate" | "job_actual", parsed: Awaited<ReturnType<typeof parseEstimatorWorkbook>>) {
  const fingerprint = mappingFingerprint(parsed.mappingMetadata);
  const profile = await admin.from("workbook_mapping_profiles").select("cost_code_mappings, confidence, successful_import_count").eq("organization_id", organizationId).eq("purpose", purpose).eq("workbook_fingerprint", fingerprint).maybeSingle();
  if (profile.error) throw new Error("Failed to load the company workbook mapping");
  const mappings = (profile.data?.cost_code_mappings ?? {}) as Record<string, WorkbookKind>;
  let appliedCount = 0;
  const lines = parsed.lines.map((line) => {
    const rememberedKind = line.costCode ? mappings[costCodeKey(line.costCode)] : undefined;
    if (!rememberedKind || rememberedKind === "unknown" || (!comparisonKinds.includes(rememberedKind) && rememberedKind !== "markup" && rememberedKind !== "risk")) return line;
    if (line.normalizedKind !== "unknown" && line.reviewStatus !== "needs_review") return line;
    appliedCount += 1;
    return {
      ...line,
      normalizedKind: rememberedKind,
      extractionConfidence: Math.max(line.extractionConfidence, Math.min(96, Number(profile.data?.confidence ?? 80))),
      reviewStatus: Number(profile.data?.successful_import_count ?? 0) >= 1 ? "auto_accepted" as const : line.reviewStatus,
      mappingReason: `Mapped cost code ${line.costCode} using this company's reviewed workbook profile.`
    };
  });
  if (!appliedCount) return parsed;
  const categoryTotals = { ...parsed.categoryTotals };
  Object.keys(categoryTotals).forEach((key) => { categoryTotals[key as WorkbookKind] = 0; });
  lines.forEach((line) => { categoryTotals[line.normalizedKind] += line.amountCents; });
  const totalAmountCents = Object.values(categoryTotals).reduce((sum, value) => sum + value, 0);
  const extractionConfidence = Math.round(lines.reduce((sum, line) => sum + line.extractionConfidence, 0) / lines.length);
  return { ...parsed, lines, categoryTotals, totalAmountCents, extractionConfidence, warnings: [...parsed.warnings, `Applied ${appliedCount} remembered cost-code mapping${appliedCount === 1 ? "" : "s"}.`] };
}

function dbLineToParsed(row: any): ParsedWorkbookLine & { id: string } {
  return {
    id: row.id,
    sourceSheet: row.source_sheet,
    sourceRow: Number(row.source_row),
    sourceRange: row.source_range,
    rawLabel: row.raw_label,
    normalizedKind: row.normalized_kind,
    taskKey: row.task_key,
    resourceKey: row.resource_key,
    costCode: row.cost_code ?? null,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    hours: row.hours === null ? null : Number(row.hours),
    unitCostCents: row.unit_cost_cents === null ? null : Number(row.unit_cost_cents),
    taxCents: row.tax_cents === null || row.tax_cents === undefined ? null : Number(row.tax_cents),
    currencyCode: row.currency_code ?? "CAD",
    occurredOn: row.occurred_on ?? null,
    amountCents: Number(row.amount_cents),
    extractionConfidence: Number(row.extraction_confidence),
    reviewStatus: row.review_status,
    mappingReason: row.mapping_reason ?? "",
    rawRow: row.raw_row ?? []
  };
}

function totalsFor(lines: Array<ParsedWorkbookLine & { id?: string }>) {
  const totals = Object.fromEntries([...comparisonKinds, "unknown"].map((kind) => [kind, 0])) as Record<WorkbookKind, number>;
  for (const line of lines) totals[line.normalizedKind] += line.amountCents;
  return totals;
}

async function refreshCalibration(admin: any, organizationId: string, tradeProfileId: string, kind: WorkbookKind) {
  if (kind === "unknown" || kind === "risk" || kind === "markup") return;
  const result = await admin.from("trade_profile_calibration_observations").select("observed_factor, trust_weight, confidence, created_at").eq("organization_id", organizationId).eq("trade_profile_id", tradeProfileId).eq("normalized_kind", kind).eq("metric", "category_cost_factor").eq("status", "accepted").order("created_at", { ascending: false }).limit(20);
  if (result.error) throw new Error("Failed to load calibration observations");
  const model = calculateCalibration((result.data ?? []).map((row: any) => ({ observed_factor: Number(row.observed_factor), trust_weight: Number(row.trust_weight), confidence: Number(row.confidence), created_at: row.created_at })));
  const upsert = await admin.from("trade_profile_calibrations").upsert({ organization_id: organizationId, trade_profile_id: tradeProfileId, normalized_kind: kind, metric: "category_cost_factor", sample_count: model.sampleCount, weighted_factor: model.weightedFactor, applied_factor: model.appliedFactor, confidence: model.confidence, status: model.status, calculation_metadata: { deviation: model.deviation, safeguardRange: [0.8, 1.2], minimumSamples: 3, source: "estimator_workbooks" }, last_observation_at: result.data?.[0]?.created_at ?? null, updated_at: new Date().toISOString() }, { onConflict: "trade_profile_id,normalized_kind,metric" });
  if (upsert.error) throw new Error("Failed to update the company calibration model");
}

async function createComparison(admin: any, options: { organizationId: string; estimate: any; workbookImportId: string; workbookLines: Array<ParsedWorkbookLine & { id: string }>; extractionConfidence: number }) {
  const aiResult = await admin.from("estimate_lines").select("id, kind, label, amount_cents").eq("organization_id", options.organizationId).eq("estimate_run_id", options.estimate.id);
  if (aiResult.error) throw new Error("Failed to load AI estimate lines");
  const comparison = compareEstimatorWorkbook(aiResult.data ?? [], options.workbookLines, options.extractionConfidence);
  const comparisonResult = await admin.from("estimate_workbook_comparisons").insert({ organization_id: options.organizationId, estimate_run_id: options.estimate.id, workbook_import_id: options.workbookImportId, ai_total_cents: comparison.aiTotalCents, estimator_total_cents: comparison.estimatorTotalCents, variance_cents: comparison.varianceCents, variance_percent: comparison.variancePercent, category_comparison: comparison.categoryComparison, overall_confidence: comparison.overallConfidence, status: comparison.status }).select("*").single();
  if (comparisonResult.error || !comparisonResult.data) throw new Error("Failed to save the estimate comparison");
  if (comparison.lines.length) {
    const linesResult = await admin.from("estimate_workbook_comparison_lines").insert(comparison.lines.map((line) => ({ organization_id: options.organizationId, comparison_id: comparisonResult.data.id, estimate_line_id: line.estimateLineId, workbook_line_id: line.workbookLineId, normalized_kind: line.normalizedKind, match_score: line.matchScore, ai_amount_cents: line.aiAmountCents, estimator_amount_cents: line.estimatorAmountCents, variance_cents: line.varianceCents, match_reason: line.matchReason })));
    if (linesResult.error) throw new Error("Failed to save line-by-line comparisons");
  }
  const observations = comparisonKinds.flatMap((kind) => {
    const category = comparison.categoryComparison[kind];
    if (!category || category.aiCents <= 0 || category.estimatorCents <= 0) return [];
    const categoryLines = options.workbookLines.filter((line) => line.normalizedKind === kind);
    const needsReview = categoryLines.some((line) => line.reviewStatus === "needs_review");
    return [{ organization_id: options.organizationId, trade_profile_id: options.estimate.trade_profile_id, workbook_import_id: options.workbookImportId, comparison_id: comparisonResult.data.id, source_type: "estimator_workbook", metric: "category_cost_factor", normalized_kind: kind, baseline_value: category.aiCents, observed_value: category.estimatorCents, observed_factor: category.estimatorCents / category.aiCents, trust_weight: 0.35, confidence: Math.min(comparison.overallConfidence, ...categoryLines.map((line) => line.extractionConfidence)), status: needsReview ? "needs_review" : "accepted" }];
  });
  if (observations.length) {
    const observationResult = await admin.from("trade_profile_calibration_observations").insert(observations);
    if (observationResult.error) throw new Error("Failed to save learning observations");
  }
  await Promise.all(comparisonKinds.map((kind) => refreshCalibration(admin, options.organizationId, options.estimate.trade_profile_id, kind)));
  await recordEstimatorWorkbookEvidence(admin, {
    organizationId: options.organizationId,
    tradeProfileId: options.estimate.trade_profile_id,
    estimateRunId: options.estimate.id,
    workbookImportId: options.workbookImportId,
    categories: comparison.categoryComparison,
    confidence: comparison.overallConfidence
  });
  return { comparison: comparisonResult.data, comparisonLines: comparison.lines };
}

export async function rememberWorkbookMapping(admin: any, organizationId: string, purpose: "estimator_estimate" | "job_actual", parsed: Awaited<ReturnType<typeof parseEstimatorWorkbook>>) {
  const fingerprint = mappingFingerprint(parsed.mappingMetadata);
  const existing = await admin.from("workbook_mapping_profiles").select("id, successful_import_count, cost_code_mappings").eq("organization_id", organizationId).eq("purpose", purpose).eq("workbook_fingerprint", fingerprint).maybeSingle();
  const learnedCostCodes = Object.fromEntries(parsed.lines.filter((line) => line.costCode && line.normalizedKind !== "unknown" && line.reviewStatus === "auto_accepted").map((line) => [costCodeKey(line.costCode!), line.normalizedKind]));
  const values = {
    organization_id: organizationId,
    purpose,
    workbook_fingerprint: fingerprint,
    sheet_patterns: parsed.mappingMetadata.sheets.map((sheet) => ({ name: sheet.name, headerRow: sheet.headerRow })),
    column_mappings: parsed.mappingMetadata,
    cost_code_mappings: { ...(existing.data?.cost_code_mappings ?? {}), ...learnedCostCodes },
    confidence: parsed.extractionConfidence,
    successful_import_count: Number(existing.data?.successful_import_count ?? 0) + 1,
    last_used_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const result = existing.data?.id
    ? await admin.from("workbook_mapping_profiles").update(values).eq("id", existing.data.id).eq("organization_id", organizationId)
    : await admin.from("workbook_mapping_profiles").insert(values);
  if (result.error) throw new Error("Failed to remember the company workbook mapping");
  return fingerprint;
}

export async function rememberReviewedCostCode(admin: any, organizationId: string, purpose: "estimator_estimate" | "job_actual", mappingMetadata: Awaited<ReturnType<typeof parseEstimatorWorkbook>>["mappingMetadata"] | null, costCode: string | null, normalizedKind: WorkbookKind) {
  if (!mappingMetadata || !costCode || normalizedKind === "unknown") return;
  const fingerprint = mappingFingerprint(mappingMetadata);
  const profile = await admin.from("workbook_mapping_profiles").select("id, cost_code_mappings").eq("organization_id", organizationId).eq("purpose", purpose).eq("workbook_fingerprint", fingerprint).maybeSingle();
  if (profile.error || !profile.data) return;
  const mappings = { ...(profile.data.cost_code_mappings ?? {}), [costCodeKey(costCode)]: normalizedKind };
  await admin.from("workbook_mapping_profiles").update({ cost_code_mappings: mappings, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", profile.data.id).eq("organization_id", organizationId);
}

export async function importEstimatorWorkbook(admin: any, options: { organizationId: string; authSubject: string; estimateId: string; fileName: string; mimeType: string; buffer: Buffer }) {
  const estimateResult = await admin.from("estimate_runs").select("id, trade_profile_id").eq("id", options.estimateId).eq("organization_id", options.organizationId).maybeSingle();
  if (estimateResult.error || !estimateResult.data) throw new Error("Estimate not found");
  const fileHash = createHash("sha256").update(options.buffer).digest("hex");
  const duplicate = await admin.from("estimator_workbook_imports").select("*").eq("organization_id", options.organizationId).eq("estimate_run_id", options.estimateId).eq("file_hash", fileHash).maybeSingle();
  if (duplicate.data) return { workbookImport: duplicate.data, duplicate: true };
  const importResult = await admin.from("estimator_workbook_imports").insert({ organization_id: options.organizationId, estimate_run_id: options.estimateId, trade_profile_id: estimateResult.data.trade_profile_id, uploaded_by: options.authSubject, file_name: options.fileName, file_hash: fileHash, mime_type: options.mimeType || null, file_size_bytes: options.buffer.length, purpose: "estimator_estimate", reconciliation_status: "partial", status: "processing", parser_version: WORKBOOK_PARSER_VERSION }).select("*").single();
  if (importResult.error || !importResult.data) throw new Error("Failed to register estimator workbook");
  const workbookImportId = importResult.data.id;
  try {
    const parsed = await applyRememberedWorkbookMapping(admin, options.organizationId, "estimator_estimate", await parseEstimatorWorkbook(options.buffer, options.fileName));
    await rememberWorkbookMapping(admin, options.organizationId, "estimator_estimate", parsed);
    const lineResult = await admin.from("estimator_workbook_lines").insert(parsed.lines.map((line) => ({ organization_id: options.organizationId, workbook_import_id: workbookImportId, source_sheet: line.sourceSheet, source_row: line.sourceRow, source_range: line.sourceRange, raw_label: line.rawLabel, normalized_kind: line.normalizedKind, task_key: line.taskKey, resource_key: line.resourceKey, cost_code: line.costCode, quantity: line.quantity, unit: line.unit, hours: line.hours, unit_cost_cents: line.unitCostCents, tax_cents: line.taxCents, currency_code: line.currencyCode, occurred_on: line.occurredOn, amount_cents: line.amountCents, extraction_confidence: line.extractionConfidence, review_status: line.reviewStatus, mapping_reason: line.mappingReason, raw_row: line.rawRow }))).select("*");
    if (lineResult.error) throw new Error("Failed to save extracted workbook lines");
    const workbookLines = (lineResult.data ?? []).map(dbLineToParsed);
    const created = await createComparison(admin, { organizationId: options.organizationId, estimate: estimateResult.data, workbookImportId, workbookLines, extractionConfidence: parsed.extractionConfidence });
    const status = parsed.lines.some((line) => line.reviewStatus === "needs_review") ? "needs_review" : "processed";
    const updateResult = await admin.from("estimator_workbook_imports").update({ status, workbook_metadata: parsed.metadata, mapping_metadata: parsed.mappingMetadata, category_totals: parsed.categoryTotals, warnings: parsed.warnings, row_count: parsed.lines.length, total_amount_cents: parsed.totalAmountCents, extraction_confidence: parsed.extractionConfidence, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", workbookImportId).eq("organization_id", options.organizationId).select("*").single();
    if (updateResult.error) throw new Error("Failed to finalize estimator workbook import");
    return { workbookImport: updateResult.data, lines: lineResult.data ?? [], comparison: created.comparison, duplicate: false };
  } catch (error) {
    await admin.from("estimator_workbook_imports").update({ status: "failed", error_message: error instanceof Error ? error.message : "Workbook processing failed", updated_at: new Date().toISOString() }).eq("id", workbookImportId).eq("organization_id", options.organizationId);
    throw error;
  }
}

export async function reviewWorkbookLine(admin: any, options: { organizationId: string; estimateId: string; lineId: string; normalizedKind: WorkbookKind; accepted: boolean }) {
  const lineResult = await admin.from("estimator_workbook_lines").select("*, estimator_workbook_imports!inner(id, estimate_run_id, trade_profile_id, extraction_confidence, mapping_metadata)").eq("id", options.lineId).eq("organization_id", options.organizationId).maybeSingle();
  const row = lineResult.data as any;
  if (lineResult.error || !row || row.estimator_workbook_imports?.estimate_run_id !== options.estimateId) throw new Error("Workbook line not found");
  const update = await admin.from("estimator_workbook_lines").update({ normalized_kind: options.normalizedKind, review_status: options.accepted ? "accepted" : "rejected" }).eq("id", options.lineId).eq("organization_id", options.organizationId).select("*").single();
  if (update.error) throw new Error("Failed to review workbook line");
  if (options.accepted) await rememberReviewedCostCode(admin, options.organizationId, "estimator_estimate", row.estimator_workbook_imports.mapping_metadata, row.cost_code, options.normalizedKind);
  const importId = row.estimator_workbook_imports.id;
  const estimate = { id: options.estimateId, trade_profile_id: row.estimator_workbook_imports.trade_profile_id };
  await admin.from("estimate_workbook_comparisons").delete().eq("organization_id", options.organizationId).eq("workbook_import_id", importId);
  const allLinesResult = await admin.from("estimator_workbook_lines").select("*").eq("organization_id", options.organizationId).eq("workbook_import_id", importId).neq("review_status", "rejected").order("source_sheet, source_row");
  if (allLinesResult.error) throw new Error("Failed to reload workbook lines");
  const workbookLines: Array<ParsedWorkbookLine & { id: string }> = (allLinesResult.data ?? []).map(dbLineToParsed);
  const created = await createComparison(admin, { organizationId: options.organizationId, estimate, workbookImportId: importId, workbookLines, extractionConfidence: Number(row.estimator_workbook_imports.extraction_confidence ?? 0) });
  const remainingReview = workbookLines.some((line) => line.reviewStatus === "needs_review");
  const categoryTotals = totalsFor(workbookLines);
  await admin.from("estimator_workbook_imports").update({ status: remainingReview ? "needs_review" : "processed", category_totals: categoryTotals, total_amount_cents: Object.values(categoryTotals).reduce((sum, value) => sum + value, 0), updated_at: new Date().toISOString() }).eq("id", importId).eq("organization_id", options.organizationId);
  return { line: update.data, comparison: created.comparison };
}

export async function loadEstimateWorkbookLearning(admin: any, organizationId: string, estimateId: string) {
  const estimateResult = await admin.from("estimate_runs").select("id, trade_profile_id").eq("id", estimateId).eq("organization_id", organizationId).maybeSingle();
  if (estimateResult.error || !estimateResult.data) throw new Error("Estimate not found");
  const importsResult = await admin.from("estimator_workbook_imports").select("*").eq("organization_id", organizationId).eq("estimate_run_id", estimateId).order("created_at", { ascending: false }).limit(10);
  if (importsResult.error) throw new Error("Failed to load estimator workbooks");
  const latest = importsResult.data?.[0] ?? null;
  const [lines, comparison, calibrations] = await Promise.all([
    latest ? admin.from("estimator_workbook_lines").select("*").eq("organization_id", organizationId).eq("workbook_import_id", latest.id).order("source_sheet, source_row") : Promise.resolve({ data: [], error: null }),
    latest ? admin.from("estimate_workbook_comparisons").select("*").eq("organization_id", organizationId).eq("workbook_import_id", latest.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    admin.from("trade_profile_calibrations").select("*").eq("organization_id", organizationId).eq("trade_profile_id", estimateResult.data.trade_profile_id).order("normalized_kind")
  ]);
  if (lines.error || comparison.error || calibrations.error) throw new Error("Failed to load workbook comparison details");
  return { imports: importsResult.data ?? [], latestImport: latest, lines: lines.data ?? [], comparison: comparison.data ?? null, calibrations: calibrations.data ?? [] };
}
