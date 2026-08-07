import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function pathId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const tenderId = pathId(request);
    if (!tenderId) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });
    const { data, error } = await admin.from("tender_scope_items").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", tenderId).order("created_at");
    if (error) return NextResponse.json({ error: "Failed to load scope" }, { status: 500 });
    return NextResponse.json({ scopeItems: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load scope" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can add tender scope" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const tenderId = pathId(request);
    const body = await request.json();
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!tenderId || !description) return NextResponse.json({ error: "Tender ID and scope description are required" }, { status: 400 });
    const quantity = body.quantity === null || body.quantity === undefined || body.quantity === "" ? null : Number(body.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) return NextResponse.json({ error: "Quantity must be non-negative" }, { status: 400 });
    const { data, error } = await admin.from("tender_scope_items").insert({ organization_id: ctx.organizationId, tender_id: tenderId, trade_profile_id: body.tradeProfileId ?? null, task_key: body.taskKey || null, description, quantity, unit: body.unit || null, location: body.location || null, source_page: body.sourcePage ? Number(body.sourcePage) : null, evidence_text: body.evidenceText || null, confidence: body.confidence === undefined ? 65 : Number(body.confidence), review_status: body.reviewStatus ?? "needs_review", attributes: body.attributes ?? {} }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save scope item" }, { status: 500 });
    return NextResponse.json({ scopeItem: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save scope" }, { status: 500 });
  }
}
