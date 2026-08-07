import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createEstimateRun } from "../../../src/estimation/estimate-runner";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data, error } = await admin.from("estimate_runs").select("*, trade_profiles(name, trade_slug), tenders(title_en, title_fr, closing_at)").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to load estimates" }, { status: 500 });
    return NextResponse.json({ estimates: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load estimates" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can generate estimates" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const tenderId = body.tenderId ? String(body.tenderId) : null;
    const tradeProfileId = String(body.tradeProfileId ?? "");
    const regenerate = body.regenerate === true;
    if (!tradeProfileId) return NextResponse.json({ error: "Select a trade profile before generating an estimate" }, { status: 400 });
    if (tenderId) {
      const { data: existing } = await admin.from("estimate_runs").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", tenderId).eq("trade_profile_id", tradeProfileId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing && !regenerate) return NextResponse.json({ estimate: existing, result: null, reused: true }, { status: 200 });
      if (existing && regenerate) await admin.from("estimate_runs").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("organization_id", ctx.organizationId);
    }
    let scopeRows: any[] = [];
    if (Array.isArray(body.scopeItems) && body.scopeItems.length) {
      scopeRows = body.scopeItems.map((row: any, index: number) => ({ id: row.id ?? `manual-${index + 1}`, task_key: row.taskKey, description: row.description, quantity: row.quantity, unit: row.unit, confidence: row.confidence ?? 65, evidence_text: row.evidenceText, source_page: row.sourcePage, tender_document_id: row.tenderDocumentId }));
    } else if (tenderId) {
      const scopeResult = await admin.from("tender_scope_items").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", tenderId).neq("review_status", "rejected").order("created_at");
      if (scopeResult.error) return NextResponse.json({ error: "Failed to load tender scope" }, { status: 500 });
      scopeRows = scopeResult.data ?? [];
    }
    const created = await createEstimateRun({ admin, organizationId: ctx.organizationId, tenderId, tradeProfileId, scopeRows, generatedBy: "manual-estimate", authSubject: ctx.authSubject });
    return NextResponse.json({ estimate: created.estimate, result: created.result, assumptionVersionId: created.assumptionVersionId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate estimate" }, { status: 500 });
  }
}
