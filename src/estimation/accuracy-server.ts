import type { AccuracyScopeItem, AccuracyTradeProfile } from "./accuracy";

function asArray(value: unknown) { return Array.isArray(value) ? value : []; }

export async function loadAccuracyTradeProfile(admin: any, organizationId: string, profileId: string): Promise<AccuracyTradeProfile | null> {
  const [profile, resources, crews, assemblies] = await Promise.all([
    admin.from("trade_profiles").select("*").eq("id", profileId).eq("organization_id", organizationId).maybeSingle(),
    admin.from("trade_profile_resources").select("*").eq("trade_profile_id", profileId).eq("organization_id", organizationId),
    admin.from("trade_profile_crews").select("*, trade_profile_crew_roles(*)").eq("trade_profile_id", profileId).eq("organization_id", organizationId),
    admin.from("trade_profile_assemblies").select("*").eq("trade_profile_id", profileId).eq("organization_id", organizationId)
  ]);
  if (profile.error || !profile.data) return null;
  return {
    tradeSlug: profile.data.trade_slug,
    targetMarkupPercent: Number(profile.data.target_markup_percent ?? 10),
    targetMarginPercent: profile.data.target_margin_percent === null ? null : Number(profile.data.target_margin_percent),
    contingencyPercent: Number(profile.data.contingency_percent ?? 5),
    mobilizationCents: Number(profile.data.mobilization_cents ?? 0),
    travelCostPerKmCents: Number(profile.data.travel_cost_per_km_cents ?? 0),
    serviceRadiusKm: profile.data.service_radius_km === null ? null : Number(profile.data.service_radius_km),
    shiftHours: Number(profile.data.shift_hours ?? 8),
    workingDaysPerWeek: Number(profile.data.working_days_per_week ?? 5),
    currentPipelineLoadPercent: profile.data.current_pipeline_load_percent === null ? null : Number(profile.data.current_pipeline_load_percent),
    resources: (resources.data ?? []).map((resource: any) => ({ resourceKind: resource.resource_kind, resourceKey: resource.resource_key, name: resource.name, unit: resource.unit, rateCents: Number(resource.rate_cents), rateBasis: resource.rate_basis, availableQuantity: resource.available_quantity === null ? null : Number(resource.available_quantity), wastePercent: Number(resource.waste_percent ?? 0) })),
    crews: (crews.data ?? []).map((crew: any) => ({ crewKey: crew.crew_key, name: crew.name, productionFactor: Number(crew.production_factor ?? 1), maxCrewsAvailable: crew.max_crews_available === null ? null : Number(crew.max_crews_available), roles: (crew.trade_profile_crew_roles ?? []).map((role: any) => ({ roleResourceKey: role.role_resource_key, headcount: Number(role.headcount), skillSlugs: role.skill_slugs ?? [] })) })),
    assemblies: (assemblies.data ?? []).map((assembly: any) => ({ taskKey: assembly.task_key, name: assembly.name, unit: assembly.unit, laborHoursPerUnit: Number(assembly.labor_hours_per_unit), defaultWastePercent: Number(assembly.default_waste_percent ?? 0), preferredCrewKey: (crews.data ?? []).find((crew: any) => crew.id === assembly.preferred_crew_id)?.crew_key ?? null, materialComponents: asArray(assembly.material_components), equipmentComponents: asArray(assembly.equipment_components) }))
  };
}

export function mapScopeRow(row: any): AccuracyScopeItem {
  return { id: row.id, taskKey: row.task_key, description: row.description, quantity: row.quantity === null ? null : Number(row.quantity), unit: row.unit, confidence: row.confidence === null ? null : Number(row.confidence), sourceDocumentId: row.tender_document_id, sourcePage: row.source_page, evidenceText: row.evidence_text };
}
