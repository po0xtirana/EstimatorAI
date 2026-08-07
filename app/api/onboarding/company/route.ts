import { NextResponse } from "next/server";
import { createClient } from "../../../../src/lib/supabase/server";
import { createAdminClient } from "../../../../src/lib/supabase/admin";
import { classifySkills } from "../../../../src/capability/classifier";
import { SUPPORTED_PILOT_TRADE_SLUGS } from "../../../../src/estimation/supported-trades";
import { cookies, headers } from "next/headers";
import { PREVIEW_COOKIE, isLocalHost } from "../../../../src/lib/preview";

export const dynamic = "force-dynamic";

type StaffInput = { displayName?: string; roleKey: string; roleNameEn: string; skillSummary: string; availableHeadcount: number; hourlyCostCents: number };
type CompanyInput = { companyName: string; industry?: string; website?: string; phone?: string; tradeSlugs: string[]; regions: string[]; certifications: string[]; bondingCapacityCents: number | null; availableCrewSize: number | null; pipelineLoadPercent: number | null; targetMarkupPercent: number; staff: StaffInput[] };

async function subjectFromSession() {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(":")[0];
  if (isLocalHost(host) && (await cookies()).get(PREVIEW_COOKIE)?.value === "1") return "local-preview";
  const supabase = await createClient();
  if (!supabase) throw new Error("AUTH_PROVIDER_NOT_CONFIGURED: set Supabase public environment variables");
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) throw new Error("UNAUTHENTICATED: sign in is required");
  return data.claims.sub;
}

