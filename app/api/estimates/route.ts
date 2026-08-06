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
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const tenderId = body.tenderId ? String(body.tenderId) : null;
    const tradeProfileId = String(body.tradeProfileId ?? "");
    if (!tradeProfileId) return NextResponse.json({ error: "Select a trade profile before generating an estimate" }, { status: 400 });
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
