import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";
import { classifySkills } from "../../../../src/capability/classifier";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can manage team profiles" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { id } = await context.params;
    const body = await request.json();
    const roleTitle = typeof body.roleTitle === "string" ? body.roleTitle.trim() : "";
    const skillSummary = typeof body.skillSummary === "string" ? body.skillSummary.trim() : "";
    const update = { display_name: typeof body.displayName === "string" ? body.displayName.trim() : undefined, role_title: roleTitle || undefined, skill_summary: skillSummary, classified_skills: classifySkills(roleTitle, skillSummary).map((skill) => skill.slug), hourly_cost_cents: Number(body.hourlyCostCents), available: body.available !== false, updated_at: new Date().toISOString() };
    if (!update.display_name || !update.role_title || !Number.isSafeInteger(update.hourly_cost_cents) || update.hourly_cost_cents < 0) return NextResponse.json({ error: "Name, role, and a valid hourly cost are required" }, { status: 400 });
    const { data, error } = await admin.from("organization_staff").update(update).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to update team profile" }, { status: 500 });
    return NextResponse.json({ staff: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update team profile" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOrganizationContext();
    if (ctx.role !== "owner" && ctx.role !== "admin") return NextResponse.json({ error: "Only an owner or admin can manage team profiles" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { id } = await context.params;
    const { error } = await admin.from("organization_staff").delete().eq("id", id).eq("organization_id", ctx.organizationId);
    if (error) return NextResponse.json({ error: "Failed to remove team profile" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove team profile" }, { status: 500 });
  }
}
