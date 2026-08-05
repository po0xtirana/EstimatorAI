import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const { data: contracts, error } = await admin
      .from("contracts")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching contracts:", error);
      return NextResponse.json({ error: "Failed to fetch contracts" }, { status: 500 });
    }

    return NextResponse.json({ contracts: contracts ?? [] });
  } catch (error) {
    console.error("Contracts API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { name, tender_id, project_id, status = "bid", estimated_price_cents, estimated_cost_cents, duration_months } = body;

    if (!name) {
      return NextResponse.json({ error: "Contract name is required" }, { status: 400 });
    }

    const { data: contract, error } = await admin
      .from("contracts")
      .insert({
        organization_id: ctx.organizationId,
        name,
        tender_id: tender_id ?? null,
        project_id: project_id ?? null,
        status,
        estimated_price_cents: estimated_price_cents ?? null,
        estimated_cost_cents: estimated_cost_cents ?? null,
        duration_months: duration_months ?? null
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating contract:", error);
      return NextResponse.json({ error: "Failed to create contract" }, { status: 500 });
    }

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error("Contracts POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}