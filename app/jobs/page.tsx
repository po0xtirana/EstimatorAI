"use client";

import { useEffect, useState } from "react";

type Job = { id: string; tender_id: string; stage: string; status: string; attempt_count: number; last_error: string | null };
type Contract = { id: string; name: string; status: string; estimated_cost_cents: number | null; estimated_price_cents: number | null };
type Actual = { cost_cents: number | null; hours: number | null };
type CompletedJob = Contract & { actualCostCents: number; actualHours: number; varianceCents: number | null };
type Profile = { id: string; name: string };
type LearningSuggestion = { taskKey: string; name: string; unit: string; sampleCount: number; currentLaborHoursPerUnit: number | null; suggestedLaborHoursPerUnit: number | null; actualHourlyCostCents: number | null; profileId: string; profileName: string };

const money = (cents: number | null) => cents === null ? "-" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [learning, setLearning] = useState<LearningSuggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    const [cockpitResponse, contractsResponse, profilesResponse] = await Promise.all([
      fetch("/api/cockpit", { cache: "no-store" }),
      fetch("/api/contracts", { cache: "no-store" }),
      fetch("/api/trade-profiles", { cache: "no-store" })
    ]);
    const data = await cockpitResponse.json();
    const contractsData = await contractsResponse.json();
    const profilesData = await profilesResponse.json();
    if (!cockpitResponse.ok) throw new Error(data.error);
    if (!contractsResponse.ok) throw new Error(contractsData.error);
    if (!profilesResponse.ok) throw new Error(profilesData.error);
    setJobs(data.processingJobs ?? []);

    const contracts = (contractsData.contracts ?? []) as Contract[];
    const complete = contracts.filter((contract) => contract.status === "complete").slice(0, 6);
    const completedWithActuals = await Promise.all(complete.map(async (contract) => {
      const response = await fetch(`/api/contracts/${contract.id}/actuals`, { cache: "no-store" });
      const actualData = await response.json();
      const actuals = (actualData.actuals ?? []) as Actual[];
      const actualCostCents = actuals.reduce((sum, actual) => sum + (actual.cost_cents ?? 0), 0);
      const actualHours = actuals.reduce((sum, actual) => sum + (actual.hours ?? 0), 0);
      return { ...contract, actualCostCents, actualHours, varianceCents: contract.estimated_cost_cents === null ? null : actualCostCents - contract.estimated_cost_cents };
    }));
    setCompletedJobs(completedWithActuals);

    const profiles = (profilesData.profiles ?? []) as Profile[];
    const learningSummaries = await Promise.all(profiles.map(async (profile) => {
      const response = await fetch(`/api/trade-profiles/${profile.id}/learning`, { cache: "no-store" });
      if (!response.ok) return [];
      const learningData = await response.json();
      return ((learningData.suggestions ?? []) as Array<Omit<LearningSuggestion, "profileId" | "profileName">>).map((suggestion) => ({ ...suggestion, profileId: profile.id, profileName: profile.name }));
    }));
    setLearning(learningSummaries.flat().slice(0, 8));
  }

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load processing jobs")); }, []);

  async function retry(tenderId: string) {
    setRetrying(tenderId); setMessage(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/analyze`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to retry processing");
      setMessage("Tender processing was queued again.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to retry processing"); }
    finally { setRetrying(null); }
  }

  return <main className="empty-page"><p className="eyebrow accent">Jobs and learning</p><h1>Processing and actuals</h1><p className="empty-page-copy">See what the estimate expected, what happened on completed work, and which company assumptions are ready for review.</p>{message && <p className="error-text" role="status">{message}</p>}
    <section className="profile-card"><div className="profile-card-heading"><div><p className="eyebrow">Completed work</p><h2>Estimate versus actual</h2><p className="muted">Actuals are entered against the completed contract and linked back to the estimate that priced it.</p></div><span className="status-pill">{completedJobs.length} completed</span></div>{completedJobs.length ? <div className="estimate-list">{completedJobs.map((job) => <article className="estimate-card" key={job.id}><div><p className="eyebrow accent">{job.status}</p><h2>{job.name}</h2><span className="status-pill">Completed job</span></div><div className="estimate-card-metrics"><span><small>Estimated cost</small><strong>{money(job.estimated_cost_cents)}</strong></span><span><small>Actual cost</small><strong>{money(job.actualCostCents)}</strong></span><span><small>Variance</small><strong className={job.varianceCents !== null && job.varianceCents > 0 ? "variance-negative" : "variance-positive"}>{job.varianceCents === null ? "-" : `${job.varianceCents > 0 ? "+" : ""}${money(job.varianceCents)}`}</strong></span><span><small>Actual hours</small><strong>{job.actualHours.toFixed(1)} h</strong></span><a className="text-button" href={`/contracts/${job.id}`}>Open job →</a></div></article>)}</div> : <p className="muted">Completed contracts will appear here after actual labor, purchasing, and equipment results are recorded.</p>}</section>
    <section className="profile-card"><div className="profile-card-heading"><div><p className="eyebrow">Controlled learning</p><h2>Assumptions ready for review</h2><p className="muted">EstimatorAI compares task quantities and actual hours, then suggests a new productivity baseline without changing historical estimates.</p></div><span className="status-pill">{learning.length} suggestions</span></div>{learning.length ? learning.map((suggestion) => <div className="learning-row" key={`${suggestion.profileId}-${suggestion.taskKey}`}><div><strong>{suggestion.name}</strong><small>{suggestion.profileName} · {suggestion.sampleCount} actual result{suggestion.sampleCount === 1 ? "" : "s"}</small></div><span>{suggestion.currentLaborHoursPerUnit === null ? "No baseline" : `${suggestion.currentLaborHoursPerUnit} h/${suggestion.unit}`} → {suggestion.suggestedLaborHoursPerUnit === null ? "Needs quantity" : `${suggestion.suggestedLaborHoursPerUnit} h/${suggestion.unit}`}</span><span>{suggestion.actualHourlyCostCents === null ? "-" : `${money(suggestion.actualHourlyCostCents)} / h`}</span><a className="text-button" href={`/trade-profiles/${suggestion.profileId}`}>Review change →</a></div>) : <p className="muted">Record actual hours and quantities against completed contracts to generate controlled recommendations.</p>}</section>
    <section className="profile-card"><div className="profile-card-heading"><div><p className="eyebrow">Processing queue</p><h2>Tender analysis jobs</h2><p className="muted">Retry only the packages that need attention. Successful processing stays linked to the tender and estimate.</p></div><span className="status-pill">{jobs.length} active issues</span></div>{!jobs.length ? <p className="muted">No active processing issues. Open an opportunity to review its completed analysis.</p> : <div className="estimate-list">{jobs.map((job) => <article className="estimate-card" key={job.id}><div><p className="eyebrow accent">{job.stage.replaceAll("_", " ")}</p><h2>Tender processing job</h2><span className="status-pill">{job.status}</span>{job.last_error && <p className="error-text">{job.last_error}</p>}</div><div className="estimate-card-metrics"><span><small>Attempts</small><strong>{job.attempt_count}</strong></span><a className="text-button" href={`/tenders/${job.tender_id}`}>Open tender →</a>{["failed", "retryable"].includes(job.status) && <button className="text-button" type="button" onClick={() => retry(job.tender_id)} disabled={retrying !== null}>{retrying === job.tender_id ? "Retrying..." : "Retry processing"}</button>}</div></article>)}</div>}</section>
  </main>;
}
