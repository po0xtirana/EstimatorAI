import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ActualRow = { estimate_run_id: string | null; task_key: string | null; actual_kind: string; hours: number | null; quantity: number | null; cost_cents: number | null; reconciliation_status?: string };
type AssemblyRow = { id: string; task_key: string; name: string; unit: string; labor_hours_per_unit: number };

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    if (!id) return NextResponse.json({ error: "Trade profile ID is required" }, { status: 400 });
    const [assembliesResult, estimatesResult, versionsResult] = await Promise.all([
      admin.from("trade_profile_assemblies").select("id, task_key, name, unit, labor_hours_per_unit").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId),
      admin.from("estimate_runs").select("id").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId),
      admin.from("trade_profile_assumption_versions").select("id, version_number, source, change_reason, created_at").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).order("version_number", { ascending: false }).limit(20)
    ]);
    const estimateIds = (estimatesResult.data ?? []).map((estimate) => estimate.id);
    const versions = versionsResult.data ?? [];
    if (!estimateIds.length) return NextResponse.json({ suggestions: [], sampleCount: 0, versions });
    const actualsResult = await admin.from("contract_actuals").select("estimate_run_id, task_key, actual_kind, hours, quantity, cost_cents, reconciliation_status").eq("organization_id", ctx.organizationId).in("estimate_run_id", estimateIds).eq("actual_kind", "labor").neq("reconciliation_status", "rejected");
    if (actualsResult.error) return NextResponse.json({ error: "Failed to load actual job results" }, { status: 500 });
    const assemblies = (assembliesResult.data ?? []) as AssemblyRow[];
    const groups = new Map<string, { projectIds: Set<string>; hours: number; quantity: number; cost: number }>();
    for (const actual of (actualsResult.data ?? []) as ActualRow[]) {
      if (!actual.task_key) continue;
      const group = groups.get(actual.task_key) ?? { projectIds: new Set<string>(), hours: 0, quantity: 0, cost: 0 };
      if (actual.estimate_run_id) group.projectIds.add(actual.estimate_run_id);
      group.hours += Number(actual.hours ?? 0);
      group.quantity += Number(actual.quantity ?? 0);
      group.cost += Number(actual.cost_cents ?? 0);
      groups.set(actual.task_key, group);
    }
    const suggestions = Array.from(groups.entries()).map(([taskKey, group]) => {
      const assembly = assemblies.find((candidate) => candidate.task_key === taskKey);
      return {
        taskKey,
        assemblyId: assembly?.id ?? null,
        name: assembly?.name ?? taskKey,
        unit: assembly?.unit ?? "unit",
        sampleCount: group.projectIds.size,
        currentLaborHoursPerUnit: assembly?.labor_hours_per_unit ?? null,
        suggestedLaborHoursPerUnit: group.quantity > 0 ? Math.round((group.hours / group.quantity) * 10000) / 10000 : null,
        actualHourlyCostCents: group.hours > 0 ? Math.round(group.cost / group.hours) : null,
        actualCostCents: group.cost,
        reviewRequired: true
      };
    }).sort((a, b) => b.sampleCount - a.sampleCount);
    return NextResponse.json({ suggestions, sampleCount: suggestions.reduce((sum, suggestion) => sum + suggestion.sampleCount, 0), versions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load learning summary" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can apply learning suggestions" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    const body = await request.json();
    const taskKey = typeof body.taskKey === "string" ? body.taskKey.trim() : "";
    const suggestedLaborHoursPerUnit = Number(body.suggestedLaborHoursPerUnit);
    if (!id || !taskKey || !Number.isFinite(suggestedLaborHoursPerUnit) || suggestedLaborHoursPerUnit < 0) return NextResponse.json({ error: "A valid task and suggested productivity are required" }, { status: 400 });
    const { data: assembly, error: assemblyError } = await admin.from("trade_profile_assemblies").select("id, task_key, name, unit, labor_hours_per_unit, material_components, equipment_components, preferred_crew_id").eq("id", body.assemblyId ?? "").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    const fallbackAssembly = assembly ?? (await admin.from("trade_profile_assemblies").select("id, task_key, name, unit, labor_hours_per_unit, material_components, equipment_components, preferred_crew_id").eq("task_key", taskKey).eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).maybeSingle()).data;
    if (assemblyError && !fallbackAssembly) return NextResponse.json({ error: "Unable to load production template" }, { status: 500 });
    if (!fallbackAssembly) return NextResponse.json({ error: "Production template not found" }, { status: 404 });
    const { data: previousVersions } = await admin.from("trade_profile_assumption_versions").select("version_number").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).order("version_number", { ascending: false }).limit(1);
    const versionNumber = Number(previousVersions?.[0]?.version_number ?? 0) + 1;
    const before = { laborHoursPerUnit: Number(fallbackAssembly.labor_hours_per_unit) };
    const after = { laborHoursPerUnit: suggestedLaborHoursPerUnit };
    const { data: snapshot, error: snapshotError } = await admin.from("trade_profile_assumption_versions").insert({ organization_id: ctx.organizationId, trade_profile_id: id, version_number: versionNumber, source: "actuals_learning", change_reason: `Applied reviewed actuals suggestion for ${taskKey}`, created_by: ctx.authSubject, snapshot: { taskKey, assemblyId: fallbackAssembly.id, before, after, sampleCount: Number(body.sampleCount ?? 0), actualHourlyCostCents: body.actualHourlyCostCents ?? null } }).select("*").single();
    if (snapshotError) return NextResponse.json({ error: "Failed to record assumption version" }, { status: 500 });
    const { data: updated, error: updateError } = await admin.from("trade_profile_assemblies").update({ labor_hours_per_unit: suggestedLaborHoursPerUnit, updated_at: new Date().toISOString() }).eq("id", fallbackAssembly.id).eq("trade_profile_id", id).eq("organization_id", ctx.organizationId).select("*").single();
    if (updateError || !updated) {
      await admin.from("trade_profile_assumption_versions").delete().eq("id", snapshot.id).eq("organization_id", ctx.organizationId);
      return NextResponse.json({ error: "Failed to apply productivity suggestion" }, { status: 500 });
    }
    return NextResponse.json({ assembly: updated, version: snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to apply learning suggestion" }, { status: 500 });
  }
}
