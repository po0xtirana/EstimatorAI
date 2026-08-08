"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Resource = { resourceKind: string; resourceKey: string; name: string; unit: string; rateCents: number; rateBasis: string; availableQuantity: number | null; wastePercent: number };
type Role = { id?: string; role_resource_key: string; headcount: number; skill_slugs: string[] };
type Crew = { id: string; crew_key: string; name: string; production_factor: number; max_crews_available: number | null; trade_profile_crew_roles: Role[] };
type Assembly = { id: string; task_key: string; name: string; unit: string; labor_hours_per_unit: number; preferred_crew_id: string | null; material_components: Array<{ resourceKey: string; quantityPerUnit: number }>; equipment_components: Array<{ resourceKey: string; quantityPerUnit: number }> };
type Profile = { id: string; name: string; trade_slug: string; target_markup_percent: number; contingency_percent: number; mobilization_cents: number; service_radius_km: number | null; current_pipeline_load_percent: number | null };
type Staff = { id: string; display_name: string; role_title: string; classified_skills: string[]; hourly_cost_cents: number; available: boolean };
type LearningSuggestion = { taskKey: string; assemblyId: string | null; name: string; unit: string; sampleCount: number; currentLaborHoursPerUnit: number | null; suggestedLaborHoursPerUnit: number | null; actualHourlyCostCents: number | null; actualCostCents: number; reviewRequired: boolean };
type LearningVersion = { id: string; version_number: number; source: string; change_reason: string; created_at: string };

