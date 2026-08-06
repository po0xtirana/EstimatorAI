import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { loadCompanyReadiness } from "../../../../src/company/readiness";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    return NextResponse.json({ readiness: await loadCompanyReadiness(admin, ctx.organizationId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load company readiness" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can update setup progress" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const valid = new Set(["company", "trades", "coverage", "people", "labor", "crews", "resources", "productivity", "compliance", "commercial"]);
    const completedSteps = Array.isArray(body.completedSteps) ? body.completedSteps.filter((id: unknown): id is string => typeof id === "string" && valid.has(id)) : [];
    const skippedSteps = Array.isArray(body.skippedSteps) ? body.skippedSteps.filter((id: unknown): id is string => typeof id === "string" && valid.has(id)) : [];
    const { data, error } = await admin.from("company_setup_progress").upsert({ organization_id: ctx.organizationId, completed_steps: completedSteps, skipped_steps: skippedSteps, updated_at: new Date().toISOString() }, { onConflict: "organization_id" }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save setup progress" }, { status: 500 });
    return NextResponse.json({ progress: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save setup progress" }, { status: 400 });
  }
}
