import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";
import { scoreTeamFit } from "../../../src/capability/classifier";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    // Fetch tenders - first get the ones linked to this org from organization_tenders
    const { data: orgTenders, error: orgTendersError } = await admin
      .from("organization_tenders")
      .select("tender_id, match_score, status, tenders(*)")
      .eq("organization_id", ctx.organizationId);

    if (orgTendersError) {
      console.error("Error fetching org tenders:", orgTendersError);
      return NextResponse.json({ error: "Failed to fetch tenders" }, { status: 500 });
    }

    // If no org-linked tenders yet, fetch all construction tenders as fallback
    let tenders = orgTenders ?? [];

    if (!tenders.length) {
      // For Phase 0-1 we show all construction tenders to demonstrate the feed
      const { data: allTenders, error: allTendersError } = await admin
        .from("tenders")
        .select("*")
        .eq("procurement_category", "construction")
        .order("closing_at", { ascending: true })
        .limit(50);

      if (allTendersError) {
        console.error("Error fetching all tenders:", allTendersError);
        return NextResponse.json({ error: "Failed to fetch tenders" }, { status: 500 });
      }

      tenders = allTenders.map((t: any) => ({
        tender_id: t.id,
        match_score: null,
        status: "new",
        tenders: t
      }));
    }

    const { data: staff } = await admin.from("organization_staff").select("role_title, skill_summary, classified_skills").eq("organization_id", ctx.organizationId);
    const enriched = tenders.map((row: any) => {
      const tender = Array.isArray(row.tenders) ? row.tenders[0] : row.tenders;
      const text = tender ? [tender.title_en, tender.title_fr, tender.description_en, tender.description_fr, tender.buyer_name].filter(Boolean).join(" ") : "";
      const fit = scoreTeamFit(text, (staff ?? []).map((member: any) => ({ roleTitle: member.role_title, skillSummary: member.skill_summary ?? "", classifiedSkills: member.classified_skills ?? [] })));
      return { ...row, team_fit_score: fit.score, team_fit_matches: fit.matchedMembers };
    });
    return NextResponse.json({ tenders: enriched });
  } catch (error) {
    console.error("Tenders API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
