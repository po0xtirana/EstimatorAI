import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function contractId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = contractId(request);
    const { data, error } = await admin.from("contract_actuals").select("*").eq("organization_id", ctx.organizationId).eq("contract_id", id).order("occurred_on", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to load actuals" }, { status: 500 });
    return NextResponse.json({ actuals: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load actuals" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = contractId(request);
    const body = await request.json();
    if (!id || !body.actualKind) return NextResponse.json({ error: "Contract and actual type are required" }, { status: 400 });
    const { data, error } = await admin.from("contract_actuals").insert({ organization_id: ctx.organizationId, contract_id: id, estimate_run_id: body.estimateRunId ?? null, actual_kind: body.actualKind, task_key: body.taskKey || null, resource_key: body.resourceKey || null, quantity: body.quantity === undefined ? null : Number(body.quantity), unit: body.unit || null, hours: body.hours === undefined ? null : Number(body.hours), cost_cents: body.costCents === undefined ? null : Number(body.costCents), occurred_on: body.occurredOn || new Date().toISOString().slice(0, 10), notes: body.notes || null }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save actual result" }, { status: 500 });
    return NextResponse.json({ actual: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save actual result" }, { status: 500 });
  }
}
