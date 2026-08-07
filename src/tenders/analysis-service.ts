import { absoluteDocumentLinks, extractPdf, fetchPublicDocument, sha256 } from "../ingestion/document-processing";
import { extractScopeFromText } from "../ingestion/scope-extractor";
import { matchTender, type CapabilityProfile } from "../matching/engine";
import { createEstimateRun } from "../estimation/estimate-runner";
import { tenderSourceFingerprint } from "./fingerprint";

const MAX_DOCUMENTS = 5;

type RunTenderAnalysisOptions = {
  admin: any;
  organizationId: string;
  tenderId: string;
  authSubject?: string | null;
  jobId?: string | null;
};

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

async function updateJobStage(admin: any, jobId: string | null | undefined, stage: string) {
  if (!jobId) return;
  await admin.from("tender_processing_jobs").update({ stage, last_error: null }).eq("id", jobId);
}

async function registerPdf(admin: any, organizationId: string, tenderId: string, profileId: string, url: string, index: number) {
  const fetched = await fetchPublicDocument(url);
  if (!fetched) return { registered: false, extracted: false, pages: 0 };
  const isPdf = /application\/pdf/i.test(fetched.contentType) || /\.pdf(?:$|[?#])/i.test(fetched.url);
  if (!isPdf) return { registered: false, extracted: false, pages: 0 };
  const fileHash = sha256(fetched.bytes);
  const name = documentName(fetched.url, index);
  const { data: prior } = await admin.from("tender_documents").select("id").eq("organization_id", organizationId).eq("tender_id", tenderId).eq("file_hash", fileHash).maybeSingle();
  if (prior) return { registered: false, extracted: false, pages: 0 };

  const parsed = await extractPdf(fetched.bytes);
  const pages = parsed.pages;
  const metadata = { extractionMethod: "public_pdf_text", discoveredBy: "tender-analysis", needsOcr: !parsed.text, sourceUrl: fetched.url };
  const { data: document, error } = await admin.from("tender_documents").insert({
    organization_id: organizationId,
    tender_id: tenderId,
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
    const scopeResult = await admin.from("tender_scope_items").insert(extractedScope.map((item) => ({
      organization_id: organizationId,
      tender_id: tenderId,
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
    if (scopeResult.error) throw new Error("Failed to save extracted tender scope");
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

export async function runTenderAnalysis(options: RunTenderAnalysisOptions) {
  const { admin, organizationId, tenderId, jobId } = options;
  await updateJobStage(admin, jobId, "classifying");
  const { data: tender, error: tenderError } = await admin.from("tenders").select("*").eq("id", tenderId).maybeSingle();
  if (tenderError || !tender) throw new Error("Tender not found");

  const [capability, trades, certifications, regions, profiles] = await Promise.all([
    admin.from("organization_capability_profiles").select("bonding_capacity_cents, available_crew_size, pipeline_load_percent").eq("organization_id", organizationId).maybeSingle(),
    admin.from("organization_trades").select("trade_catalog(slug)").eq("organization_id", organizationId),
    admin.from("organization_certifications").select("certification_key, name_en").eq("organization_id", organizationId),
    admin.from("organization_regions").select("region_key, name_en").eq("organization_id", organizationId),
    admin.from("trade_profiles").select("id, trade_slug, name, active").eq("organization_id", organizationId).eq("active", true)
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
    publishedAt: tender.published_at,
    closingAt: tender.closing_at,
    sourceUrl: tender.source_url,
    rawPayload: asRawPayload(tender.raw_payload)
  };
  const match = matchTender(normalizedTender, capabilityProfile);
  const selectedProfile = (profiles.data ?? []).find((candidate: any) => match.matchedTrades.includes(candidate.trade_slug));
  const viable = match.matchedTrades.length > 0 && match.score >= 50;
  const decision = !viable ? "not_viable" : selectedProfile ? "viable" : "review";
  const sourceFingerprint = tenderSourceFingerprint(tender);
  await updateJobStage(admin, jobId, "matching");
  const analysisResult = await admin.from("tender_analyses").upsert({
    organization_id: organizationId,
    tender_id: tenderId,
    trade_profile_id: selectedProfile?.id ?? null,
    source_fingerprint: sourceFingerprint,
    detected_trades: match.detectedTrades,
    matched_trades: match.matchedTrades,
    decision,
    match_score: match.score,
    components: match.components,
    capability_gaps: match.reasons.map((reason) => ({ type: "capability_check", message: reason })),
    reasons: match.reasons,
    computed_at: new Date().toISOString()
  }, { onConflict: "organization_id,tender_id,source_fingerprint" }).select("id").single();
  if (analysisResult.error || !analysisResult.data) throw new Error("Failed to save tender analysis");
  const tenderAnalysisId = analysisResult.data.id;
  await admin.from("tender_matches").upsert({ organization_id: organizationId, tender_id: tenderId, score: match.score, components: match.components, explanation: match.explanation, computed_at: new Date().toISOString() }, { onConflict: "organization_id,tender_id" });
  await admin.from("organization_tenders").upsert({ organization_id: organizationId, tender_id: tenderId, match_score: match.score, status: viable ? "reviewing" : "no_go" }, { onConflict: "organization_id,tender_id" });
  if (!viable) return { status: "not_viable", viable, match, tenderAnalysisId, reason: "The tender does not match a configured trade profile and capability baseline." };
  if (!selectedProfile) return { status: "matched_needs_profile", viable, match, tenderAnalysisId, reason: "The company capability profile matches this tender, but no active operating model exists for the matched trade." };

  await updateJobStage(admin, jobId, "discovering_documents");
  const discovery = await discoverDocuments(admin, organizationId, tender, selectedProfile.id);
  await updateJobStage(admin, jobId, "extracting_scope");
  const scopeResult = await admin.from("tender_scope_items").select("*").eq("organization_id", organizationId).eq("tender_id", tenderId).neq("review_status", "rejected").order("created_at");
  if (scopeResult.error) throw new Error("Failed to load extracted tender scope");
  const scopeRows = scopeResult.data ?? [];
  if (!scopeRows.length) return { status: discovery.discovered ? "matched_needs_scope_review" : "matched_needs_documents", viable, match, tenderAnalysisId, profile: { id: selectedProfile.id, name: selectedProfile.name, tradeSlug: selectedProfile.trade_slug }, discovery, scopeCount: 0, reason: discovery.discovered ? "Public tender documents were found, but no measurable scope quantity was extracted." : "No public PDF tender attachment was found. Upload the package or add a reviewed scope item to continue." };

  await updateJobStage(admin, jobId, "estimating");
  const existing = await admin.from("estimate_runs").select("*").eq("organization_id", organizationId).eq("tender_id", tenderId).eq("trade_profile_id", selectedProfile.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data) return { status: "estimate_ready", viable, match, tenderAnalysisId, profile: { id: selectedProfile.id, name: selectedProfile.name, tradeSlug: selectedProfile.trade_slug }, discovery, scopeCount: scopeRows.length, estimate: existing.data, result: null };
  const estimate = await createEstimateRun({ admin, organizationId, tenderId, tradeProfileId: selectedProfile.id, scopeRows, tenderAnalysisId, generatedBy: "automatic-tender-analysis", authSubject: options.authSubject, matchScore: match.score });
  return { status: "estimate_created", viable, match, tenderAnalysisId, profile: { id: selectedProfile.id, name: selectedProfile.name, tradeSlug: selectedProfile.trade_slug }, discovery, scopeCount: scopeRows.length, estimate: estimate.estimate, result: estimate.result, assumptionVersionId: estimate.assumptionVersionId };
}