export async function GET() {
  try {
    const subject = await subjectFromSession();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data: membership } = subject === "local-preview" ? { data: { organization_id: "00000000-0000-0000-0000-000000000000" } } : await admin.from("organization_members").select("organization_id").eq("auth_subject", subject).limit(1).maybeSingle();
    const { data: catalog, error: catalogError } = await admin.from("trade_catalog").select("slug, name_en, name_fr").eq("active", true).in("slug", [...SUPPORTED_PILOT_TRADE_SLUGS]).order("name_en");
    if (catalogError) return NextResponse.json({ error: "Failed to load trade catalog" }, { status: 500 });
    if (!membership) return NextResponse.json({ company: null, catalog: catalog ?? [] });
    const organizationId = membership.organization_id;
    const [organization, profile, trades, certifications, regions, version, team] = await Promise.all([
      admin.from("organizations").select("name, industry, website, phone").eq("id", organizationId).single(),
      admin.from("organization_capability_profiles").select("bonding_capacity_cents, available_crew_size, pipeline_load_percent").eq("organization_id", organizationId).maybeSingle(),
      admin.from("organization_trades").select("trade_catalog(slug)").eq("organization_id", organizationId),
      admin.from("organization_certifications").select("certification_key, name_en").eq("organization_id", organizationId),
      admin.from("organization_regions").select("region_key, name_en").eq("organization_id", organizationId),
      admin.from("cost_profile_versions").select("id, target_markup_percent").eq("organization_id", organizationId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
      admin.from("organization_staff").select("display_name, role_title, skill_summary, classified_skills, hourly_cost_cents, available").eq("organization_id", organizationId).order("display_name")
    ]);
    const staff = version.data ? await admin.from("staff_cost_rates").select("role_key, role_name_en, skill_summary, available_headcount, hourly_cost_cents").eq("profile_version_id", version.data.id) : { data: [] };
    return NextResponse.json({ company: { ...organization.data, capability: profile.data, trades: (trades.data ?? []).map((row: { trade_catalog: Array<{ slug: string }> }) => row.trade_catalog?.[0]?.slug).filter(Boolean), certifications: certifications.data ?? [], regions: regions.data ?? [], targetMarkupPercent: Number(version.data?.target_markup_percent ?? 10), staff: staff.data ?? [], team: team.data ?? [] }, catalog: catalog ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load onboarding" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const subject = await subjectFromSession();
    const input = (await request.json()) as CompanyInput;
    if (!input.companyName?.trim()) return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    if (!Array.isArray(input.staff) || input.staff.length === 0) return NextResponse.json({ error: "Add at least one team role" }, { status: 400 });
    if (input.staff.some((staff) => !staff.roleKey?.trim() || !staff.roleNameEn?.trim() || staff.hourlyCostCents < 0 || staff.availableHeadcount < 0)) return NextResponse.json({ error: "Check each team role, headcount, and hourly cost" }, { status: 400 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data: existing } = subject === "local-preview" ? { data: { organization_id: "00000000-0000-0000-0000-000000000000", role: "owner" } } : await admin.from("organization_members").select("organization_id, role").eq("auth_subject", subject).limit(1).maybeSingle();
    if (existing && existing.role !== "owner" && existing.role !== "admin") return NextResponse.json({ error: "Only an organization owner or admin can update company setup" }, { status: 403 });
    let organizationId = existing?.organization_id as string | undefined;
    if (!organizationId) {
      const created = await admin.from("organizations").insert({ name: input.companyName.trim(), industry: input.industry?.trim() || null, website: input.website?.trim() || null, phone: input.phone?.trim() || null }).select("id").single();
      if (created.error || !created.data) return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
      organizationId = created.data.id;
      const member = await admin.from("organization_members").insert({ organization_id: organizationId, auth_subject: subject, role: "owner" });
      if (member.error) return NextResponse.json({ error: "Failed to create company membership" }, { status: 500 });
    } else {
      const updated = await admin.from("organizations").update({ name: input.companyName.trim(), industry: input.industry?.trim() || null, website: input.website?.trim() || null, phone: input.phone?.trim() || null }).eq("id", organizationId);
      if (updated.error) return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
    }
    const selectedPilotTrades = (input.tradeSlugs ?? []).filter((slug) => (SUPPORTED_PILOT_TRADE_SLUGS as readonly string[]).includes(slug));
    const trades = await admin.from("trade_catalog").select("id, slug").in("slug", selectedPilotTrades);
    await admin.from("organization_trades").delete().eq("organization_id", organizationId);
    if ((trades.data ?? []).length) await admin.from("organization_trades").insert((trades.data ?? []).map((trade: { id: string }) => ({ organization_id: organizationId, trade_id: trade.id })));
    await admin.from("organization_certifications").delete().eq("organization_id", organizationId);
    if ((input.certifications ?? []).length) await admin.from("organization_certifications").insert(input.certifications.filter(Boolean).map((name) => ({ organization_id: organizationId, certification_key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), name_en: name.trim() })));
    await admin.from("organization_regions").delete().eq("organization_id", organizationId);
    if ((input.regions ?? []).length) await admin.from("organization_regions").insert(input.regions.filter(Boolean).map((name) => ({ organization_id: organizationId, region_key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), name_en: name.trim() })));
    await admin.from("organization_capability_profiles").upsert({ organization_id: organizationId, bonding_capacity_cents: input.bondingCapacityCents, available_crew_size: input.availableCrewSize, pipeline_load_percent: input.pipelineLoadPercent, updated_at: new Date().toISOString() });
    const latest = await admin.from("cost_profile_versions").select("id, version_number").eq("organization_id", organizationId).order("version_number", { ascending: false }).limit(1).maybeSingle();
    const version = await admin.from("cost_profile_versions").insert({ organization_id: organizationId, version_number: Number(latest.data?.version_number ?? 0) + 1, effective_from: new Date().toISOString().slice(0, 10), target_markup_percent: input.targetMarkupPercent ?? 10 }).select("id").single();
    if (version.error || !version.data) return NextResponse.json({ error: "Failed to create cost profile" }, { status: 500 });
    await admin.from("staff_cost_rates").insert(input.staff.map((staff) => ({ profile_version_id: version.data.id, role_key: staff.roleKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), role_name_en: staff.roleNameEn.trim(), skill_summary: staff.skillSummary?.trim() || null, available_headcount: staff.availableHeadcount, hourly_cost_cents: staff.hourlyCostCents })));
    const existingTeam = await admin.from("organization_staff").select("id").eq("organization_id", organizationId).limit(1);
    if (!existingTeam.data?.length) {
      const profiles = input.staff.filter((staff) => staff.displayName?.trim()).map((staff) => { const classified = classifySkills(staff.roleNameEn, staff.skillSummary ?? ""); return { organization_id: organizationId, display_name: staff.displayName!.trim(), role_title: staff.roleNameEn.trim(), skill_summary: staff.skillSummary?.trim() ?? "", classified_skills: classified.map((skill) => skill.slug), skill_confidence: classified.length ? Math.round(Math.max(...classified.map((skill) => skill.confidence)) * 100) : null, hourly_cost_cents: staff.hourlyCostCents, available: staff.availableHeadcount > 0 }; });
      if (profiles.length) await admin.from("organization_staff").insert(profiles);
    }
    return NextResponse.json({ ok: true, organizationId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save company" }, { status: 500 });
  }
}
