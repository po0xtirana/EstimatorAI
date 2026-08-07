import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function estimateId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-1); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = estimateId(request);
    const [estimate, lines, exceptions, demand] = await Promise.all([
      admin.from("estimate_runs").select("*, trade_profiles(name, trade_slug), tenders(title_en, title_fr, closing_at)").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle(),
      admin.from("estimate_lines").select("*").eq("estimate_run_id", id).eq("organization_id", ctx.organizationId).order("kind, label"),
      admin.from("estimate_exceptions").select("*").eq("estimate_run_id", id).eq("organization_id", ctx.organizationId).order("resolved, severity"),
      admin.from("estimate_resource_demand").select("*").eq("estimate_run_id", id).eq("organization_id", ctx.organizationId).order("resource_kind, resource_key")
    ]);
    if (estimate.error || !estimate.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    return NextResponse.json({ estimate: estimate.data, lines: lines.data ?? [], exceptions: exceptions.data ?? [], resourceDemand: demand.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load estimate" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can review estimates" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = estimateId(request);
    const body = await request.json();
    if (body.exceptionId) {
      const result = await admin.from("estimate_exceptions").update({ resolved: Boolean(body.resolved), resolution: body.resolution ?? null, resolved_at: body.resolved ? new Date().toISOString() : null }).eq("id", body.exceptionId).eq("estimate_run_id", id).eq("organization_id", ctx.organizationId).select("*").single();
      if (result.error) return NextResponse.json({ error: "Failed to update exception" }, { status: 500 });
      return NextResponse.json({ exception: result.data });
    }
    if (!["draft", "review", "approved", "rejected", "superseded"].includes(body.status)) return NextResponse.json({ error: "A valid estimate status is required" }, { status: 400 });
    if (body.status === "approved") {
      const { data: blocking } = await admin.from("estimate_exceptions").select("id").eq("estimate_run_id", id).eq("organization_id", ctx.organizationId).eq("severity", "blocking").eq("resolved", false).limit(1).maybeSingle();
      if (blocking) return NextResponse.json({ error: "Resolve all blocking exceptions before approving this estimate" }, { status: 409 });
    }
    const result = await admin.from("estimate_runs").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId).select("*").single();
    if (result.error) return NextResponse.json({ error: "Failed to update estimate" }, { status: 500 });
    return NextResponse.json({ estimate: result.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update estimate" }, { status: 500 });
  }
}
