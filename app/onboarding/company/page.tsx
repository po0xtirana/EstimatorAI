"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Trade = { slug: string; name_en: string; name_fr: string | null };
type Staff = { displayName?: string; roleKey: string; roleNameEn: string; skillSummary: string; availableHeadcount: number; hourlyCostCents: number };
type Readiness = { completedSteps: string[]; steps: Array<{ id: string; label: string; detail: string; complete: boolean; required: boolean; href: string }>; blockingItems: string[]; readyForBidding: boolean };

const initialStaff: Staff[] = [
  { roleKey: "supervisor", roleNameEn: "Site supervisor", skillSummary: "", availableHeadcount: 1, hourlyCostCents: 5200 },
  { roleKey: "installer", roleNameEn: "Skilled installer", skillSummary: "", availableHeadcount: 0, hourlyCostCents: 4200 }
];

const groups = [
  { label: "Company identity", detail: "Tell us who you are", number: "01" },
  { label: "Work coverage", detail: "Choose where and what you deliver", number: "02" },
  { label: "People and labor", detail: "Classify the team and loaded costs", number: "03" },
  { label: "Bid rules", detail: "Set the commercial guardrails", number: "04" },
  { label: "Ready to bid", detail: "Review what remains", number: "05" }
];

export default function CompanyOnboardingPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Trade[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("Construction and renovation");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [tradeSlugs, setTradeSlugs] = useState<string[]>([]);
  const [regions, setRegions] = useState("");
  const [certifications, setCertifications] = useState("");
  const [bonding, setBonding] = useState("");
  const [crewSize, setCrewSize] = useState("");
  const [pipelineLoad, setPipelineLoad] = useState("0");
  const [markup, setMarkup] = useState("10");
  const [staff, setStaff] = useState<Staff[]>(initialStaff);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/onboarding/company"), fetch("/api/company/readiness")]).then(async ([companyResponse, readinessResponse]) => {
      const data = await companyResponse.json();
      const readinessData = await readinessResponse.json();
      if (!companyResponse.ok) throw new Error(data.error);
      setCatalog(data.catalog ?? []);
      setReadiness(readinessData.readiness ?? null);
      if (data.company) {
        setCompanyName(data.company.name ?? ""); setIndustry(data.company.industry ?? ""); setWebsite(data.company.website ?? ""); setPhone(data.company.phone ?? "");
        setTradeSlugs(data.company.trades ?? []);
        setRegions((data.company.regions ?? []).map((region: { name_en: string }) => region.name_en).join(", "));
        setCertifications((data.company.certifications ?? []).map((certification: { name_en: string }) => certification.name_en).join(", "));
        setBonding(data.company.capability?.bonding_capacity_cents ? String(data.company.capability.bonding_capacity_cents / 100) : "");
        setCrewSize(data.company.capability?.available_crew_size ? String(data.company.capability.available_crew_size) : "");
        setPipelineLoad(data.company.capability?.pipeline_load_percent ? String(data.company.capability.pipeline_load_percent) : "0");
        setMarkup(String(data.company.targetMarkupPercent ?? 10));
        setStaff(data.company.staff?.map((row: { role_key: string; role_name_en: string; skill_summary: string | null; available_headcount: number; hourly_cost_cents: number }) => ({ roleKey: row.role_key, roleNameEn: row.role_name_en, skillSummary: row.skill_summary ?? "", availableHeadcount: row.available_headcount, hourlyCostCents: row.hourly_cost_cents })) ?? initialStaff);
      }
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load company setup"));
  }, []);

  const payload = useMemo(() => ({
    companyName, industry, website, phone, tradeSlugs,
    regions: regions.split(",").map((value) => value.trim()).filter(Boolean),
    certifications: certifications.split(",").map((value) => value.trim()).filter(Boolean),
    bondingCapacityCents: bonding ? Math.round(Number(bonding) * 100) : null,
    availableCrewSize: crewSize ? Number(crewSize) : null,
    pipelineLoadPercent: pipelineLoad ? Number(pipelineLoad) : null,
    targetMarkupPercent: Number(markup), staff
  }), [bonding, certifications, companyName, crewSize, industry, markup, phone, pipelineLoad, regions, staff, tradeSlugs, website]);

  function updateStaff(index: number, field: keyof Staff, value: string) {
    setStaff((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: field === "availableHeadcount" ? Number(value) : field === "hourlyCostCents" ? Math.round(Number(value) * 100) : value } : row));
  }

  function toggleTrade(slug: string) { setTradeSlugs((current) => current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]); }

  async function saveStep() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/onboarding/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save company setup");
      const stepCompletions = step === 1 ? ["trades", ...(regions.trim() ? ["coverage"] : [])] : step === 2 ? ["people", ...(staff.some((row) => row.availableHeadcount > 0 && row.hourlyCostCents > 0) ? ["labor"] : [])] : [groupStepIds[step] ?? "company"];
      const completedSteps = Array.from(new Set([...(readiness?.completedSteps ?? []), ...stepCompletions]));
      const readinessResponse = await fetch("/api/company/readiness", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completedSteps }) });
      const readinessData = await readinessResponse.json();
      if (readinessResponse.ok) setReadiness(readinessData.readiness);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save company setup"); return false; }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveStep();
    if (!saved) return;
    if (step < groups.length - 1) { setStep(step + 1); setMessage("Saved. Continue when you are ready."); }
    else router.push("/");
  }

  const groupStepIds = ["company", "trades", "people", "commercial", "company"];
  const current = groups[step];

  return <main className="onboarding-page">
    <div className="onboarding-header">
      <div><div className="brand"><span className="brand-mark">B</span><span>BidPilot</span></div><p className="eyebrow accent">Guided company setup</p><h1>Build the baseline behind every bid.</h1><p className="profile-copy">EstimatorAI uses your real people, rates, production methods, and constraints to decide which tenders fit. You can save each section and finish the rest later.</p></div>
      <div className="onboarding-progress" aria-label={`Setup step ${step + 1} of ${groups.length}`}>Step {step + 1} of {groups.length}<br /><span>{current.label}</span></div>
    </div>
    <nav className="setup-stepper" aria-label="Company setup steps">{groups.map((item, index) => <button type="button" className={`setup-step ${index === step ? "active" : ""} ${index < step ? "complete" : ""}`} key={item.label} onClick={() => index <= step && setStep(index)} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : item.number}</span><strong>{item.label}</strong><small>{item.detail}</small></button>)}</nav>
    <form onSubmit={submit}>
      {step === 0 && <section className="onboarding-card"><p className="eyebrow">01 · Company identity</p><h2>Tell us about the business</h2><p className="muted">This appears in your workspace and keeps estimates tied to the right operating company.</p><div className="form-grid"><Field label="Company name" value={companyName} onChange={setCompanyName} required placeholder="Northstar Renovation Ltd." /><Field label="Industry" value={industry} onChange={setIndustry} placeholder="Construction and renovation" /><Field label="Website" value={website} onChange={setWebsite} placeholder="https://company.ca" /><Field label="Phone" value={phone} onChange={setPhone} placeholder="(416) 555-0199" /></div></section>}
      {step === 1 && <section className="onboarding-card"><p className="eyebrow">02 · Work coverage</p><h2>What work and geography should we consider?</h2><p className="muted">Only selected pilot trades will appear in tender matching. Other catalog entries stay hidden until their templates are validated.</p><div className="trade-grid">{catalog.map((trade) => <label className="trade-option" key={trade.slug}><input type="checkbox" checked={tradeSlugs.includes(trade.slug)} onChange={() => toggleTrade(trade.slug)} /> <span>{trade.name_en}</span></label>)}</div><div className="form-grid capability-fields"><Field label="Service areas" value={regions} onChange={setRegions} placeholder="Toronto, Durham, York" hint="Separate areas with commas" /><Field label="Certifications and licenses" value={certifications} onChange={setCertifications} placeholder="COR, WHMIS, asbestos" hint="Separate credentials with commas" /><NumberField label="Bonding capacity (CAD)" value={bonding} onChange={setBonding} placeholder="500000" /><NumberField label="Available headcount" value={crewSize} onChange={setCrewSize} placeholder="12" /><NumberField label="Current pipeline load (%)" value={pipelineLoad} onChange={setPipelineLoad} placeholder="0" /></div></section>}
      {step === 2 && <section className="onboarding-card"><p className="eyebrow">03 · People and labor</p><h2>Who can deliver the work?</h2><p className="muted">Describe role skills and loaded hourly cost. The matching engine classifies the skills and uses the rates when selecting a feasible crew.</p>{staff.map((row, index) => <div className="staff-editor" key={`${index}-${row.roleKey}`}><label><span>Role</span><input value={row.roleNameEn} onChange={(event) => updateStaff(index, "roleNameEn", event.target.value)} placeholder="Role name" required /></label><label><span>Skills and qualifications</span><input value={row.skillSummary} onChange={(event) => updateStaff(index, "skillSummary", event.target.value)} placeholder="Drywall, framing, WHMIS" /></label><label><span>Available</span><input type="number" min="0" value={row.availableHeadcount} onChange={(event) => updateStaff(index, "availableHeadcount", event.target.value)} /></label><label><span>Loaded cost / hour</span><input type="number" min="0" step="0.01" value={(row.hourlyCostCents / 100).toFixed(2)} onChange={(event) => updateStaff(index, "hourlyCostCents", event.target.value)} /></label><button type="button" className="remove-button" onClick={() => setStaff((currentStaff) => currentStaff.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>)}<button type="button" className="text-button" onClick={() => setStaff((currentStaff) => [...currentStaff, { roleKey: `role-${currentStaff.length + 1}`, roleNameEn: "", skillSummary: "", availableHeadcount: 0, hourlyCostCents: 0 }])}>+ Add another role</button></section>}
      {step === 3 && <section className="onboarding-card"><p className="eyebrow">04 · Bid rules</p><h2>Set the commercial guardrails</h2><p className="muted">These defaults keep recommendations consistent. Your operating model can later add contingency, mobilization, equipment, materials, and productivity for each trade.</p><div className="form-grid capability-fields"><NumberField label="Target markup (%)" value={markup} onChange={setMarkup} placeholder="10" /></div><div className="setup-link-grid"><a className="setup-link-card" href="/trade-profiles"><strong>Configure operating model →</strong><span>Add loaded resources, crews, assemblies, materials, equipment, and productivity.</span></a><a className="setup-link-card" href="/team"><strong>Review people and capacity →</strong><span>See classified skills and connect employees to crew roles.</span></a></div></section>}
      {step === 4 && <section className="onboarding-card"><p className="eyebrow">05 · Readiness review</p><h2>Know what is still missing before bidding</h2><p className="muted">A green checklist means the minimum baseline exists. It does not approve a bid; each tender still receives its own capability and exception review.</p><div className="readiness-review">{readiness?.steps.map((item) => <div className="checklist-row" key={item.id}><span className={`check ${item.complete ? "complete" : ""}`}>{item.complete ? "✓" : ""}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><span>{item.complete ? "Ready" : item.required ? "Required" : "Optional"}</span></div>) ?? <p className="muted">Loading readiness...</p>}</div>{readiness?.blockingItems.length ? <p className="error-text">Still required: {readiness.blockingItems.join("; ")}</p> : <p className="success-text">Your company baseline is ready for a tender-specific review.</p>}</section>}
      {message && <p className="auth-message" role="alert">{message}</p>}
      <div className="onboarding-actions"><button className="button secondary-button" type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>Back</button><p className="muted">You can return here from the Bid cockpit and continue setup at any time.</p><button className="button" type="submit" disabled={busy || (step === 0 && !companyName.trim())}>{busy ? "Saving..." : step === groups.length - 1 ? "Finish setup →" : "Save and continue →"}</button></div>
    </form>
  </main>;
}

function Field({ label, value, onChange, placeholder, hint, required }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; required?: boolean }) { return <label className="form-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />{hint && <small>{hint}</small>}</label>; }
function NumberField(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <Field {...props} />; }
