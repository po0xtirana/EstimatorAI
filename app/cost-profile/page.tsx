"use client";

import { useEffect, useState, type FormEvent } from "react";

type StaffRate = { id: string; role_key: string; role_name_en: string; role_name_fr: string | null; hourly_cost_cents: number };
type MaterialRate = { id: string; material_key: string; material_name_en: string; material_name_fr: string | null; unit: string; unit_cost_cents: number; is_suggested_baseline: boolean };
type OverheadLine = { id: string; label_en: string; label_fr: string | null; amount_cents: number };
type CostProfile = { id: string; versionNumber: number; effectiveFrom: string; effectiveTo: string | null; targetMarkupPercent: number; staff: StaffRate[]; materials: MaterialRate[]; overhead: OverheadLine[] };
type EditorState = { kind: "staff" | "material" | "overhead"; index: number | null };

const starterStaff: StaffRate[] = [
  { id: "starter-estimator", role_key: "estimator", role_name_en: "Estimator", role_name_fr: null, hourly_cost_cents: 4500 },
  { id: "starter-supervisor", role_key: "supervisor", role_name_en: "Site supervisor", role_name_fr: null, hourly_cost_cents: 5200 },
  { id: "starter-installer", role_key: "installer", role_name_en: "Skilled installer", role_name_fr: null, hourly_cost_cents: 4200 },
  { id: "starter-laborer", role_key: "laborer", role_name_en: "General laborer", role_name_fr: null, hourly_cost_cents: 2800 }
];

