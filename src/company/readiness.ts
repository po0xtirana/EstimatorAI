export type ReadinessStep = {
  id: string;
  label: string;
  description: string;
  href: string;
  required: boolean;
  complete: boolean;
  detail: string;
};

export type CompanyReadiness = {
  organizationId: string;
  organizationName: string | null;
  steps: ReadinessStep[];
  completedSteps: string[];
  skippedSteps: string[];
  completedCount: number;
  totalCount: number;
  blockingItems: string[];
  warningItems: string[];
  readyForBidding: boolean;
};

const step = (id: string, label: string, description: string, href: string, required: boolean, complete: boolean, detail: string): ReadinessStep => ({ id, label, description, href, required, complete, detail });

export async function loadCompanyReadiness(admin: any, organizationId: string): Promise<CompanyReadiness> {
  const [organization, trades, regions, certifications, staff, profiles, resources, crews, roles, assemblies, progress] = await Promise.all([
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    admin.from("organization_trades").select("trade_id").eq("organization_id", organizationId),
    admin.from("organization_regions").select("region_key").eq("organization_id", organizationId),
    admin.from("organization_certifications").select("certification_key").eq("organization_id", organizationId),
    admin.from("organization_staff").select("id").eq("organization_id", organizationId),
    admin.from("trade_profiles").select("id, target_markup_percent, contingency_percent").eq("organization_id", organizationId).eq("active", true),
    admin.from("trade_profile_resources").select("id, resource_kind").eq("organization_id", organizationId),
    admin.from("trade_profile_crews").select("id").eq("organization_id", organizationId),
    admin.from("trade_profile_crew_roles").select("id").eq("organization_id", organizationId),
    admin.from("trade_profile_assemblies").select("id").eq("organization_id", organizationId),
    admin.from("company_setup_progress").select("completed_steps, skipped_steps").eq("organization_id", organizationId).maybeSingle()
  ]);
  const profileRows = profiles.data ?? [];
  const profileCount = profileRows.length;
  const laborCount = (resources.data ?? []).filter((resource: any) => resource.resource_kind === "labor").length;
  const nonLaborCount = (resources.data ?? []).filter((resource: any) => resource.resource_kind !== "labor").length;
  const requiredSteps: ReadinessStep[] = [
    step("company", "Company identity", "Add the company name and operating details.", "/onboarding/company?step=company", true, Boolean(organization.data?.name), organization.data?.name ? "Company details saved" : "Company name is missing"),
    step("trades", "Supported trades", "Choose the work your company is equipped to deliver.", "/onboarding/company?step=trades", true, Boolean(trades.data?.length), trades.data?.length ? `${trades.data.length} trade(s) selected` : "Select at least one supported trade"),
    step("coverage", "Service areas", "Tell us where your crews can work.", "/onboarding/company?step=coverage", true, Boolean(regions.data?.length), regions.data?.length ? `${regions.data.length} service area(s)` : "Add at least one service area"),
    step("people", "People and skills", "Add the people, skills, and availability that drive staffing fit.", "/team", true, Boolean(staff.data?.length), staff.data?.length ? `${staff.data.length} employee profile(s)` : "Add at least one employee profile"),
    step("labor", "Loaded labor costs", "Configure the internal labor cost used in pricing.", "/trade-profiles", true, laborCount > 0, laborCount ? `${laborCount} labor rate(s)` : "Add labor rates to an operating model"),
    step("crews", "Crews and roles", "Define the crew combinations that can deliver each task.", "/trade-profiles", true, Boolean(crews.data?.length && roles.data?.length), crews.data?.length && roles.data?.length ? `${crews.data.length} crew(s), ${roles.data.length} role assignment(s)` : "Add crews with role requirements"),
    step("resources", "Materials and equipment", "Add consumption, waste, equipment, and subcontractor assumptions.", "/trade-profiles", true, nonLaborCount > 0, nonLaborCount ? `${nonLaborCount} non-labor resource(s)` : "Add material or equipment rates"),
    step("productivity", "Productivity templates", "Map tender tasks to production rates and assemblies.", "/trade-profiles", true, Boolean(assemblies.data?.length), assemblies.data?.length ? `${assemblies.data.length} assembly template(s)` : "Add at least one productivity template"),
    step("compliance", "Compliance and bonding", "Record certifications and bonding capacity so bid decisions are safe.", "/onboarding/company?step=compliance", false, Boolean(certifications.data?.length), certifications.data?.length ? `${certifications.data.length} certification(s)` : "No certifications recorded yet"),
    step("commercial", "Commercial defaults", "Set markup, contingency, and project-size rules.", "/trade-profiles", true, profileCount > 0 && profileRows.every((profile: any) => profile.target_markup_percent !== null && profile.contingency_percent !== null), profileCount ? `${profileCount} operating model(s) have commercial defaults` : "Create an operating model")
  ];
  const completedSteps = Array.isArray(progress.data?.completed_steps) ? progress.data.completed_steps : [];
  const skippedSteps = Array.isArray(progress.data?.skipped_steps) ? progress.data.skipped_steps : [];
  const blockingItems = requiredSteps.filter((item) => item.required && !item.complete).map((item) => item.label);
  const warningItems = requiredSteps.filter((item) => !item.required && !item.complete).map((item) => item.label);
  return { organizationId, organizationName: organization.data?.name ?? null, steps: requiredSteps, completedSteps, skippedSteps, completedCount: requiredSteps.filter((item) => item.complete).length, totalCount: requiredSteps.length, blockingItems, warningItems, readyForBidding: blockingItems.length === 0 };
}
