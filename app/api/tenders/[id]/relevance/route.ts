import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";
import { learnRelevanceTerms } from "../../../../../src/matching/relevance-learning";

export const dynamic = "force-dynamic";

function pathId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }
function tenderText(tender: any): string { return [tender?.title_en, tender?.title_fr, tender?.description_en, tender?.description_fr, tender?.buyer_name, tender?.procurement_code].filter(Boolean).join(" "); }

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!['owner', 'admin', 'estimator'].includes(ctx.role)) return NextResponse.json({ error: "Only an estimator, admin, or owner can train opportunity relevance" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = pathId(request);
    const body = await request.json();
    const label = body.label === "relevant" || body.label === "not_relevant" ? body.label : null;
    if (!id || !label) return NextResponse.json({ error: "Choose relevant or not relevant" }, { status: 400 });
    const { data: tender } = await admin.from("tenders").select("id").eq("id", id).maybeSingle();
    if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    const feedback = await admin.from("tender_relevance_feedback").upsert({ organization_id: ctx.organizationId, tender_id: id, label, reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null, created_by: ctx.authSubject, updated_at: new Date().toISOString() }, { onConflict: "organization_id,tender_id" });
    if (feedback.error) return NextResponse.json({ error: "Unable to save relevance feedback" }, { status: 500 });
    await admin.from("organization_tenders").update({ status: label === "relevant" ? "reviewing" : "no_go", updated_at: new Date().toISOString() }).eq("organization_id", ctx.organizationId).eq("tender_id", id);

    const { data: observations } = await admin.from("tender_relevance_feedback").select("label, tenders(title_en,title_fr,description_en,description_fr,buyer_name,procurement_code)").eq("organization_id", ctx.organizationId);
    const learned = learnRelevanceTerms((observations ?? []).map((row: any) => ({ label: row.label, text: tenderText(Array.isArray(row.tenders) ? row.tenders[0] : row.tenders) })));
    await admin.from("organization_match_preferences").upsert({ organization_id: ctx.organizationId, learned_positive_terms: learned.positive, learned_negative_terms: learned.negative, feedback_count: observations?.length ?? 0, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    return NextResponse.json({ feedback: { tenderId: id, label }, learnedTerms: learned, evidenceCount: observations?.length ?? 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save relevance feedback" }, { status: 500 });
  }
}