const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function TradeProfileDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [learning, setLearning] = useState<LearningSuggestion[]>([]);
  const [versions, setVersions] = useState<LearningVersion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyingTaskKey, setApplyingTaskKey] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetch(`/api/trade-profiles/${id}`), fetch("/api/team"), fetch(`/api/trade-profiles/${id}/learning`)] )
      .then(async ([profileResponse, staffResponse, learningResponse]) => {
        const data = await profileResponse.json();
        const staffData = await staffResponse.json();
        const learningData = await learningResponse.json();
        if (!profileResponse.ok) throw new Error(data.error);
        setProfile(data.profile);
        setResources(data.resources ?? []);
        setCrews(data.crews ?? []);
        setAssemblies(data.assemblies ?? []);
        setStaff(staffResponse.ok ? staffData.staff ?? [] : []);
        setLearning(learningResponse.ok ? learningData.suggestions ?? [] : []);
        setVersions(learningResponse.ok ? learningData.versions ?? [] : []);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load trade profile"));
  }, [id]);

  function updateResource(index: number, key: keyof Resource, value: string) {
    setResources((current) => current.map((resource, resourceIndex) => resourceIndex === index ? {
      ...resource,
      [key]: key === "rateCents" ? Math.round(Number(value) * 100) : key === "availableQuantity" || key === "wastePercent" ? Number(value) : value
    } : resource));
  }

  function updateAssembly(index: number, value: string) {
    setAssemblies((current) => current.map((assembly, assemblyIndex) => assemblyIndex === index ? { ...assembly, labor_hours_per_unit: Number(value) } : assembly));
  }

  function updateCrew(index: number, key: "production_factor" | "max_crews_available", value: string) {
    setCrews((current) => current.map((crew, crewIndex) => crewIndex === index ? { ...crew, [key]: Number(value) } : crew));
  }

  function updateCrewText(index: number, key: "crew_key" | "name", value: string) {
    setCrews((current) => current.map((crew, crewIndex) => crewIndex === index ? { ...crew, [key]: value } : crew));
  }

  function updateCrewRole(crewIndex: number, roleIndex: number, key: "role_resource_key" | "headcount" | "skill_slugs", value: string) {
    setCrews((current) => current.map((crew, currentCrewIndex) => currentCrewIndex === crewIndex ? {
      ...crew,
      trade_profile_crew_roles: crew.trade_profile_crew_roles.map((role, currentRoleIndex) => currentRoleIndex === roleIndex ? {
        ...role,
        [key]: key === "headcount" ? Math.max(1, Number(value)) : key === "skill_slugs" ? value.split(",").map((skill) => skill.trim()).filter(Boolean) : value
      } : role)
    } : crew));
  }

  function addCrew() {
    const key = `crew-${Date.now()}`;
    setCrews((current) => [...current, { id: key, crew_key: key, name: "New crew template", production_factor: 1, max_crews_available: 1, trade_profile_crew_roles: [] }]);
  }

  function addCrewRole(crewIndex: number) {
    const firstLaborRole = resources.find((resource) => resource.resourceKind === "labor")?.resourceKey ?? "laborer";
    setCrews((current) => current.map((crew, currentCrewIndex) => currentCrewIndex === crewIndex ? {
      ...crew,
      trade_profile_crew_roles: [...crew.trade_profile_crew_roles, { id: `role-${Date.now()}`, role_resource_key: firstLaborRole, headcount: 1, skill_slugs: [] }]
    } : crew));
  }

  function removeCrewRole(crewIndex: number, roleIndex: number) {
    setCrews((current) => current.map((crew, currentCrewIndex) => currentCrewIndex === crewIndex ? { ...crew, trade_profile_crew_roles: crew.trade_profile_crew_roles.filter((_, currentRoleIndex) => currentRoleIndex !== roleIndex) } : crew));
  }

  function removeCrew(crewIndex: number) {
    setCrews((current) => current.filter((_, currentCrewIndex) => currentCrewIndex !== crewIndex));
  }

  function matchingStaff(role: Role) {
    const key = role.role_resource_key.toLowerCase();
    const tokens = key.split(/[-_ ]+/).filter((token) => token.length > 2);
    return staff.filter((member) => {
      const title = member.role_title.toLowerCase();
      const skills = member.classified_skills.map((skill) => skill.toLowerCase());
      return title.includes(key) || tokens.some((token) => title.includes(token) || skills.some((skill) => skill.includes(token) || token.includes(skill)));
    }).sort((a, b) => Number(b.available) - Number(a.available));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/trade-profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_markup_percent: profile.target_markup_percent,
        contingency_percent: profile.contingency_percent,
        mobilization_cents: profile.mobilization_cents,
        service_radius_km: profile.service_radius_km,
        current_pipeline_load_percent: profile.current_pipeline_load_percent,
        resources: resources.map((resource) => ({ resourceKind: resource.resourceKind, resourceKey: resource.resourceKey, name: resource.name, unit: resource.unit, rateCents: resource.rateCents, rateBasis: resource.rateBasis, availableQuantity: resource.availableQuantity, wastePercent: resource.wastePercent })),
        crews: crews.map((crew) => ({ crewKey: crew.crew_key, name: crew.name, productionFactor: crew.production_factor, maxCrewsAvailable: crew.max_crews_available, roles: crew.trade_profile_crew_roles.map((role) => ({ roleResourceKey: role.role_resource_key, headcount: role.headcount, skillSlugs: role.skill_slugs })) })),
        assemblies: assemblies.map((assembly) => ({ taskKey: assembly.task_key, name: assembly.name, unit: assembly.unit, laborHoursPerUnit: assembly.labor_hours_per_unit, preferredCrewKey: crews.find((crew) => crew.id === assembly.preferred_crew_id)?.crew_key ?? crews[0]?.crew_key ?? null, materialComponents: assembly.material_components, equipmentComponents: assembly.equipment_components }))
      })
    });
    const data = await response.json();
    setMessage(response.ok ? "Operating model saved. New estimates will use this version of the assumptions." : data.error ?? "Unable to save profile");
    setSaving(false);
  }

  async function applyLearning(suggestion: LearningSuggestion) {
    if (!suggestion.assemblyId || suggestion.suggestedLaborHoursPerUnit === null) return;
    setApplyingTaskKey(suggestion.taskKey);
    setMessage(null);
    const response = await fetch(`/api/trade-profiles/${id}/learning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskKey: suggestion.taskKey, assemblyId: suggestion.assemblyId, suggestedLaborHoursPerUnit: suggestion.suggestedLaborHoursPerUnit, sampleCount: suggestion.sampleCount, actualHourlyCostCents: suggestion.actualHourlyCostCents }) });
    const data = await response.json();
    if (response.ok) {
      setAssemblies((current) => current.map((assembly) => assembly.id === suggestion.assemblyId ? { ...assembly, labor_hours_per_unit: suggestion.suggestedLaborHoursPerUnit as number } : assembly));
      setMessage(`Applied the reviewed ${suggestion.taskKey} productivity suggestion as assumption version ${data.version.version_number}.`);
      setLearning((current) => current.filter((item) => item.taskKey !== suggestion.taskKey));
    } else setMessage(data.error ?? "Unable to apply learning suggestion");
    setApplyingTaskKey(null);
  }

  if (!profile) return <main className="empty-page"><p className="eyebrow accent">Operating model</p><h1>Loading trade profile</h1><p>{message ?? "Loading your company assumptions..."}</p></main>;

  return <main className="profile-page">
    <div className="profile-header"><div><p className="eyebrow accent">{profile.trade_slug} operating model</p><h1>{profile.name}</h1><p className="profile-copy">System defaults are starting points only. Replace rates and productivity with your company&apos;s approved assumptions before generating a bid.</p></div><span className="status-pill">Draft profile</span></div>
    {message && <p className="auth-message" role="status">{message}</p>}
    <section className="model-overview" aria-labelledby="model-overview-title">
      <div className="model-overview-copy"><p className="eyebrow accent">Model overview</p><h2 id="model-overview-title">The price book behind this trade.</h2><p>Use the sections below to maintain the commercial rules, delivery resources, crew capacity, and production rates that EstimatorAI uses when it turns a tender into a bid.</p></div>
      <nav className="model-jump-nav" aria-label="Operating model sections"><a href="#commercial-assumptions">Commercial</a><a href="#resources-rates">Resources &amp; rates</a><a href="#crew-templates">Crews</a><a href="#production-templates">Production</a><a href="#actuals-learning">Learning</a></nav>
      <div className="model-stat-grid"><div><small>Resources</small><strong>{resources.length}</strong><span>rates and allowances</span></div><div><small>Crew templates</small><strong>{crews.length}</strong><span>delivery combinations</span></div><div><small>Production templates</small><strong>{assemblies.length}</strong><span>task productivity rates</span></div><div><small>People available</small><strong>{staff.filter((member) => member.available).length}</strong><span>matched for crew fit</span></div></div>
    </section>
    <form onSubmit={save}>
      <section className="profile-card" id="commercial-assumptions"><div className="profile-card-heading"><div><h2>Commercial assumptions</h2><p className="muted">These values affect every estimate generated from this trade.</p></div></div><div className="form-grid capability-fields">
        <label className="form-field"><span>Target markup (%)</span><input type="number" step="0.1" value={profile.target_markup_percent} onChange={(event) => setProfile({ ...profile, target_markup_percent: Number(event.target.value) })} /></label>
        <label className="form-field"><span>Contingency (%)</span><input type="number" step="0.1" value={profile.contingency_percent} onChange={(event) => setProfile({ ...profile, contingency_percent: Number(event.target.value) })} /></label>
        <label className="form-field"><span>Mobilization (CAD)</span><input type="number" step="0.01" value={(profile.mobilization_cents / 100).toFixed(2)} onChange={(event) => setProfile({ ...profile, mobilization_cents: Math.round(Number(event.target.value) * 100) })} /></label>
        <label className="form-field"><span>Pipeline load (%)</span><input type="number" step="1" value={profile.current_pipeline_load_percent ?? ""} onChange={(event) => setProfile({ ...profile, current_pipeline_load_percent: event.target.value ? Number(event.target.value) : null })} /></label>
      </div></section>

      <section className="profile-card" id="resources-rates"><div className="profile-card-heading"><div><h2>Resources and rates</h2><p className="muted">Loaded labor, materials, equipment, vehicles, subcontractors, and overhead.</p></div></div>{resources.map((resource, index) => <div className="resource-editor" key={`${resource.resourceKind}-${resource.resourceKey}`}><div><strong>{resource.name}</strong><small>{resource.resourceKind} - {resource.unit}</small></div><label><span>Rate</span><input type="number" step="0.01" value={(resource.rateCents / 100).toFixed(2)} onChange={(event) => updateResource(index, "rateCents", event.target.value)} /></label><label><span>Available</span><input type="number" step="0.1" value={resource.availableQuantity ?? ""} onChange={(event) => updateResource(index, "availableQuantity", event.target.value)} /></label><label><span>Waste %</span><input type="number" step="0.1" value={resource.wastePercent} onChange={(event) => updateResource(index, "wastePercent", event.target.value)} /></label></div>)}</section>

      <section className="profile-card" id="crew-templates">
        <div className="profile-card-heading crew-section-heading">
          <div><h2>Crew templates</h2><p className="muted">Create as many crew combinations as your company actually operates. EstimatorAI compares feasible templates by required skills, loaded cost, production factor, and available capacity.</p></div>
          <button className="text-button" type="button" onClick={addCrew}>+ Add crew template</button>
        </div>
        <div className="crew-template-list">
          {crews.map((crew, index) => <div className="crew-editor crew-builder" key={crew.id || crew.crew_key}>
            <div className="crew-builder-header">
              <div><span className="eyebrow">Crew {index + 1}</span><h3>{crew.name || "Unnamed crew"}</h3><p className="muted">Define who is required for this delivery combination.</p></div>
              <button className="remove-button" type="button" onClick={() => removeCrew(index)}>Remove crew</button>
            </div>
            <div className="crew-builder-fields">
              <label><span>Crew name</span><input value={crew.name} onChange={(event) => updateCrewText(index, "name", event.target.value)} placeholder="Standard restoration crew" /></label>
              <label><span>Internal key</span><input value={crew.crew_key} onChange={(event) => updateCrewText(index, "crew_key", event.target.value)} placeholder="standard-restoration" /></label>
              <label><span>Production factor</span><input type="number" min="0.05" step="0.05" value={crew.production_factor} onChange={(event) => updateCrew(index, "production_factor", event.target.value)} /></label>
              <label><span>Max parallel crews</span><input type="number" min="0" step="1" value={crew.max_crews_available ?? ""} onChange={(event) => updateCrew(index, "max_crews_available", event.target.value)} /></label>
            </div>
            <div className="crew-role-editor">
              <div className="crew-role-editor-heading"><div><strong>Required people and skills</strong><small>Headcount is per crew. Employees are matched automatically from People &amp; skills.</small></div><button className="text-button" type="button" onClick={() => addCrewRole(index)}>+ Add role</button></div>
              {crew.trade_profile_crew_roles.length ? crew.trade_profile_crew_roles.map((role, roleIndex) => {
                const matches = matchingStaff(role);
                const currentRole = resources.find((resource) => resource.resourceKey === role.role_resource_key && resource.resourceKind === "labor");
                const laborResources = resources.filter((resource) => resource.resourceKind === "labor");
                return <div className="crew-role-row" key={role.id || `${role.role_resource_key}-${roleIndex}`}>
                  <label><span>Role</span><select value={role.role_resource_key} onChange={(event) => updateCrewRole(index, roleIndex, "role_resource_key", event.target.value)}>{currentRole && !laborResources.some((resource) => resource.resourceKey === role.role_resource_key) && <option value={currentRole.resourceKey}>{currentRole.name}</option>}{laborResources.map((resource) => <option value={resource.resourceKey} key={resource.resourceKey}>{resource.name}</option>)}{!laborResources.some((resource) => resource.resourceKey === role.role_resource_key) && <option value={role.role_resource_key}>{role.role_resource_key}</option>}</select></label>
                  <label><span>People</span><input type="number" min="1" step="1" value={role.headcount} onChange={(event) => updateCrewRole(index, roleIndex, "headcount", event.target.value)} /></label>
                  <label><span>Required skills</span><input value={role.skill_slugs.join(", ")} onChange={(event) => updateCrewRole(index, roleIndex, "skill_slugs", event.target.value)} placeholder="water-mitigation, WHMIS" /></label>
                  <button className="remove-button" type="button" onClick={() => removeCrewRole(index, roleIndex)}>Remove role</button>
                  <div className="crew-staff-match"><span className="staff-match-role">Suggested people</span>{matches.length ? matches.slice(0, 4).map((member) => <span className={`staff-match ${member.available ? "available" : "unavailable"}`} key={member.id}>{member.display_name} - {money(member.hourly_cost_cents)} / h</span>) : <span className="staff-match-empty">No matching employee yet</span>}</div>
                </div>;
              }) : <p className="muted crew-empty-state">No roles added yet. Add the people this crew needs to operate.</p>}
            </div>
          </div>)}
          {!crews.length && <div className="crew-empty-state"><strong>No crew templates yet</strong><span>Add a crew combination to make this trade available for estimating.</span><button className="button" type="button" onClick={addCrew}>Add the first crew</button></div>}
        </div>
      </section>

      <section className="profile-card" id="production-templates"><div className="profile-card-heading"><div><h2>Production templates</h2><p className="muted">Labor hours are generated from tender quantities. The estimator does not ask for project hours.</p></div></div>{assemblies.map((assembly, index) => <div className="assembly-editor" key={assembly.task_key}><div><strong>{assembly.name}</strong><small>{assembly.task_key} - per {assembly.unit}</small></div><label><span>Labor hours / unit</span><input type="number" step="0.001" value={assembly.labor_hours_per_unit} onChange={(event) => updateAssembly(index, event.target.value)} /></label></div>)}</section>

      <section className="profile-card" id="actuals-learning"><div className="profile-card-heading"><div><h2>Actuals learning suggestions</h2><p className="muted">Trusted completed-job actuals are summarized here as reviewable suggestions. Applying a suggestion creates a versioned baseline snapshot.</p></div><span className="status-pill">{learning.length} suggestions - {versions.length} versions</span></div>{learning.length ? learning.map((suggestion) => <div className="learning-row" key={suggestion.taskKey}><div><strong>{suggestion.name}</strong><small>{suggestion.taskKey} - {suggestion.sampleCount} actual result{suggestion.sampleCount === 1 ? "" : "s"}</small></div><span>{suggestion.suggestedLaborHoursPerUnit === null ? "Add quantity and hours" : `${suggestion.suggestedLaborHoursPerUnit} h/${suggestion.unit}`}</span><span>{suggestion.actualHourlyCostCents === null ? "-" : `${money(suggestion.actualHourlyCostCents)} / h`}</span><button className="text-button" type="button" disabled={applyingTaskKey !== null || suggestion.suggestedLaborHoursPerUnit === null} onClick={() => applyLearning(suggestion)}>{applyingTaskKey === suggestion.taskKey ? "Applying..." : "Apply reviewed change"}</button></div>) : <p className="muted">Record actual hours and quantities against completed contracts to generate controlled recommendations.</p>}{versions.length > 0 && <div className="learning-history">{versions.slice(0, 5).map((version) => <small key={version.id}>Version {version.version_number}: {version.change_reason} ({new Date(version.created_at).toLocaleDateString("en-CA")})</small>)}</div>}</section>

      <div className="onboarding-actions"><p className="muted">Save this operating model before generating an estimate. Every future project can override assumptions without changing this baseline.</p><button className="button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save operating model ->"}</button></div>
    </form>
  </main>;
}
