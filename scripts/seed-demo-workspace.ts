import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import { classifySkills } from "../src/capability/classifier";
import { createEstimateRun } from "../src/estimation/estimate-runner";
import { getTradeTemplate } from "../src/estimation/trade-templates";
import { matchTender } from "../src/matching/engine";
import { tenderSourceFingerprint } from "../src/tenders/fingerprint";

const DEMO_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000";
const DEMO_AUTH_SUBJECT = "local-preview";
const DEMO_TENDER_ID = "00000000-0000-0000-0000-000000000101";
const DEMO_CONTRACT_ID = "00000000-0000-0000-0000-000000000201";
const DEMO_JOB_ID = "00000000-0000-0000-0000-000000000301";
const DEMO_ANALYSIS_ID = "00000000-0000-0000-0000-000000000401";
const DEMO_DOCUMENT_NOTICE_ID = "00000000-0000-0000-0000-000000000501";
const DEMO_DOCUMENT_SCOPE_ID = "00000000-0000-0000-0000-000000000502";
const DEMO_SCOPE_WATER_ID = "00000000-0000-0000-0000-000000000601";
const DEMO_SCOPE_CONTAINMENT_ID = "00000000-0000-0000-0000-000000000602";
const DEMO_STAFF_IDS = [
  "00000000-0000-0000-0000-000000000701",
  "00000000-0000-0000-0000-000000000702",
  "00000000-0000-0000-0000-000000000703",
  "00000000-0000-0000-0000-000000000704",
  "00000000-0000-0000-0000-000000000705"
];
const DEMO_ACTUAL_IDS = [
  "00000000-0000-0000-0000-000000000801",
  "00000000-0000-0000-0000-000000000802",
  "00000000-0000-0000-0000-000000000803",
  "00000000-0000-0000-0000-000000000804",
  "00000000-0000-0000-0000-000000000805",
  "00000000-0000-0000-0000-000000000806",
  "00000000-0000-0000-0000-000000000807",
  "00000000-0000-0000-0000-000000000808",
  "00000000-0000-0000-0000-000000000809"
];

