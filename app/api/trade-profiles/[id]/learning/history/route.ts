import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-3);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const result = await admin.from("learning_model_versions").select("*").eq("organization_id", ctx.organizationId).eq("trade_profile_id", id).order("version_number", { ascending: false }).limit(50);
    if (result.error) return NextResponse.json({ error: "Failed to load learning history" }, { status: 500 });
    return NextResponse.json({ versions: result.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load learning history" }, { status: 401 });
  }
}
