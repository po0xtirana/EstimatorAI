"use client";

import { useEffect, useState } from "react";

type StaffRate = {
  id: string;
  role_key: string;
  role_name_en: string;
  role_name_fr: string | null;
  hourly_cost_cents: number;
};

type MaterialRate = {
  id: string;
  material_key: string;
  material_name_en: string;
  material_name_fr: string | null;
  unit: string;
  unit_cost_cents: number;
  is_suggested_baseline: boolean;
};

type OverheadLine = {
  id: string;
  label_en: string;
  label_fr: string | null;
  amount_cents: number;
};

type CostProfile = {
  id: string;
  versionNumber: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  targetMarkupPercent: number;
  staff: StaffRate[];
  materials: MaterialRate[];
  overhead: OverheadLine[];
};

const starterStaff: StaffRate[] = [
  { id: "starter-estimator", role_key: "estimator", role_name_en: "Estimator", role_name_fr: null, hourly_cost_cents: 4500 },
  { id: "starter-supervisor", role_key: "supervisor", role_name_en: "Site supervisor", role_name_fr: null, hourly_cost_cents: 5200 },
  { id: "starter-installer", role_key: "installer", role_name_en: "Skilled installer", role_name_fr: null, hourly_cost_cents: 4200 },
  { id: "starter-laborer", role_key: "laborer", role_name_en: "General laborer", role_name_fr: null, hourly_cost_cents: 2800 }
];

export default function CostProfilePage() {
  const [profile, setProfile] = useState<CostProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/cost-profile");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setProfile(data.profile);
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
      // For now, just create a default profile to get started
      const res = await fetch("/api/cost-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMarkupPercent: profile?.targetMarkupPercent ?? 10,
          staff: (profile?.staff ?? starterStaff).map(s => ({ roleKey: s.role_key, roleNameEn: s.role_name_en, roleNameFr: s.role_name_fr ?? undefined, hourlyCostCents: s.hourly_cost_cents })),
          materials: (profile?.materials ?? []).map(m => ({ materialKey: m.material_key, materialNameEn: m.material_name_en, materialNameFr: m.material_name_fr ?? undefined, unit: m.unit, unitCostCents: m.unit_cost_cents, isSuggestedBaseline: m.is_suggested_baseline })),
          overhead: (profile?.overhead ?? []).map(o => ({ labelEn: o.label_en, labelFr: o.label_fr ?? undefined, amountCents: o.amount_cents }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMessage("Profile saved successfully.");
      // Reload to get fresh data
      const reload = await fetch("/api/cost-profile");
      const reloadData = await reload.json();
      setProfile(reloadData.profile);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="profile-page"><div className="profile-header"><div><p className="eyebrow accent">Company cost profile</p><h1>Make every cost editable.</h1></div></div><p>Loading…</p></main>;
  }

  if (error) {
    return <main className="profile-page"><div className="profile-header"><div><p className="eyebrow accent">Company cost profile</p><h1>Make every cost editable.</h1></div></div><p className="error-text">{error}</p></main>;
  }

  const staff = profile?.staff ?? [];
  const materials = profile?.materials ?? [];
  const overhead = profile?.overhead ?? [];
  const markup = profile?.targetMarkupPercent;

  return (
    <main className="profile-page">
      <div className="profile-header">
        <div>
          <p className="eyebrow accent">Company cost profile</p>
          <h1>Make every cost editable.</h1>
          <p className="profile-copy">Your rates stay versioned and private to your organization. Suggested baselines are clearly marked and never become estimate facts until you accept them.</p>
        </div>
        <button className="button" type="button" onClick={saveVersion} disabled={saving}>
          {saving ? "Saving…" : "Save new version"} <span>→</span>
        </button>
      </div>

      {message && <p className="auth-message" role="status">{message}</p>}

      {!profile && (
        <div className="profile-notice">
          <span className="notice-dot" /> No active cost profile yet. Add your company inputs to unlock estimates.
        </div>
      )}

      <div className="profile-grid">
        <section className="profile-card">
          <div className="profile-card-heading">
            <div>
              <h2>Staff roles</h2>
              <p className="muted">Hourly cost by role</p>
            </div>
            <button className="text-button" type="button">＋ Add</button>
          </div>
          {staff.length > 0 ? staff.map((row) => (
            <div className="input-row" key={row.id}>
              <div>
                <span>{row.role_name_en}</span>
                <small>{row.role_key}</small>
              </div>
              <div className="input-value">${(row.hourly_cost_cents / 100).toFixed(2)}/h</div>
            </div>
          )) : (
            <div className="input-row">
              <div><span>No staff configured</span></div>
              <div className="input-placeholder">$ —</div>
            </div>
          )}
        </section>

        <section className="profile-card">
          <div className="profile-card-heading">
            <div>
              <h2>Materials</h2>
              <p className="muted">Unit cost by material</p>
            </div>
            <button className="text-button" type="button">＋ Add</button>
          </div>
          {materials.length > 0 ? materials.map((row) => (
            <div className="input-row" key={row.id}>
              <div>
                <span>{row.material_name_en}{row.is_suggested_baseline && <small> (baseline)</small>}</span>
                <small>{row.material_key}</small>
              </div>
              <div className="input-value">${(row.unit_cost_cents / 100).toFixed(2)}/{row.unit}</div>
            </div>
          )) : (
            <div className="input-row">
              <div><span>No materials configured</span></div>
              <div className="input-placeholder">$ —</div>
            </div>
          )}
        </section>

        <section className="profile-card">
          <div className="profile-card-heading">
            <div>
              <h2>Overhead</h2>
              <p className="muted">Project allocation lines</p>
            </div>
            <button className="text-button" type="button">＋ Add</button>
          </div>
          {overhead.length > 0 ? overhead.map((row) => (
            <div className="input-row" key={row.id}>
              <div><span>{row.label_en}</span></div>
              <div className="input-value">${(row.amount_cents / 100).toFixed(2)}</div>
            </div>
          )) : (
            <div className="input-row">
              <div><span>No overhead configured</span></div>
              <div className="input-placeholder">$ —</div>
            </div>
          )}
        </section>
      </div>

      <section className="profile-card markup-card">
        <div>
          <h2>Target markup</h2>
          <p className="muted">Applied to direct cost in the deterministic estimate engine.</p>
        </div>
        <div className="markup-value">{markup ?? "—"} <span>%</span></div>
      </section>
      <p className="profile-footnote">Project-specific overrides will create a separate editable layer without changing this company profile.</p>
    </main>
  );
}
