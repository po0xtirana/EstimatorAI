import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    const [tender, match] = await Promise.all([
      admin.from("tenders").select("*").eq("id", id).maybeSingle(),
      admin.from("organization_tenders").select("status, match_score").eq("organization_id", ctx.organizationId).eq("tender_id", id).maybeSingle()
    ]);
    if (tender.error || !tender.data) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    return NextResponse.json({ tender: { ...tender.data, status: match.data?.status ?? "new", match_score: match.data?.match_score ?? null } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load tender" }, { status: 401 });
  }
}