export default function CostProfilePage() {
  const [profile, setProfile] = useState<CostProfile | null>(null);
  const [staff, setStaff] = useState<StaffRate[]>(starterStaff);
  const [materials, setMaterials] = useState<MaterialRate[]>([]);
  const [overhead, setOverhead] = useState<OverheadLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [staffDraft, setStaffDraft] = useState({ roleKey: "", roleNameEn: "", hourlyCost: "" });
  const [materialDraft, setMaterialDraft] = useState({ materialKey: "", materialNameEn: "", unit: "", unitCost: "" });
  const [overheadDraft, setOverheadDraft] = useState({ labelEn: "", amount: "" });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/cost-profile");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setProfile(data.profile);
        setStaff(data.profile?.staff?.length ? data.profile.staff : starterStaff);
        setMaterials(data.profile?.materials ?? []);
        setOverhead(data.profile?.overhead ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load cost profile");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveVersion() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cost-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMarkupPercent: profile?.targetMarkupPercent ?? 10,
          staff: staff.map(s => ({ roleKey: s.role_key, roleNameEn: s.role_name_en, roleNameFr: s.role_name_fr ?? undefined, hourlyCostCents: s.hourly_cost_cents })),
          materials: materials.map(m => ({ materialKey: m.material_key, materialNameEn: m.material_name_en, materialNameFr: m.material_name_fr ?? undefined, unit: m.unit, unitCostCents: m.unit_cost_cents, isSuggestedBaseline: m.is_suggested_baseline })),
          overhead: overhead.map(o => ({ labelEn: o.label_en, labelFr: o.label_fr ?? undefined, amountCents: o.amount_cents }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMessage("Profile saved successfully.");
      const reload = await fetch("/api/cost-profile");
      const reloadData = await reload.json();
      setProfile(reloadData.profile);
      setStaff(reloadData.profile?.staff?.length ? reloadData.profile.staff : starterStaff);
      setMaterials(reloadData.profile?.materials ?? []);
      setOverhead(reloadData.profile?.overhead ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function openStaff(index: number | null) {
    const row = index === null ? null : staff[index];
    setStaffDraft({ roleKey: row?.role_key ?? "", roleNameEn: row?.role_name_en ?? "", hourlyCost: row ? (row.hourly_cost_cents / 100).toFixed(2) : "" });
    setEditor({ kind: "staff", index });
  }
  function openMaterial(index: number | null) {
    const row = index === null ? null : materials[index];
    setMaterialDraft({ materialKey: row?.material_key ?? "", materialNameEn: row?.material_name_en ?? "", unit: row?.unit ?? "", unitCost: row ? (row.unit_cost_cents / 100).toFixed(2) : "" });
    setEditor({ kind: "material", index });
  }
  function openOverhead(index: number | null) {
    const row = index === null ? null : overhead[index];
    setOverheadDraft({ labelEn: row?.label_en ?? "", amount: row ? (row.amount_cents / 100).toFixed(2) : "" });
    setEditor({ kind: "overhead", index });
  }
  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const id = `${editor.kind}-${Date.now()}`;
    if (editor.kind === "staff") {
      const row: StaffRate = { id: editor.index === null ? id : staff[editor.index].id, role_key: staffDraft.roleKey.trim(), role_name_en: staffDraft.roleNameEn.trim(), role_name_fr: null, hourly_cost_cents: Math.round(Number(staffDraft.hourlyCost) * 100) };
      setStaff(current => editor.index === null ? [...current, row] : current.map((item, i) => i === editor.index ? row : item));
    } else if (editor.kind === "material") {
      const row: MaterialRate = { id: editor.index === null ? id : materials[editor.index].id, material_key: materialDraft.materialKey.trim(), material_name_en: materialDraft.materialNameEn.trim(), material_name_fr: null, unit: materialDraft.unit.trim(), unit_cost_cents: Math.round(Number(materialDraft.unitCost) * 100), is_suggested_baseline: false };
      setMaterials(current => editor.index === null ? [...current, row] : current.map((item, i) => i === editor.index ? row : item));
    } else {
      const row: OverheadLine = { id: editor.index === null ? id : overhead[editor.index].id, label_en: overheadDraft.labelEn.trim(), label_fr: null, amount_cents: Math.round(Number(overheadDraft.amount) * 100) };
      setOverhead(current => editor.index === null ? [...current, row] : current.map((item, i) => i === editor.index ? row : item));
    }
    setMessage("Changes are ready. Select Save new version to publish them to your company profile.");
    setEditor(null);
  }

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  if (loading) return <main className="profile-page"><p>Loading...</p></main>;
  if (error) return <main className="profile-page"><p className="error-text">{error}</p></main>;
  const markup = profile?.targetMarkupPercent;

  return (
    <main className="profile-page">
      <div className="profile-header">
        <div><p className="eyebrow accent">Company cost profile</p><h1>Make every cost editable.</h1><p className="profile-copy">Your rates stay versioned and private to your organization. Suggested baselines are clearly marked and never become estimate facts until you accept them.</p></div>
        <button className="button" type="button" onClick={saveVersion} disabled={saving}>{saving ? "Saving..." : "Save new version"} <span>→</span></button>
      </div>
      {message && <p className="auth-message" role="status">{message}</p>}
      {!profile && <div className="profile-notice"><span className="notice-dot" /> No active cost profile yet. Starter staff roles are shown so you can edit your operating model immediately.</div>}

      <div className="profile-grid">
        <section className="profile-card">
          <div className="profile-card-heading"><div><h2>Staff roles</h2><p className="muted">Hourly cost by role</p></div><button className="text-button" type="button" onClick={() => openStaff(null)}>＋ Add</button></div>
          {staff.map((row, index) => <button className="input-row clickable-row" key={row.id} type="button" onClick={() => openStaff(index)}><div><span>{row.role_name_en}</span><small>{row.role_key}</small></div><div className="input-value">{money(row.hourly_cost_cents)}/h</div></button>)}
        </section>
        <section className="profile-card">
          <div className="profile-card-heading"><div><h2>Materials</h2><p className="muted">Unit cost by material</p></div><button className="text-button" type="button" onClick={() => openMaterial(null)}>＋ Add</button></div>
          {materials.length ? materials.map((row, index) => <button className="input-row clickable-row" key={row.id} type="button" onClick={() => openMaterial(index)}><div><span>{row.material_name_en}{row.is_suggested_baseline && <small> (baseline)</small>}</span><small>{row.material_key}</small></div><div className="input-value">{money(row.unit_cost_cents)}/{row.unit}</div></button>) : <div className="input-row"><span>No materials configured</span><span className="input-placeholder">$ —</span></div>}
        </section>
        <section className="profile-card">
          <div className="profile-card-heading"><div><h2>Overhead</h2><p className="muted">Project allocation lines</p></div><button className="text-button" type="button" onClick={() => openOverhead(null)}>＋ Add</button></div>
          {overhead.length ? overhead.map((row, index) => <button className="input-row clickable-row" key={row.id} type="button" onClick={() => openOverhead(index)}><span>{row.label_en}</span><span className="input-value">{money(row.amount_cents)}</span></button>) : <div className="input-row"><span>No overhead configured</span><span className="input-placeholder">$ —</span></div>}
        </section>
      </div>

      {editor && <section className="profile-card profile-editor"><div className="profile-card-heading"><div><h2>{editor.index === null ? "Add" : "Edit"} {editor.kind === "staff" ? "staff role" : editor.kind === "material" ? "material" : "overhead line"}</h2><p className="muted">Review this company input before saving a new version.</p></div><button className="text-button" type="button" onClick={() => setEditor(null)}>Cancel</button></div><form className="form-grid" onSubmit={saveEditor}>
        {editor.kind === "staff" && <><label className="form-field"><span>Role name</span><input required value={staffDraft.roleNameEn} onChange={e => setStaffDraft({ ...staffDraft, roleNameEn: e.target.value })} /></label><label className="form-field"><span>Role key</span><input required value={staffDraft.roleKey} onChange={e => setStaffDraft({ ...staffDraft, roleKey: e.target.value })} /></label><label className="form-field"><span>Loaded hourly cost</span><input required min="0" step="0.01" type="number" value={staffDraft.hourlyCost} onChange={e => setStaffDraft({ ...staffDraft, hourlyCost: e.target.value })} /></label></>}
        {editor.kind === "material" && <><label className="form-field"><span>Material name</span><input required value={materialDraft.materialNameEn} onChange={e => setMaterialDraft({ ...materialDraft, materialNameEn: e.target.value })} /></label><label className="form-field"><span>Material key</span><input required value={materialDraft.materialKey} onChange={e => setMaterialDraft({ ...materialDraft, materialKey: e.target.value })} /></label><label className="form-field"><span>Unit</span><input required placeholder="sq ft, each, hour" value={materialDraft.unit} onChange={e => setMaterialDraft({ ...materialDraft, unit: e.target.value })} /></label><label className="form-field"><span>Unit cost</span><input required min="0" step="0.01" type="number" value={materialDraft.unitCost} onChange={e => setMaterialDraft({ ...materialDraft, unitCost: e.target.value })} /></label></>}
        {editor.kind === "overhead" && <><label className="form-field"><span>Cost label</span><input required value={overheadDraft.labelEn} onChange={e => setOverheadDraft({ ...overheadDraft, labelEn: e.target.value })} /></label><label className="form-field"><span>Amount</span><input required min="0" step="0.01" type="number" value={overheadDraft.amount} onChange={e => setOverheadDraft({ ...overheadDraft, amount: e.target.value })} /></label></>}
        <div className="editor-actions"><button className="button" type="submit">Save item</button></div>
      </form></section>}

      <section className="profile-card markup-card"><div><h2>Target markup</h2><p className="muted">Applied to direct cost in the deterministic estimate engine.</p></div><div className="markup-value">{markup ?? "—"} <span>%</span></div></section>
      <p className="profile-footnote">Project-specific overrides will create a separate editable layer without changing this company profile.</p>
    </main>
  );
}
