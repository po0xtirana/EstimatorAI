import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../../src/auth/org-context";
import { rollbackLearningModel } from "../../../../../../src/learning/learning-service";
import { createAdminClient } from "../../../../../../src/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can roll back learning" }, { status: 403 });
    const admin = createAdminClient();
    const id = new URL(request.url).pathname.split("/").filter(Boolean).at(-2);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    if (!id) return NextResponse.json({ error: "Model version ID is required" }, { status: 400 });
    return NextResponse.json({ model: await rollbackLearningModel(admin, ctx.organizationId, id, ctx.authSubject) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to roll back the learning model" }, { status: 500 });
  }
}
