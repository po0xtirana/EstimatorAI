import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { getTradeTemplate, listTradeTemplates } from "../../../src/estimation/trade-templates";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data, error } = await admin.from("trade_profiles").select("*, trade_catalog(name_en, name_fr)").eq("organization_id", ctx.organizationId).order("name");
    if (error) return NextResponse.json({ error: "Failed to load trade profiles" }, { status: 500 });
    return NextResponse.json({ profiles: data ?? [], templates: listTradeTemplates().map(({ tradeSlug, name }) => ({ tradeSlug, name })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load trade profiles" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can manage trade profiles" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const tradeSlug = slugify(String(body.tradeSlug ?? ""));
    const template = getTradeTemplate(tradeSlug);
    if (!template) return NextResponse.json({ error: "Choose a supported trade profile" }, { status: 400 });
    const profileResult = await admin.from("trade_profiles").insert({ organization_id: ctx.organizationId, trade_slug: tradeSlug, name: String(body.name ?? template.name).trim() || template.name, service_radius_km: body.serviceRadiusKm ?? null, minimum_project_size_cents: body.minimumProjectSizeCents ?? null, target_markup_percent: body.targetMarkupPercent ?? 10, target_margin_percent: body.targetMarginPercent ?? null, contingency_percent: body.contingencyPercent ?? 5, mobilization_cents: body.mobilizationCents ?? 0, travel_cost_per_km_cents: body.travelCostPerKmCents ?? 0, working_days_per_week: body.workingDaysPerWeek ?? 5, shift_hours: body.shiftHours ?? 8, overtime_multiplier: body.overtimeMultiplier ?? 1.5, current_pipeline_load_percent: body.currentPipelineLoadPercent ?? null }).select("*").single();
    if (profileResult.error || !profileResult.data) return NextResponse.json({ error: profileResult.error?.code === "23505" ? "This trade profile already exists" : "Failed to create trade profile" }, { status: 500 });
    const profileId = profileResult.data.id;
    const resources = template.resources.map((resource) => ({ organization_id: ctx.organizationId, trade_profile_id: profileId, resource_kind: resource.resourceKind, resource_key: resource.resourceKey, name: resource.name, unit: resource.unit, rate_cents: resource.rateCents, rate_basis: resource.rateBasis, available_quantity: resource.availableQuantity ?? null, waste_percent: resource.wastePercent ?? 0 }));
    if (resources.length) await admin.from("trade_profile_resources").insert(resources);
    const crews = await Promise.all(template.crews.map(async (crew) => admin.from("trade_profile_crews").insert({ organization_id: ctx.organizationId, trade_profile_id: profileId, crew_key: crew.crewKey, name: crew.name, production_factor: crew.productionFactor, max_crews_available: crew.maxCrewsAvailable ?? null }).select("id, crew_key").single()));
    const crewIds = new Map(crews.flatMap((result) => result.data ? [[result.data.crew_key, result.data.id] as [string, string]] : []));
    const crewRoles = template.crews.flatMap((crew) => (crew.roles ?? []).map((role) => ({ organization_id: ctx.organizationId, crew_id: crewIds.get(crew.crewKey), role_resource_key: role.roleResourceKey, headcount: role.headcount, skill_slugs: role.skillSlugs ?? [] })));
    if (crewRoles.length) await admin.from("trade_profile_crew_roles").insert(crewRoles);
    const assemblies = template.assemblies.map((assembly) => ({ organization_id: ctx.organizationId, trade_profile_id: profileId, task_key: assembly.taskKey, name: assembly.name, unit: assembly.unit, labor_hours_per_unit: assembly.laborHoursPerUnit, default_waste_percent: assembly.defaultWastePercent ?? 0, preferred_crew_id: assembly.preferredCrewKey ? crewIds.get(assembly.preferredCrewKey) ?? null : null, material_components: assembly.materialComponents ?? [], equipment_components: assembly.equipmentComponents ?? [] }));
    if (assemblies.length) await admin.from("trade_profile_assemblies").insert(assemblies);
    return NextResponse.json({ profile: profileResult.data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create trade profile" }, { status: 500 });
  }
}
