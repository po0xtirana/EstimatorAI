import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const estimate = await admin.from("estimate_runs").select("id, expected_cost_cents, p50_cost_cents, p80_cost_cents, accuracy_explanation, learning_model_version_id, learning_model_versions(version_number, methodology, evidence_count, accuracy_metrics, uncertainty_metrics)").eq("organization_id", ctx.organizationId).eq("id", id).maybeSingle();
    if (estimate.error || !estimate.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    return NextResponse.json({ explanation: estimate.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load estimate accuracy details" }, { status: 401 });
  }
}
