import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ActualRow = { task_key: string | null; actual_kind: string; hours: number | null; quantity: number | null; cost_cents: number | null };
type AssemblyRow = { task_key: string; name: string; unit: string; labor_hours_per_unit: number };

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    if (!id) return NextResponse.json({ error: "Trade profile ID is required" }, { status: 400 });
    const [assembliesResult, estimatesResult] = await Promise.all([
      admin.from("trade_profile_assemblies").select("task_key, name, unit, labor_hours_per_unit").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId),
      admin.from("estimate_runs").select("id").eq("trade_profile_id", id).eq("organization_id", ctx.organizationId)
    ]);
    const estimateIds = (estimatesResult.data ?? []).map((estimate) => estimate.id);
    if (!estimateIds.length) return NextResponse.json({ suggestions: [], sampleCount: 0 });
    const actualsResult = await admin.from("contract_actuals").select("task_key, actual_kind, hours, quantity, cost_cents").eq("organization_id", ctx.organizationId).in("estimate_run_id", estimateIds).in("actual_kind", ["labor", "material", "equipment", "subcontractor"]);
    if (actualsResult.error) return NextResponse.json({ error: "Failed to load actual job results" }, { status: 500 });
    const assemblies = (assembliesResult.data ?? []) as AssemblyRow[];
    const groups = new Map<string, { sampleCount: number; hours: number; quantity: number; cost: number; costHours: number }>();
    for (const actual of (actualsResult.data ?? []) as ActualRow[]) {
      if (!actual.task_key) continue;
      const group = groups.get(actual.task_key) ?? { sampleCount: 0, hours: 0, quantity: 0, cost: 0, costHours: 0 };
      group.sampleCount += 1;
      group.hours += Number(actual.hours ?? 0);
      group.quantity += Number(actual.quantity ?? 0);
      group.cost += Number(actual.cost_cents ?? 0);
      if (actual.hours && actual.hours > 0) group.costHours += Number(actual.cost_cents ?? 0) / Number(actual.hours);
      groups.set(actual.task_key, group);
    }
    const suggestions = Array.from(groups.entries()).map(([taskKey, group]) => {
      const assembly = assemblies.find((candidate) => candidate.task_key === taskKey);
      return {
        taskKey,
        name: assembly?.name ?? taskKey,
        unit: assembly?.unit ?? "unit",
        sampleCount: group.sampleCount,
        currentLaborHoursPerUnit: assembly?.labor_hours_per_unit ?? null,
        suggestedLaborHoursPerUnit: group.quantity > 0 ? Math.round((group.hours / group.quantity) * 10000) / 10000 : null,
        actualHourlyCostCents: group.hours > 0 ? Math.round(group.cost / group.hours) : null,
        actualCostCents: group.cost,
        reviewRequired: true
      };
    }).sort((a, b) => b.sampleCount - a.sampleCount);
    return NextResponse.json({ suggestions, sampleCount: suggestions.reduce((sum, suggestion) => sum + suggestion.sampleCount, 0) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load learning summary" }, { status: 401 });
  }
}
