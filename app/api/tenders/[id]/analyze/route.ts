import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { generateAccuracyEstimate } from "../../../../../src/estimation/accuracy";
import { loadAccuracyTradeProfile, mapScopeRow } from "../../../../../src/estimation/accuracy-server";
import { absoluteDocumentLinks, extractPdf, fetchPublicDocument, sha256 } from "../../../../../src/ingestion/document-processing";
import { extractScopeFromText } from "../../../../../src/ingestion/scope-extractor";
import { matchTender, type CapabilityProfile } from "../../../../../src/matching/engine";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DOCUMENTS = 5;

function tenderId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

function documentName(url: string, index: number): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
    return name && /\.pdf$/i.test(name) ? name.slice(0, 180) : `tender-document-${index + 1}.pdf`;
  } catch {
    return `tender-document-${index + 1}.pdf`;
  }
}

function asRawPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
}

function publicUrls(tender: any): string[] {
  const values = [tender.source_url, ...Object.values(asRawPayload(tender.raw_payload))];
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value)))).slice(0, 8);
}

async function registerPdf(admin: any, organizationId: string, tenderIdValue: string, profileId: string, url: string, index: number) {
  const fetched = await fetchPublicDocument(url);
  if (!fetched) return { registered: false, extracted: false, pages: 0 };
  const isPdf = /application\/pdf/i.test(fetched.contentType) || /\.pdf(?:$|[?#])/i.test(fetched.url);
  if (!isPdf) return { registered: false, extracted: false, pages: 0 };
  const fileHash = sha256(fetched.bytes);
  const name = documentName(fetched.url, index);
  const { data: prior } = await admin.from("tender_documents").select("id").eq("organization_id", organizationId).eq("tender_id", tenderIdValue).eq("file_hash", fileHash).maybeSingle();
  if (prior) return { registered: false, extracted: false, pages: 0 };

  const parsed = await extractPdf(fetched.bytes);
  const pages = parsed.pages;
  const metadata = { extractionMethod: "public_pdf_text", discoveredBy: "tender-analysis", needsOcr: !parsed.text, sourceUrl: fetched.url };
  const { data: document, error } = await admin.from("tender_documents").insert({
    organization_id: organizationId,
    tender_id: tenderIdValue,
    file_name: name,
    document_type: "other",
    source_url: fetched.url,
    file_hash: fileHash,
    processing_status: parsed.text ? "processed" : "needs_review",
    extracted_text: parsed.text || null,
    page_count: parsed.pageCount,
    metadata
  }).select("id").single();
  if (error || !document) return { registered: false, extracted: false, pages: parsed.pageCount };

  const extractedScope = pages.length
    ? pages.flatMap((page) => extractScopeFromText(page.text, page.page))
    : extractScopeFromText(parsed.text);
  if (extractedScope.length) {
    await admin.from("tender_scope_items").insert(extractedScope.map((item) => ({
      organization_id: organizationId,
      tender_id: tenderIdValue,
      tender_document_id: document.id,
      trade_profile_id: profileId,
      task_key: item.taskKey,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      source_page: item.sourcePage ?? null,
      evidence_text: item.evidenceText,
      confidence: item.confidence,
      review_status: "needs_review",
      attributes: { extractionMethod: "public_pdf_text" }
    })));
  }
  return { registered: true, extracted: extractedScope.length > 0, pages: parsed.pageCount };
}

async function discoverDocuments(admin: any, organizationId: string, tender: any, profileId: string) {
  const candidates = publicUrls(tender);
  const pdfUrls = new Set<string>();
  for (const candidate of candidates) {
    if (/\.pdf(?:$|[?#])/i.test(candidate)) pdfUrls.add(candidate);
    else {
      try {
        const fetched = await fetchPublicDocument(candidate);
        if (fetched && /text\/html/i.test(fetched.contentType)) {
          for (const link of absoluteDocumentLinks(fetched.url, fetched.bytes.toString("utf8"))) pdfUrls.add(link);
        }
      } catch {
        // Public tender sources can be unavailable or rate-limited; the notice remains reviewable.
      }
    }
    if (pdfUrls.size >= MAX_DOCUMENTS) break;
  }
  const results = [];
  let index = 0;
  for (const url of Array.from(pdfUrls).slice(0, MAX_DOCUMENTS)) {
    try { results.push(await registerPdf(admin, organizationId, tender.id, profileId, url, index)); } catch { results.push({ registered: false, extracted: false, pages: 0 }); }
    index += 1;
  }
  return { candidates: candidates.length, discovered: pdfUrls.size, registered: results.filter((result) => result.registered).length, extracted: results.filter((result) => result.extracted).length };
}

async function saveEstimate(admin: any, organizationId: string, tender: any, profileId: string, profile: any, scopeRows: any[], match: ReturnType<typeof matchTender>) {
  const existing = await admin.from("estimate_runs").select("*").eq("organization_id", organizationId).eq("tender_id", tender.id).eq("trade_profile_id", profileId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data) return { estimate: existing.data, result: null, reused: true };
  const result = generateAccuracyEstimate(profile, scopeRows.map(mapScopeRow));
  if (tender.estimated_value_cents !== null && profile.minimumProjectSizeCents !== null && Number(tender.estimated_value_cents) < profile.minimumProjectSizeCents) {
    result.exceptions.push({ exceptionType: "manual_review", severity: "warning", title: "Below preferred project size", message: "The tender value is below this trade profile's configured minimum project size." });
  }
  const runResult = await admin.from("estimate_runs").insert({
    organization_id: organizationId,
    tender_id: tender.id,
    trade_profile_id: profileId,
    status: result.exceptions.some((exception) => exception.severity === "blocking") ? "review" : "draft",
    assumptions: { generatedBy: "automatic-tender-analysis", matchScore: match.score, matchedTrades: match.matchedTrades, scopeCount: scopeRows.length },
    labor_subtotal_cents: result.laborSubtotalCents,
    material_subtotal_cents: result.materialSubtotalCents,
    equipment_subtotal_cents: result.equipmentSubtotalCents,
    subcontractor_subtotal_cents: result.subcontractorSubtotalCents,
    overhead_subtotal_cents: result.overheadSubtotalCents,
    risk_reserve_cents: result.riskReserveCents,
    markup_cents: result.markupCents,
    recommended_price_cents: result.recommendedPriceCents,
    confidence_score: result.confidenceScore,
    bid_score: result.bidScore,
    schedule_days: result.scheduleDays
  }).select("*").single();
  if (runResult.error || !runResult.data) throw new Error("Failed to save automatic estimate");
  const runId = runResult.data.id;
  if (result.lines.length) await admin.from("estimate_lines").insert(result.lines.map((line) => ({ organization_id: organizationId, estimate_run_id: runId, tender_scope_item_id: line.scopeItemId ?? null, tender_document_id: line.sourceDocumentId ?? null, kind: line.kind, task_key: line.taskKey ?? null, resource_key: line.resourceKey ?? null, label: line.label, quantity: line.quantity, unit: line.unit, unit_cost_cents: line.unitCostCents, amount_cents: line.amountCents, formula: line.formula, confidence: line.confidence, source_type: line.sourceType, source_page: line.sourcePage ?? null, evidence_text: line.evidenceText ?? null })));
  if (result.exceptions.length) await admin.from("estimate_exceptions").insert(result.exceptions.map((exception) => ({ organization_id: organizationId, estimate_run_id: runId, tender_scope_item_id: exception.scopeItemId ?? null, exception_type: exception.exceptionType, severity: exception.severity, title: exception.title, message: exception.message })));
  if (result.resourceDemand.length) await admin.from("estimate_resource_demand").insert(result.resourceDemand.map((demand) => ({ organization_id: organizationId, estimate_run_id: runId, resource_kind: demand.resourceKind, resource_key: demand.resourceKey, unit: demand.unit, required_quantity: demand.requiredQuantity, available_quantity: demand.availableQuantity, gap_quantity: demand.gapQuantity, notes: demand.notes ?? null })));
  return { estimate: runResult.data, result, reused: false };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = tenderId(request);
    if (!id) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });
    const { data: tender, error: tenderError } = await admin.from("tenders").select("*").eq("id", id).maybeSingle();
    if (tenderError || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    const [capability, trades, certifications, regions, profiles] = await Promise.all([
      admin.from("organization_capability_profiles").select("bonding_capacity_cents, available_crew_size, pipeline_load_percent").eq("organization_id", ctx.organizationId).maybeSingle(),
      admin.from("organization_trades").select("trade_catalog(slug)").eq("organization_id", ctx.organizationId),
      admin.from("organization_certifications").select("certification_key, name_en").eq("organization_id", ctx.organizationId),
      admin.from("organization_regions").select("region_key, name_en").eq("organization_id", ctx.organizationId),
      admin.from("trade_profiles").select("id, trade_slug, name, active, minimum_project_size_cents").eq("organization_id", ctx.organizationId).eq("active", true)
    ]);
    const tradeSlugs = (trades.data ?? []).map((row: any) => Array.isArray(row.trade_catalog) ? row.trade_catalog[0]?.slug : row.trade_catalog?.slug).filter(Boolean);
    const capabilityProfile: CapabilityProfile = {
      tradeSlugs,
      certifications: (certifications.data ?? []).map((row: any) => row.certification_key ?? row.name_en).filter(Boolean),
      serviceRegions: (regions.data ?? []).map((row: any) => row.name_en ?? row.region_key).filter(Boolean),
      bondingCapacityCents: capability.data?.bonding_capacity_cents == null ? null : Number(capability.data.bonding_capacity_cents),
      availableCrewSize: capability.data?.available_crew_size == null ? null : Number(capability.data.available_crew_size),
      pipelineLoadPercent: capability.data?.pipeline_load_percent == null ? null : Number(capability.data.pipeline_load_percent)
    };
    const normalizedTender = {
      source: "canadabuys" as const,
      sourceRecordId: tender.source_record_id,
      solicitationNumber: tender.solicitation_number,
      title: { en: tender.title_en, fr: tender.title_fr },
      description: { en: tender.description_en, fr: tender.description_fr },
      buyerName: tender.buyer_name,
      procurementCategory: tender.procurement_category,
      procurementCode: tender.procurement_code,
      estimatedValueCents: tender.estimated_value_cents == null ? null : Number(tender.estimated_value_cents),
      currency: "CAD" as const,
      closingAt: tender.closing_at,
      sourceUrl: tender.source_url,
      rawPayload: asRawPayload(tender.raw_payload)
    };
    const match = matchTender(normalizedTender, capabilityProfile);
    const viable = match.matchedTrades.length > 0 && match.score >= 50;
    await admin.from("tender_matches").upsert({ organization_id: ctx.organizationId, tender_id: id, score: match.score, components: match.components, explanation: match.explanation, computed_at: new Date().toISOString() }, { onConflict: "organization_id,tender_id" });
    await admin.from("organization_tenders").upsert({ organization_id: ctx.organizationId, tender_id: id, match_score: match.score, status: viable ? "reviewing" : "no_go" }, { onConflict: "organization_id,tender_id" });
    if (!viable) return NextResponse.json({ status: "not_viable", viable, match, reason: "The tender does not match a configured trade profile and capability baseline." });

    const profile = (profiles.data ?? []).find((candidate: any) => match.matchedTrades.includes(candidate.trade_slug));
    if (!profile) return NextResponse.json({ status: "matched_needs_profile", viable, match, reason: "The company capability profile matches this tender, but no active operating model exists for the matched trade." });
    const discovery = await discoverDocuments(admin, ctx.organizationId, tender, profile.id);
    const scopeResult = await admin.from("tender_scope_items").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).neq("review_status", "rejected").order("created_at");
    if (scopeResult.error) throw new Error("Failed to load extracted tender scope");
    const scopeRows = scopeResult.data ?? [];
    if (!scopeRows.length) return NextResponse.json({ status: discovery.discovered ? "matched_needs_scope_review" : "matched_needs_documents", viable, match, profile: { id: profile.id, name: profile.name, tradeSlug: profile.trade_slug }, discovery, scopeCount: 0, reason: discovery.discovered ? "Public tender documents were found, but no measurable scope quantity was extracted." : "No public PDF tender attachment was found. Upload the package or add a reviewed scope item to continue." });
    const loadedProfile = await loadAccuracyTradeProfile(admin, ctx.organizationId, profile.id);
    if (!loadedProfile) throw new Error("Matched trade profile could not be loaded");
    const estimate = await saveEstimate(admin, ctx.organizationId, tender, profile.id, { ...loadedProfile, minimumProjectSizeCents: profile.minimum_project_size_cents == null ? null : Number(profile.minimum_project_size_cents) }, scopeRows, match);
    return NextResponse.json({ status: estimate.reused ? "estimate_ready" : "estimate_created", viable, match, profile: { id: profile.id, name: profile.name, tradeSlug: profile.trade_slug }, discovery, scopeCount: scopeRows.length, estimate: estimate.estimate, result: estimate.result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to analyze tender" }, { status: 500 });
  }
}
