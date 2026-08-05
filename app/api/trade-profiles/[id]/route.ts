import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "Profile ID is required" }, { status: 400 });
    const [profile, resources, crews, assemblies] = await Promise.all([
      admin.from("trade_profiles").select("*, trade_catalog(name_en, name_fr)").eq("id", id).eq("organization_id", ctx.organizationId).single(),
      admin.from("trade_profile_resources").select("*").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).order("resource_kind, name"),
      admin.from("trade_profile_crews").select("*, trade_profile_crew_roles(*)").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).order("name"),
      admin.from("trade_profile_assemblies").select("*").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).order("name")
    ]);
    if (profile.error || !profile.data) return NextResponse.json({ error: "Trade profile not found" }, { status: 404 });
    return NextResponse.json({
      profile: profile.data,
      resources: (resources.data ?? []).map((resource: any) => ({
        resourceKind: resource.resource_kind,
        resourceKey: resource.resource_key,
        name: resource.name,
        unit: resource.unit,
        rateCents: Number(resource.rate_cents ?? 0),
        rateBasis: resource.rate_basis,
        availableQuantity: resource.available_quantity === null || resource.available_quantity === undefined ? null : Number(resource.available_quantity),
        wastePercent: Number(resource.waste_percent ?? 0)
      })),
      crews: crews.data ?? [],
      assemblies: assemblies.data ?? []
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load trade profile" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can edit trade profiles" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").pop();
    if (!id) return NextResponse.json({ error: "Profile ID is required" }, { status: 400 });
    const body = await request.json();
    const allowed = ["name", "service_radius_km", "minimum_project_size_cents", "target_markup_percent", "target_margin_percent", "contingency_percent", "mobilization_cents", "travel_cost_per_km_cents", "working_days_per_week", "shift_hours", "overtime_multiplier", "current_pipeline_load_percent", "notes", "active"];
    const updateData = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map((key) => [key, body[key]]));
    updateData.updated_at = new Date().toISOString();
    const result = await admin.from("trade_profiles").update(updateData).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single();
    if (result.error) return NextResponse.json({ error: "Failed to update trade profile" }, { status: 500 });
    if (Array.isArray(body.resources)) {
      await admin.from("trade_profile_resources").delete().eq("trade_profile_id", id).eq("organization_id", ctx.organizationId);
      const resources = body.resources.map((resource: any) => ({ organization_id: ctx.organizationId, trade_profile_id: id, resource_kind: resource.resourceKind, resource_key: resource.resourceKey, name: resource.name, unit: resource.unit, rate_cents: Number(resource.rateCents ?? 0), rate_basis: resource.rateBasis, available_quantity: resource.availableQuantity === null || resource.availableQuantity === undefined ? null : Number(resource.availableQuantity), waste_percent: Number(resource.wastePercent ?? 0), attributes: resource.attributes ?? {} }));
      if (resources.length) await admin.from("trade_profile_resources").insert(resources);
    }
    if (Array.isArray(body.crews) && Array.isArray(body.assemblies)) {
      await admin.from("trade_profile_assemblies").delete().eq("trade_profile_id", id).eq("organization_id", ctx.organizationId);
      await admin.from("trade_profile_crews").delete().eq("trade_profile_id", id).eq("organization_id", ctx.organizationId);
      const crewRows = await Promise.all(body.crews.map((crew: any) => admin.from("trade_profile_crews").insert({ organization_id: ctx.organizationId, trade_profile_id: id, crew_key: crew.crewKey, name: crew.name, production_factor: Number(crew.productionFactor ?? 1), max_crews_available: crew.maxCrewsAvailable === null || crew.maxCrewsAvailable === undefined ? null : Number(crew.maxCrewsAvailable), notes: crew.notes || null }).select("id, crew_key").single()));
      const crewIds = new Map(crewRows.flatMap((row) => row.data ? [[row.data.crew_key, row.data.id] as [string, string]] : []));
      const roles = body.crews.flatMap((crew: any) => (crew.roles ?? []).map((role: any) => ({ organization_id: ctx.organizationId, crew_id: crewIds.get(crew.crewKey), role_resource_key: role.roleResourceKey, headcount: Number(role.headcount ?? 1), skill_slugs: role.skillSlugs ?? [] })));
      if (roles.length) await admin.from("trade_profile_crew_roles").insert(roles);
      const assemblies = body.assemblies.map((assembly: any) => ({ organization_id: ctx.organizationId, trade_profile_id: id, task_key: assembly.taskKey, name: assembly.name, unit: assembly.unit, labor_hours_per_unit: Number(assembly.laborHoursPerUnit ?? 0), default_waste_percent: Number(assembly.defaultWastePercent ?? 0), preferred_crew_id: assembly.preferredCrewKey ? crewIds.get(assembly.preferredCrewKey) ?? null : null, material_components: assembly.materialComponents ?? [], equipment_components: assembly.equipmentComponents ?? [], notes: assembly.notes || null }));
      if (assemblies.length) await admin.from("trade_profile_assemblies").insert(assemblies);
    }
    return NextResponse.json({ profile: result.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update trade profile" }, { status: 500 });
  }
}
