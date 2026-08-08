import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";
import { scoreTeamFit } from "../../../src/capability/classifier";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const showAll = new URL(request.url).searchParams.get("view") === "all";
    let query = admin
      .from("organization_tenders")
      .select("tender_id, match_score, status, decision, recommended_action, urgency, estimating_effort_minutes, updated_at, tenders(*)")
      .eq("organization_id", ctx.organizationId)
      .order("match_score", { ascending: false, nullsFirst: false });
    if (!showAll) query = query.in("status", ["reviewing", "bid"]);
    const { data: orgTenders, error: orgTendersError } = await query.limit(showAll ? 500 : 150);

    if (orgTendersError) {
      console.error("Error fetching org tenders:", orgTendersError);
      return NextResponse.json({ error: "Failed to fetch tenders" }, { status: 500 });
    }

    const tenders = orgTenders ?? [];
    const tenderIds = tenders.map((row: any) => row.tender_id);

    const [{ data: staff }, { data: analyses }, { data: feedback }, { data: jobs }] = await Promise.all([
      admin.from("organization_staff").select("role_title, skill_summary, classified_skills").eq("organization_id", ctx.organizationId),
      tenderIds.length ? admin.from("tender_analyses").select("tender_id,detected_trades,matched_trades,decision,match_score,capability_gaps,reasons,project_type,urgency,expected_estimating_effort_minutes,recommended_action,computed_at").eq("organization_id", ctx.organizationId).in("tender_id", tenderIds).order("computed_at", { ascending: false }) : Promise.resolve({ data: [] }),
      tenderIds.length ? admin.from("tender_relevance_feedback").select("tender_id,label,reason").eq("organization_id", ctx.organizationId).in("tender_id", tenderIds) : Promise.resolve({ data: [] }),
      tenderIds.length ? admin.from("tender_processing_jobs").select("tender_id,status,stage,last_error,updated_at").eq("organization_id", ctx.organizationId).in("tender_id", tenderIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [] })
    ]);
    const analysisByTender = new Map<string, any>();
    for (const analysis of analyses ?? []) if (!analysisByTender.has(analysis.tender_id)) analysisByTender.set(analysis.tender_id, analysis);
    const feedbackByTender = new Map((feedback ?? []).map((row: any) => [row.tender_id, row]));
    const jobByTender = new Map<string, any>();
    for (const job of jobs ?? []) if (!jobByTender.has(job.tender_id)) jobByTender.set(job.tender_id, job);
    const enriched = tenders.map((row: any) => {
      const tender = Array.isArray(row.tenders) ? row.tenders[0] : row.tenders;
      const text = tender ? [tender.title_en, tender.title_fr, tender.description_en, tender.description_fr, tender.buyer_name].filter(Boolean).join(" ") : "";
      const fit = scoreTeamFit(text, (staff ?? []).map((member: any) => ({ roleTitle: member.role_title, skillSummary: member.skill_summary ?? "", classifiedSkills: member.classified_skills ?? [] })));
      return { ...row, analysis: analysisByTender.get(row.tender_id) ?? null, relevance_feedback: feedbackByTender.get(row.tender_id) ?? null, processing_job: jobByTender.get(row.tender_id) ?? null, team_fit_score: fit.score, team_fit_matches: fit.matchedMembers };
    });
    return NextResponse.json({ tenders: enriched, view: showAll ? "all" : "recommended", summary: { recommended: enriched.filter((row: any) => ["reviewing", "bid"].includes(row.status)).length, notViable: enriched.filter((row: any) => row.status === "no_go").length, awaitingAnalysis: enriched.filter((row: any) => row.status === "new").length } });
  } catch (error) {
    console.error("Tenders API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
