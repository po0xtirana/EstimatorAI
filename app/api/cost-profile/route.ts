import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type CostProfilePayload = {
  targetMarkupPercent: number;
  staff: Array<{
    roleKey: string;
    roleNameEn: string;
    roleNameFr?: string;
    hourlyCostCents: number;
  }>;
  materials: Array<{
    materialKey: string;
    materialNameEn: string;
    materialNameFr?: string;
    unit: string;
    unitCostCents: number;
    isSuggestedBaseline?: boolean;
  }>;
  overhead: Array<{
    labelEn: string;
    labelFr?: string;
    amountCents: number;
  }>;
};

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    // Get the latest cost profile version for this org
    const { data: version, error: versionError } = await admin
      .from("cost_profile_versions")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (versionError) {
      console.error("Error fetching cost profile version:", versionError);
      return NextResponse.json({ error: "Failed to fetch cost profile" }, { status: 500 });
    }

    if (!version) {
      return NextResponse.json({ profile: null });
    }

    // Fetch child records
    const [staffResult, materialsResult, overheadResult] = await Promise.all([
      admin.from("staff_cost_rates").select("*").eq("profile_version_id", version.id),
      admin.from("material_cost_rates").select("*").eq("profile_version_id", version.id),
      admin.from("overhead_cost_lines").select("*").eq("profile_version_id", version.id)
    ]);

    return NextResponse.json({
      profile: {
        id: version.id,
        versionNumber: version.version_number,
        effectiveFrom: version.effective_from,
        effectiveTo: version.effective_to,
        targetMarkupPercent: Number(version.target_markup_percent),
        staff: staffResult.data ?? [],
        materials: materialsResult.data ?? [],
        overhead: overheadResult.data ?? []
      }
    });
  } catch (error) {
    console.error("Cost profile GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    }

    const payload = (await request.json()) as CostProfilePayload;

    // Validate required fields
    if (payload.targetMarkupPercent < 0 || payload.targetMarkupPercent > 1000) {
      return NextResponse.json({ error: "Invalid markup percent" }, { status: 400 });
    }

    // Get the latest version number
    const { data: latest, error: latestError } = await admin
      .from("cost_profile_versions")
      .select("version_number")
      .eq("organization_id", ctx.organizationId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error("Error fetching latest version:", latestError);
      return NextResponse.json({ error: "Failed to create cost profile" }, { status: 500 });
    }

    const nextVersion = (latest?.version_number ?? 0) + 1;

    // Create the new version
    const { data: created, error: createError } = await admin
      .from("cost_profile_versions")
      .insert({
        organization_id: ctx.organizationId,
        version_number: nextVersion,
        effective_from: new Date().toISOString().split("T")[0],
        target_markup_percent: payload.targetMarkupPercent
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating cost profile version:", createError);
      return NextResponse.json({ error: "Failed to create cost profile" }, { status: 500 });
    }

    // Insert staff rates
    if (payload.staff.length > 0) {
      const { error: staffError } = await admin.from("staff_cost_rates").insert(
        payload.staff.map((s) => ({
          profile_version_id: created.id,
          role_key: s.roleKey,
          role_name_en: s.roleNameEn,
          role_name_fr: s.roleNameFr ?? null,
          hourly_cost_cents: s.hourlyCostCents
        }))
      );
      if (staffError) {
        console.error("Error inserting staff rates:", staffError);
      }
    }

    // Insert material rates
    if (payload.materials.length > 0) {
      const { error: materialsError } = await admin.from("material_cost_rates").insert(
        payload.materials.map((m) => ({
          profile_version_id: created.id,
          material_key: m.materialKey,
          material_name_en: m.materialNameEn,
          material_name_fr: m.materialNameFr ?? null,
          unit: m.unit,
          unit_cost_cents: m.unitCostCents,
          is_suggested_baseline: m.isSuggestedBaseline ?? false
        }))
      );
      if (materialsError) {
        console.error("Error inserting material rates:", materialsError);
      }
    }

    // Insert overhead lines
    if (payload.overhead.length > 0) {
      const { error: overheadError } = await admin.from("overhead_cost_lines").insert(
        payload.overhead.map((o) => ({
          profile_version_id: created.id,
          label_en: o.labelEn,
          label_fr: o.labelFr ?? null,
          amount_cents: o.amountCents
        }))
      );
      if (overheadError) {
        console.error("Error inserting overhead lines:", overheadError);
      }
    }

    return NextResponse.json({ profile: { id: created.id, versionNumber: nextVersion } });
  } catch (error) {
    console.error("Cost profile PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}