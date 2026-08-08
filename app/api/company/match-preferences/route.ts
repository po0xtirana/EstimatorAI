import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).slice(0, 50);
}

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data, error } = await admin.from("organization_match_preferences").select("preferred_buyers,preferred_project_types,excluded_terms,maximum_project_size_cents,learned_positive_terms,learned_negative_terms,feedback_count,updated_at").eq("organization_id", ctx.organizationId).maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to load opportunity preferences" }, { status: 500 });
    return NextResponse.json({ preferences: data ?? { preferred_buyers: [], preferred_project_types: [], excluded_terms: [], maximum_project_size_cents: null, learned_positive_terms: {}, learned_negative_terms: {}, feedback_count: 0 } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load opportunity preferences" }, { status: 401 }); }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!['owner', 'admin'].includes(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can change company matching rules" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const maximum = body.maximumProjectSizeCents === null || body.maximumProjectSizeCents === "" ? null : Number(body.maximumProjectSizeCents);
    if (maximum !== null && (!Number.isFinite(maximum) || maximum < 0)) return NextResponse.json({ error: "Maximum project size must be a positive amount" }, { status: 400 });
    const { data, error } = await admin.from("organization_match_preferences").upsert({ organization_id: ctx.organizationId, preferred_buyers: stringList(body.preferredBuyers), preferred_project_types: stringList(body.preferredProjectTypes), excluded_terms: stringList(body.excludedTerms), maximum_project_size_cents: maximum, updated_at: new Date().toISOString() }, { onConflict: "organization_id" }).select("*").single();
    if (error) return NextResponse.json({ error: "Unable to save company matching rules" }, { status: 500 });
    return NextResponse.json({ preferences: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save opportunity preferences" }, { status: 500 }); }
}
