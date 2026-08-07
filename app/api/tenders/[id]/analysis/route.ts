import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    if (!id) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });
    const { data, error } = await admin.from("tender_analyses").select("*, trade_profiles(name, trade_slug)").eq("organization_id", ctx.organizationId).eq("tender_id", id).order("computed_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: "Unable to load tender analysis" }, { status: 500 });
    return NextResponse.json({ analysis: data ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load tender analysis" }, { status: 401 });
  }
}
