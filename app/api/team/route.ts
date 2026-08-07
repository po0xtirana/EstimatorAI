import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";
import { classifySkills } from "../../../src/capability/classifier";

export const dynamic = "force-dynamic";

function canEdit(role: string) { return role === "owner" || role === "admin"; }

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data, error } = await admin.from("organization_staff").select("*").eq("organization_id", ctx.organizationId).order("display_name");
    if (error) return NextResponse.json({ error: "Failed to fetch team" }, { status: 500 });
    return NextResponse.json({ staff: data ?? [], canEdit: canEdit(ctx.role) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!canEdit(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can manage team profiles" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const roleTitle = typeof body.roleTitle === "string" ? body.roleTitle.trim() : "";
    const skillSummary = typeof body.skillSummary === "string" ? body.skillSummary.trim() : "";
    const hourlyCostCents = Number(body.hourlyCostCents ?? 0);
    if (!displayName || !roleTitle) return NextResponse.json({ error: "Name and role are required" }, { status: 400 });
    if (!Number.isSafeInteger(hourlyCostCents) || hourlyCostCents < 0) return NextResponse.json({ error: "Hourly cost must be a non-negative whole number of cents" }, { status: 400 });
    const classified = classifySkills(roleTitle, skillSummary);
    const { data, error } = await admin.from("organization_staff").insert({ organization_id: ctx.organizationId, display_name: displayName, role_title: roleTitle, skill_summary: skillSummary, classified_skills: classified.map((skill) => skill.slug), skill_confidence: classified.length ? Math.round(Math.max(...classified.map((skill) => skill.confidence)) * 100) : null, hourly_cost_cents: hourlyCostCents, available: body.available !== false }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save team profile" }, { status: 500 });
    return NextResponse.json({ staff: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save team profile" }, { status: 500 });
  }
}
