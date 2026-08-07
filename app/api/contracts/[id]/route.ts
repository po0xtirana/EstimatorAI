import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../src/auth/org-context";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const id = request.nextUrl.pathname.split("/").pop();
    if (!id) {
      return NextResponse.json({ error: "Contract ID is required" }, { status: 400 });
    }

    // Fetch the contract
    const { data: contract, error: contractError } = await admin
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .single();

    if (contractError) {
      console.error("Error fetching contract:", contractError);
      return NextResponse.json(
        { error: contractError.code === "PGRST116" ? "Contract not found" : "Failed to fetch contract" },
        { status: contractError.code === "PGRST116" ? 404 : 500 }
      );
    }

    // Fetch associated cashflow and staffing
    const [cashflowResult, staffingResult, estimateResult] = await Promise.all([
      admin.from("contract_monthly_cashflow").select("*").eq("contract_id", id).order("month", { ascending: true }),
      admin.from("contract_staffing_plan").select("*").eq("contract_id", id),
      contract.tender_id ? admin.from("estimate_runs").select("id").eq("organization_id", ctx.organizationId).eq("tender_id", contract.tender_id).order("created_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] as Array<{ id: string }> })
    ]);

    return NextResponse.json({
      contract: {
        ...contract,
        cashflow: cashflowResult.data ?? [],
        staffing: staffingResult.data ?? [],
        estimate_run_id: estimateResult.data?.[0]?.id ?? null
      }
    });
  } catch (error) {
    console.error("Contract detail API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}

// PATCH to update contract details
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can update contracts" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const id = request.nextUrl.pathname.split("/").pop();
    if (!id) {
      return NextResponse.json({ error: "Contract ID is required" }, { status: 400 });
    }

    const body = await request.json();
    const allowedFields = [
      "name",
      "tender_id",
      "project_id",
      "status",
      "estimated_price_cents",
      "estimated_cost_cents",
      "duration_months"
    ] as const;
    const updateData = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        .map((field) => [field, body[field]])
    );

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No editable contract fields supplied" }, { status: 400 });
    }

    if ("name" in updateData && (typeof updateData.name !== "string" || !updateData.name.trim())) {
      return NextResponse.json({ error: "Contract name must be a non-empty string" }, { status: 400 });
    }

    // Ensure org scoping
    const { data: contract, error } = await admin
      .from("contracts")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .select()
      .single();

    if (error) {
      console.error("Error updating contract:", error);
      return NextResponse.json({ error: "Failed to update contract" }, { status: 500 });
    }

    return NextResponse.json({ contract });
  } catch (error) {
    console.error("Contract PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
