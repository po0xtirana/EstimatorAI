"use client";

import { useEffect, useState } from "react";

type Job = { id: string; tender_id: string; stage: string; status: string; attempt_count: number; last_error: string | null };

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/cockpit", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setJobs(data.processingJobs ?? []);
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

  return <main className="empty-page"><p className="eyebrow accent">Jobs and learning</p><h1>Processing and actuals</h1><p className="empty-page-copy">Track tender processing, review estimate exceptions, and compare completed jobs with the assumptions that created them.</p>{message && <p className="error-text" role="status">{message}</p>}{!jobs.length ? <div className="empty-panel"><div className="empty-icon">✓</div><h2>No processing issues</h2><p>When a tender package is being analyzed, its progress and any retryable failures will appear here.</p><a href="/tenders">Open opportunities →</a></div> : <div className="estimate-list">{jobs.map((job) => <article className="estimate-card" key={job.id}><div><p className="eyebrow accent">{job.stage.replaceAll("_", " ")}</p><h2>Tender processing job</h2><span className="status-pill">{job.status}</span>{job.last_error && <p className="error-text">{job.last_error}</p>}</div><div className="estimate-card-metrics"><span><small>Attempts</small><strong>{job.attempt_count}</strong></span><a className="text-button" href={`/tenders/${job.tender_id}`}>Open tender →</a>{["failed", "retryable"].includes(job.status) && <button className="text-button" type="button" onClick={() => retry(job.tender_id)} disabled={retrying !== null}>{retrying === job.tender_id ? "Retrying..." : "Retry processing"}</button>}</div></article>)}</div>}</main>;
}
