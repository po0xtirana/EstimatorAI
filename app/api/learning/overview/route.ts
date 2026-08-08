import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const [organization, evidence, models, workbooks] = await Promise.all([
      admin.from("organizations").select("id, name, shared_learning_opt_in").eq("id", ctx.organizationId).maybeSingle(),
      admin.from("learning_evidence").select("id, contract_actual_id, source_type, normalized_kind, metric, status, quality_score, predicted_cost_cents, observed_cost_cents, created_at").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(500),
      admin.from("learning_model_versions").select("*, trade_profiles(name, trade_slug)").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(100),
      admin.from("estimator_workbook_imports").select("id, purpose, status, reconciliation_status, file_name, row_count, extraction_confidence, created_at, contract_id, estimate_run_id").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(20)
    ]);
    if (evidence.error || models.error || workbooks.error) return NextResponse.json({ error: "Failed to load the learning overview" }, { status: 500 });
    const rows = evidence.data ?? [];
    const sourceCounts = rows.reduce((result: Record<string, number>, row: any) => ({ ...result, [row.source_type]: (result[row.source_type] ?? 0) + 1 }), {});
    const costRows = Array.from(rows.reduce((map: Map<string, any>, row: any) => {
      if (row.predicted_cost_cents === null || row.observed_cost_cents === null) return map;
      const key = row.contract_actual_id ?? row.id;
      if (!map.has(key) || row.metric === "category_cost_factor") map.set(key, row);
      return map;
    }, new Map<string, any>()).values()) as any[];
    const predicted = costRows.reduce((sum: number, row: any) => sum + Number(row.predicted_cost_cents ?? 0), 0);
    const observed = costRows.reduce((sum: number, row: any) => sum + Number(row.observed_cost_cents ?? 0), 0);
    const absoluteError = costRows.reduce((sum: number, row: any) => sum + Math.abs(Number(row.observed_cost_cents) - Number(row.predicted_cost_cents)), 0);
    return NextResponse.json({
      organization: organization.data,
      evidenceCount: rows.filter((row: any) => row.status === "accepted").length,
      sourceCounts,
      portfolioMetrics: {
        predictedCostCents: predicted,
        observedCostCents: observed,
        wapePercent: observed > 0 ? Math.round(absoluteError / observed * 10000) / 100 : null,
        signedBiasPercent: observed > 0 ? Math.round((predicted - observed) / observed * 10000) / 100 : null
      },
      activeModels: (models.data ?? []).filter((model: any) => model.status === "active"),
      modelHistory: models.data ?? [],
      recentWorkbooks: workbooks.data ?? []
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load learning" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can change shared-learning participation" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const result = await admin.from("organizations").update({ shared_learning_opt_in: Boolean(body.sharedLearningOptIn) }).eq("id", ctx.organizationId).select("id, name, shared_learning_opt_in").single();
    if (result.error) return NextResponse.json({ error: "Failed to update shared-learning participation" }, { status: 500 });
    return NextResponse.json({ organization: result.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update learning settings" }, { status: 500 });
  }
}
