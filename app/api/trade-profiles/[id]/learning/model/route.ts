import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../../src/auth/org-context";
import { loadActiveLearningModel } from "../../../../../../src/learning/learning-service";
import { createAdminClient } from "../../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-3);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    if (!id) return NextResponse.json({ error: "Trade profile ID is required" }, { status: 400 });
    const model = await loadActiveLearningModel(admin, ctx.organizationId, id);
    const evidence = await admin.from("learning_evidence").select("*").eq("organization_id", ctx.organizationId).eq("trade_profile_id", id).eq("status", "accepted").order("created_at", { ascending: false }).limit(100);
    if (evidence.error) return NextResponse.json({ error: "Failed to load model evidence" }, { status: 500 });
    return NextResponse.json({ model, evidence: evidence.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the learning model" }, { status: 401 });
  }
}
