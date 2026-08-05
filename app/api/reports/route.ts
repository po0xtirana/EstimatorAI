import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data: contracts, error: contractsError } = await admin.from("contracts").select("id, name, status, estimated_price_cents, estimated_cost_cents").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false });
    if (contractsError) return NextResponse.json({ error: "Failed to fetch report data" }, { status: 500 });
    const rows = contracts ?? [];
    const ids = rows.map((contract: { id: string }) => contract.id);
    const { data: cashflow, error: cashflowError } = ids.length ? await admin.from("contract_monthly_cashflow").select("contract_id, month, cost_cents, billing_cents").in("contract_id", ids).order("month", { ascending: true }) : { data: [], error: null };
    if (cashflowError) return NextResponse.json({ error: "Failed to fetch cashflow data" }, { status: 500 });
    const monthly = new Map<string, { month: string; costCents: number; billingCents: number }>();
    for (const row of cashflow ?? []) {
      const month = String(row.month).slice(0, 7);
      const current = monthly.get(month) ?? { month, costCents: 0, billingCents: 0 };
      current.costCents += Number(row.cost_cents); current.billingCents += Number(row.billing_cents); monthly.set(month, current);
    }
    const totals = rows.reduce((result: { priceCents: number; costCents: number }, contract: { estimated_price_cents: number | null; estimated_cost_cents: number | null }) => ({ priceCents: result.priceCents + Number(contract.estimated_price_cents ?? 0), costCents: result.costCents + Number(contract.estimated_cost_cents ?? 0) }), { priceCents: 0, costCents: 0 });
    return NextResponse.json({ contracts: rows, totals: { ...totals, marginCents: totals.priceCents - totals.costCents }, monthly: Array.from(monthly.values()).map((row) => ({ ...row, netCashflowCents: row.billingCents - row.costCents, marginPercent: row.billingCents ? Math.round(((row.billingCents - row.costCents) / row.billingCents) * 10000) / 100 : null })) });
  } catch (error) {
    console.error("Reports API error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 401 });
  }
}