function loadLocalEnv() {
  const file = resolve(process.cwd(), ".env.local");
  try {
    const contents = readFileSync(file, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // CI and hosted runners provide environment variables directly.
  }
}

function isoDate(daysFromToday: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString();
}

function dateOnly(daysFromToday: number) {
  return isoDate(daysFromToday).slice(0, 10);
}

function assertOk(result: { error: { message?: string } | null }, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "database request failed"}`);
}

async function upsertProfile(admin: any, tradeSlug: string, profileName: string, overrides: Record<string, unknown>) {
  const template = getTradeTemplate(tradeSlug);
  if (!template) throw new Error(`Trade template not found: ${tradeSlug}`);
  const existing = await admin.from("trade_profiles").select("id").eq("organization_id", DEMO_ORGANIZATION_ID).eq("trade_slug", tradeSlug).maybeSingle();
  const profilePayload = {
    ...(existing.data?.id ? { id: existing.data.id } : {}),
    organization_id: DEMO_ORGANIZATION_ID,
    trade_slug: tradeSlug,
    name: profileName,
    active: true,
    service_radius_km: 90,
    minimum_project_size_cents: 7500000,
    target_markup_percent: 12,
    target_margin_percent: 10.71,
    contingency_percent: 7,
    mobilization_cents: 185000,
    travel_cost_per_km_cents: 95,
    working_days_per_week: 5,
    shift_hours: 8,
    overtime_multiplier: 1.5,
    current_pipeline_load_percent: 32,
    notes: "Northstar demo operating model. Replace these values with approved company assumptions before bidding.",
    ...overrides
  };
  const profileResult = await admin.from("trade_profiles").upsert(profilePayload, { onConflict: "organization_id,trade_slug" }).select("*").single();
  assertOk(profileResult, `${tradeSlug} profile`);
  const profile = profileResult.data;

  const resources = template.resources.map((resource) => ({
    organization_id: DEMO_ORGANIZATION_ID,
    trade_profile_id: profile.id,
    resource_kind: resource.resourceKind,
    resource_key: resource.resourceKey,
    name: resource.name,
    unit: resource.unit,
    rate_cents: resource.rateCents,
    rate_basis: resource.rateBasis,
    available_quantity: resource.availableQuantity ?? null,
    waste_percent: resource.wastePercent ?? 0,
    attributes: { source: "northstar-demo", loadedCost: true }
  }));
  if (tradeSlug === "fire-water-restoration") {
    resources.push(
      { organization_id: DEMO_ORGANIZATION_ID, trade_profile_id: profile.id, resource_kind: "subcontractor", resource_key: "mold-testing", name: "Independent mold testing allowance", unit: "lump sum", rate_cents: 85000, rate_basis: "lump_sum", available_quantity: null, waste_percent: 0, attributes: { source: "northstar-demo", loadedCost: true } },
      { organization_id: DEMO_ORGANIZATION_ID, trade_profile_id: profile.id, resource_kind: "overhead", resource_key: "field-supervision", name: "Field supervision and project overhead", unit: "lump sum", rate_cents: 165000, rate_basis: "lump_sum", available_quantity: null, waste_percent: 0, attributes: { source: "northstar-demo", loadedCost: true } }
    );
  }
  const resourceOverrides: Record<string, Record<string, unknown>> = tradeSlug === "fire-water-restoration" ? {
    "restoration-supervisor": { rate_cents: 6500, available_quantity: 2 },
    "restoration-technician": { rate_cents: 4450, available_quantity: 6 },
    laborer: { rate_cents: 3000, available_quantity: 3 },
    "containment-poly": { rate_cents: 300, waste_percent: 8 },
    "air-mover": { rate_cents: 3800, available_quantity: 100 },
    dehumidifier: { rate_cents: 6800, available_quantity: 40 }
  } : {};
  for (const resource of resources) {
    const result = await admin.from("trade_profile_resources").upsert({ ...resource, ...(resourceOverrides[resource.resource_key] ?? {}) }, { onConflict: "trade_profile_id,resource_kind,resource_key" });
    assertOk(result, `${tradeSlug} resource ${resource.resource_key}`);
  }

  const crewIds = new Map<string, string>();
  for (const crewTemplate of template.crews) {
    const crewResult = await admin.from("trade_profile_crews").upsert({ organization_id: DEMO_ORGANIZATION_ID, trade_profile_id: profile.id, crew_key: crewTemplate.crewKey, name: crewTemplate.name, production_factor: crewTemplate.productionFactor, max_crews_available: crewTemplate.maxCrewsAvailable ?? 1, notes: "Configured for the Northstar demo capacity plan." }, { onConflict: "trade_profile_id,crew_key" }).select("id, crew_key").single();
    assertOk(crewResult, `${tradeSlug} crew ${crewTemplate.crewKey}`);
    crewIds.set(crewTemplate.crewKey, crewResult.data.id);
    for (const role of crewTemplate.roles) {
      const roleResult = await admin.from("trade_profile_crew_roles").upsert({ organization_id: DEMO_ORGANIZATION_ID, crew_id: crewResult.data.id, role_resource_key: role.roleResourceKey, headcount: role.headcount, skill_slugs: role.skillSlugs ?? [] }, { onConflict: "crew_id,role_resource_key" });
      assertOk(roleResult, `${tradeSlug} crew role ${role.roleResourceKey}`);
    }
  }
  for (const assemblyTemplate of template.assemblies) {
    const assemblyResult = await admin.from("trade_profile_assemblies").upsert({ organization_id: DEMO_ORGANIZATION_ID, trade_profile_id: profile.id, task_key: assemblyTemplate.taskKey, name: assemblyTemplate.name, unit: assemblyTemplate.unit, labor_hours_per_unit: assemblyTemplate.laborHoursPerUnit, default_waste_percent: assemblyTemplate.defaultWastePercent ?? 0, preferred_crew_id: assemblyTemplate.preferredCrewKey ? crewIds.get(assemblyTemplate.preferredCrewKey) ?? null : null, material_components: assemblyTemplate.materialComponents ?? [], equipment_components: assemblyTemplate.equipmentComponents ?? [], notes: "Demo production assumption. Review site conditions and access constraints before approval." }, { onConflict: "trade_profile_id,task_key" });
    assertOk(assemblyResult, `${tradeSlug} assembly ${assemblyTemplate.taskKey}`);
  }
  return profile;
}

async function main() {
  loadLocalEnv();
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");

  const organizationResult = await admin.from("organizations").upsert({ id: DEMO_ORGANIZATION_ID, name: "Northstar Build & Restoration", default_currency: "CAD", industry: "Construction, restoration, and fit-out", website: "https://northstar-demo.example", phone: "(416) 555-0148" }, { onConflict: "id" });
  assertOk(organizationResult, "demo organization");
  const memberResult = await admin.from("organization_members").upsert({ organization_id: DEMO_ORGANIZATION_ID, auth_subject: DEMO_AUTH_SUBJECT, role: "owner" }, { onConflict: "organization_id,auth_subject" });
  assertOk(memberResult, "preview membership");
  const capabilityResult = await admin.from("organization_capability_profiles").upsert({ organization_id: DEMO_ORGANIZATION_ID, bonding_capacity_cents: 150000000, available_crew_size: 12, pipeline_load_percent: 32, updated_at: new Date().toISOString() });
  assertOk(capabilityResult, "company capability profile");

  const selectedTrades = ["general-renovation", "fire-water-restoration"];
  const catalogResult = await admin.from("trade_catalog").select("id, slug").in("slug", selectedTrades);
  assertOk(catalogResult, "trade catalog");
  const organizationTradesResult = await admin.from("organization_trades").upsert((catalogResult.data ?? []).map((trade: { id: string }) => ({ organization_id: DEMO_ORGANIZATION_ID, trade_id: trade.id })), { onConflict: "organization_id,trade_id" });
  assertOk(organizationTradesResult, "company trades");
  const regionsResult = await admin.from("organization_regions").upsert([
    { organization_id: DEMO_ORGANIZATION_ID, region_key: "toronto", name_en: "Toronto" },
    { organization_id: DEMO_ORGANIZATION_ID, region_key: "peel", name_en: "Peel Region" },
    { organization_id: DEMO_ORGANIZATION_ID, region_key: "york", name_en: "York Region" }
  ], { onConflict: "organization_id,region_key" });
  assertOk(regionsResult, "service regions");
  const certificationsResult = await admin.from("organization_certifications").upsert([
    { organization_id: DEMO_ORGANIZATION_ID, certification_key: "iicrc-wrt", name_en: "IICRC Water Restoration Technician" },
    { organization_id: DEMO_ORGANIZATION_ID, certification_key: "whmis-2015", name_en: "WHMIS 2015" },
    { organization_id: DEMO_ORGANIZATION_ID, certification_key: "cor-safety", name_en: "COR workplace safety" }
  ], { onConflict: "organization_id,certification_key" });
  assertOk(certificationsResult, "company certifications");

  const staff = [
    { id: DEMO_STAFF_IDS[0], display_name: "Maya Chen", role_title: "Restoration supervisor", skill_summary: "Water damage restoration, drying plans, IICRC WRT, WHMIS, client coordination", hourly_cost_cents: 6500, available: true },
    { id: DEMO_STAFF_IDS[1], display_name: "Andre Baptiste", role_title: "Lead restoration technician", skill_summary: "Emergency drying, water extraction, containment, moisture readings", hourly_cost_cents: 4450, available: true },
    { id: DEMO_STAFF_IDS[2], display_name: "Sofia Nguyen", role_title: "Restoration technician", skill_summary: "Water extraction, air movers, dehumidification, contents handling", hourly_cost_cents: 4450, available: true },
    { id: DEMO_STAFF_IDS[3], display_name: "Liam O'Connor", role_title: "General laborer", skill_summary: "Containment, protection, demolition support, material handling", hourly_cost_cents: 3000, available: true },
    { id: DEMO_STAFF_IDS[4], display_name: "Priya Shah", role_title: "Estimator and project coordinator", skill_summary: "Renovation, restoration, scope review, procurement coordination", hourly_cost_cents: 5800, available: false }
  ].map((member) => {
    const classified = classifySkills(member.role_title, member.skill_summary);
    return { organization_id: DEMO_ORGANIZATION_ID, ...member, classified_skills: classified.map((skill) => skill.slug), skill_confidence: classified.length ? Math.round(Math.max(...classified.map((skill) => skill.confidence)) * 100) : null };
  });
  const staffResult = await admin.from("organization_staff").upsert(staff, { onConflict: "id" });
  assertOk(staffResult, "company staff");
  const progressResult = await admin.from("company_setup_progress").upsert({ organization_id: DEMO_ORGANIZATION_ID, completed_steps: ["company", "trades", "coverage", "people", "labor", "crews", "resources", "productivity", "compliance", "commercial"], skipped_steps: [], updated_at: new Date().toISOString() });
  assertOk(progressResult, "company readiness");

  const renovationProfile = await upsertProfile(admin, "general-renovation", "Renovation & fit-out operating model", { current_pipeline_load_percent: 32 });
  const restorationProfile = await upsertProfile(admin, "fire-water-restoration", "Fire & water restoration operating model", { current_pipeline_load_percent: 32 });

  const tenderPayload = {
    id: DEMO_TENDER_ID,
    source: "canadabuys",
    source_record_id: "NORTHSTAR-DEMO-2026-001",
    solicitation_number: "NRCan-2026-REST-014",
    procurement_code: "72101500",
    title_en: "Emergency water damage restoration and interior rebuild — Toronto Civic Library",
    title_fr: "Restauration après dégâts d'eau et reconstruction intérieure — bibliothèque civique de Toronto",
    description_en: "The City of Toronto is seeking a qualified contractor for emergency water damage restoration, drying, containment, drywall replacement, and repainting at a public library. The work includes water extraction, emergency drying, protection of occupied areas, contents pack-out, and restoration of affected interior finishes.",
    description_fr: "La Ville de Toronto cherche un entrepreneur qualifié pour la restauration après dégâts d'eau, le séchage d'urgence, le confinement, le remplacement de cloisons sèches et la peinture.",
    buyer_name: "City of Toronto — Facilities Management",
    procurement_category: "construction",
    estimated_value_cents: 48500000,
    currency: "CAD",
    published_at: isoDate(-11),
    closing_at: isoDate(18),
    source_url: "https://canadabuys.canada.ca/en/tender-opportunities/demo-northstar-restoration",
    raw_payload: { demo: true, source: "Northstar scenario fixture", site: "Toronto Civic Library, 245 Front Street West", mandatory_requirements: ["IICRC WRT", "WHMIS 2015", "COR workplace safety"], schedule: "Mobilize within 48 hours; complete restoration within 15 working days" },
    updated_at: new Date().toISOString()
  };
  const tenderResult = await admin.from("tenders").upsert(tenderPayload, { onConflict: "id" }).select("*").single();
  assertOk(tenderResult, "demo tender");
  const organizationTenderResult = await admin.from("organization_tenders").upsert({ organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, status: "reviewing", match_score: 90 }, { onConflict: "organization_id,tender_id" });
  assertOk(organizationTenderResult, "demo opportunity link");

  const noticeResult = await admin.from("tender_documents").upsert({ id: DEMO_DOCUMENT_NOTICE_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, file_name: "01_Tender_Notice.pdf", document_type: "notice", version_label: "Issue 1", source_url: tenderPayload.source_url, file_hash: "demo-notice-v1", processing_status: "processed", extracted_text: "Toronto Civic Library emergency restoration tender. Mandatory IICRC WRT, WHMIS 2015, and COR workplace safety. Mobilize within 48 hours.", page_count: 3, metadata: { demo: true, revision: 1, extractionMethod: "sample-evidence" } }, { onConflict: "id" });
  assertOk(noticeResult, "tender notice document");
  const scopeDocResult = await admin.from("tender_documents").upsert({ id: DEMO_DOCUMENT_SCOPE_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, file_name: "02_Scope_and_BoQ.pdf", document_type: "bill_of_quantities", version_label: "Addendum 02", source_url: `${tenderPayload.source_url}/scope-and-boq.pdf`, file_hash: "demo-scope-addendum-02", processing_status: "processed", extracted_text: "Page 4 — Water extraction and emergency drying: 900 m2. Page 7 — Temporary containment and protection: 380 m2.", page_count: 9, metadata: { demo: true, revision: 2, extractionMethod: "sample-evidence", replaces: "Issue 1" } }, { onConflict: "id" });
  assertOk(scopeDocResult, "tender scope document");
  const scopeResult = await admin.from("tender_scope_items").upsert([
    { id: DEMO_SCOPE_WATER_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, tender_document_id: DEMO_DOCUMENT_SCOPE_ID, trade_profile_id: restorationProfile.id, task_key: "water-extraction", description: "Water extraction and emergency drying", quantity: 900, unit: "m2", location: "Lower level reading rooms", source_page: 4, evidence_text: "Page 4 — Water extraction and emergency drying: 900 m2.", confidence: 94, review_status: "accepted", attributes: { demo: true, revision: 2 } },
    { id: DEMO_SCOPE_CONTAINMENT_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, tender_document_id: DEMO_DOCUMENT_SCOPE_ID, trade_profile_id: restorationProfile.id, task_key: "containment", description: "Temporary containment and protection", quantity: 380, unit: "m2", location: "Lower level reading rooms", source_page: 7, evidence_text: "Page 7 — Temporary containment and protection: 380 m2.", confidence: 91, review_status: "accepted", attributes: { demo: true, revision: 2 } }
  ], { onConflict: "id" });
  assertOk(scopeResult, "tender scope quantities");

  const normalizedTender = {
    source: "canadabuys" as const,
    sourceRecordId: tenderPayload.source_record_id,
    solicitationNumber: tenderPayload.solicitation_number,
    title: { en: tenderPayload.title_en, fr: tenderPayload.title_fr },
    description: { en: tenderPayload.description_en, fr: tenderPayload.description_fr },
    buyerName: tenderPayload.buyer_name,
    procurementCategory: tenderPayload.procurement_category as "construction",
    procurementCode: tenderPayload.procurement_code,
    estimatedValueCents: tenderPayload.estimated_value_cents,
    currency: "CAD" as const,
    publishedAt: tenderPayload.published_at,
    closingAt: tenderPayload.closing_at,
    sourceUrl: tenderPayload.source_url,
    rawPayload: Object.fromEntries(Object.entries(tenderPayload.raw_payload).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]))
  };
  const match = matchTender(normalizedTender, { tradeSlugs: ["general-renovation", "fire-water-restoration"], certifications: ["iicrc-wrt", "whmis-2015", "cor-safety"], serviceRegions: ["Toronto", "Peel Region", "York Region"], bondingCapacityCents: 150000000, availableCrewSize: 12, pipelineLoadPercent: 32 });
  const fingerprint = tenderSourceFingerprint(tenderResult.data);
  const analysisResult = await admin.from("tender_analyses").upsert({ id: DEMO_ANALYSIS_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, trade_profile_id: restorationProfile.id, source_fingerprint: fingerprint, detected_trades: match.detectedTrades, matched_trades: ["fire-water-restoration"], decision: "viable", match_score: 90, components: { ...match.components, trade: 40, certification: 10, region: 15, bonding: 15, capacity: 10 }, capability_gaps: [], reasons: ["Trade terms match fire-water restoration.", "IICRC WRT and WHMIS requirements are covered.", "Toronto service coverage is configured.", "Tender value is within bonding capacity.", "Available crew capacity is compatible with the required mobilization window."], computed_at: new Date().toISOString() }, { onConflict: "id" });
  assertOk(analysisResult, "tender analysis");
  const matchResult = await admin.from("tender_matches").upsert({ organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, score: 90, components: { ...match.components, trade: 40, certification: 10, region: 15, bonding: 15, capacity: 10 }, explanation: "90/100 match. The company has a configured fire and water restoration trade, Toronto coverage, required certifications, bonding capacity, and available crew capacity.", computed_at: new Date().toISOString() });
  assertOk(matchResult, "tender match");
  const jobResult = await admin.from("tender_processing_jobs").upsert({ id: DEMO_JOB_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, job_type: "analyze_tender", source_fingerprint: fingerprint, stage: "completed", status: "succeeded", attempt_count: 1, next_run_at: new Date().toISOString(), result_metadata: { demo: true, documentsDiscovered: 2, documentsProcessed: 2, scopeItemsExtracted: 2, estimateGenerated: true }, started_at: isoDate(-1), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "id" });
  assertOk(jobResult, "tender processing job");

  const existingEstimate = await admin.from("estimate_runs").select("*").eq("organization_id", DEMO_ORGANIZATION_ID).eq("tender_id", DEMO_TENDER_ID).eq("trade_profile_id", restorationProfile.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let estimate = existingEstimate.data;
  if (!estimate) {
    const created = await createEstimateRun({ admin, organizationId: DEMO_ORGANIZATION_ID, tenderId: DEMO_TENDER_ID, tradeProfileId: restorationProfile.id, scopeRows: [
      { id: DEMO_SCOPE_WATER_ID, tender_document_id: DEMO_DOCUMENT_SCOPE_ID, task_key: "water-extraction", description: "Water extraction and emergency drying", quantity: 900, unit: "m2", source_page: 4, evidence_text: "Page 4 — Water extraction and emergency drying: 900 m2.", confidence: 94 },
      { id: DEMO_SCOPE_CONTAINMENT_ID, tender_document_id: DEMO_DOCUMENT_SCOPE_ID, task_key: "containment", description: "Temporary containment and protection", quantity: 380, unit: "m2", source_page: 7, evidence_text: "Page 7 — Temporary containment and protection: 380 m2.", confidence: 91 }
    ], tenderAnalysisId: DEMO_ANALYSIS_ID, generatedBy: "northstar-demo-fixture", authSubject: DEMO_AUTH_SUBJECT, matchScore: 90 });
    estimate = created.estimate;
  }
  if (!estimate) throw new Error("Demo estimate was not created");
  const estimatedCostCents = Number(estimate.labor_subtotal_cents) + Number(estimate.material_subtotal_cents) + Number(estimate.equipment_subtotal_cents) + Number(estimate.subcontractor_subtotal_cents) + Number(estimate.overhead_subtotal_cents) + Number(estimate.risk_reserve_cents);
  const contractResult = await admin.from("contracts").upsert({ id: DEMO_CONTRACT_ID, organization_id: DEMO_ORGANIZATION_ID, tender_id: DEMO_TENDER_ID, name: "Toronto Civic Library — Emergency Restoration", status: "complete", estimated_price_cents: estimate.recommended_price_cents, estimated_cost_cents: estimatedCostCents, duration_months: 1 }, { onConflict: "id" }).select("*").single();
  assertOk(contractResult, "completed demo contract");
  const approvedEstimateResult = await admin.from("estimate_runs").update({ status: "approved", contract_id: DEMO_CONTRACT_ID, updated_at: new Date().toISOString() }).eq("id", estimate.id).eq("organization_id", DEMO_ORGANIZATION_ID).select("*").single();
  assertOk(approvedEstimateResult, "approved demo estimate");
  estimate = approvedEstimateResult.data;
  const cashflowResult = await admin.from("contract_monthly_cashflow").upsert([
    { contract_id: DEMO_CONTRACT_ID, month: dateOnly(-2), cost_cents: Math.round(estimatedCostCents * 0.45), billing_cents: Math.round(Number(estimate.recommended_price_cents) * 0.4), assumptions: { demo: true, phase: "mobilization and drying" } },
    { contract_id: DEMO_CONTRACT_ID, month: dateOnly(-1), cost_cents: Math.round(estimatedCostCents * 0.55), billing_cents: Math.round(Number(estimate.recommended_price_cents) * 0.6), assumptions: { demo: true, phase: "containment and restoration" } }
  ], { onConflict: "contract_id,month" });
  assertOk(cashflowResult, "contract cashflow");
  const staffingResult = await admin.from("contract_staffing_plan").upsert([
    { contract_id: DEMO_CONTRACT_ID, role_key: "restoration-supervisor", required_headcount: 1, available_headcount: 2 },
    { contract_id: DEMO_CONTRACT_ID, role_key: "restoration-technician", required_headcount: 2, available_headcount: 6 },
    { contract_id: DEMO_CONTRACT_ID, role_key: "laborer", required_headcount: 1, available_headcount: 3 }
  ], { onConflict: "contract_id,role_key" });
  assertOk(staffingResult, "contract staffing plan");
  const actualsResult = await admin.from("contract_actuals").upsert([
    { id: DEMO_ACTUAL_IDS[0], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "labor", task_key: "water-extraction", quantity: 520, unit: "m2", hours: 74.5, cost_cents: 329525, occurred_on: dateOnly(-45), notes: "First mobilization and extraction pass; occupied reading rooms reduced production." },
    { id: DEMO_ACTUAL_IDS[1], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "labor", task_key: "water-extraction", quantity: 380, unit: "m2", hours: 53.5, cost_cents: 236075, occurred_on: dateOnly(-42), notes: "Final extraction and drying setup." },
    { id: DEMO_ACTUAL_IDS[2], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "labor", task_key: "containment", quantity: 220, unit: "m2", hours: 24.5, cost_cents: 109025, occurred_on: dateOnly(-38), notes: "Containment around the lower-level stacks." },
    { id: DEMO_ACTUAL_IDS[3], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "labor", task_key: "containment", quantity: 160, unit: "m2", hours: 18.5, cost_cents: 82345, occurred_on: dateOnly(-36), notes: "Protection completed before finish restoration." },
    { id: DEMO_ACTUAL_IDS[4], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "material", task_key: null, resource_key: "containment-poly", quantity: 421, unit: "m2", hours: null, cost_cents: 126300, occurred_on: dateOnly(-37), notes: "8% waste observed against the standard containment allowance." },
    { id: DEMO_ACTUAL_IDS[5], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "equipment", task_key: null, resource_key: "air-mover", quantity: 68, unit: "day", hours: null, cost_cents: 258400, occurred_on: dateOnly(-35), notes: "Air movers ran longer than the initial dry-out assumption." },
    { id: DEMO_ACTUAL_IDS[6], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "schedule", task_key: null, quantity: 16, unit: "working days", hours: null, cost_cents: 0, occurred_on: dateOnly(-30), notes: "Completed in 16 working days versus the 13.5-day estimate; access restrictions caused the variance." },
    { id: DEMO_ACTUAL_IDS[7], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "vehicle", task_key: null, resource_key: "restoration-van", quantity: 16, unit: "day", hours: null, cost_cents: 120000, occurred_on: dateOnly(-29), notes: "Dedicated restoration van and daily travel between the shop and site." },
    { id: DEMO_ACTUAL_IDS[8], organization_id: DEMO_ORGANIZATION_ID, contract_id: DEMO_CONTRACT_ID, estimate_run_id: estimate.id, actual_kind: "rework", task_key: null, quantity: 1, unit: "lump sum", hours: null, cost_cents: 50000, occurred_on: dateOnly(-27), notes: "Rework allowance for an additional moisture check and protection reset." }
  ], { onConflict: "id" });
  assertOk(actualsResult, "completed job actuals");

  console.log(JSON.stringify({
    ok: true,
    organizationId: DEMO_ORGANIZATION_ID,
    organizationName: "Northstar Build & Restoration",
    tenderId: DEMO_TENDER_ID,
    tenderTitle: tenderPayload.title_en,
    tradeProfiles: [renovationProfile.id, restorationProfile.id],
    estimateId: estimate.id,
    contractId: DEMO_CONTRACT_ID,
    recommendedPriceCents: Number(estimate.recommended_price_cents),
    estimatedCostCents,
    message: "Demo workspace seeded. Open localhost preview mode to inspect the connected workflow."
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
