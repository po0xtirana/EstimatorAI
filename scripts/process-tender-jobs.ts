import { createAdminClient } from "../src/lib/supabase/admin";
import { runTenderAnalysis } from "../src/tenders/analysis-service";

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 10;
const MAX_RUNTIME_MS = 12 * 60 * 1000;

function nextRetry(attempt: number): string {
  const delayMs = Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + delayMs).toISOString();
}

async function main() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY before processing tender jobs");
  let processed = 0;
  let found = 0;
  let batches = 0;
  const deadline = Date.now() + MAX_RUNTIME_MS;
  while (Date.now() < deadline) {
    const now = new Date().toISOString();
    const { data: jobs, error } = await admin.from("tender_processing_jobs")
      .select("*")
      .eq("job_type", "analyze_tender")
      .in("status", ["queued", "retryable"])
      .or(`next_run_at.is.null,next_run_at.lte.${now}`)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw new Error(`Unable to load tender jobs: ${error.message}`);
    if (!jobs?.length) break;
    found += jobs.length;
    batches += 1;
    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      const attempt = Number(job.attempt_count ?? 0) + 1;
      const claim = await admin.from("tender_processing_jobs").update({ status: "running", attempt_count: attempt, locked_at: new Date().toISOString(), locked_by: "github-worker", started_at: job.started_at ?? new Date().toISOString(), last_error: null }).eq("id", job.id).in("status", ["queued", "retryable"]).select("id").maybeSingle();
      if (claim.error || !claim.data) continue;
      try {
        const result = await runTenderAnalysis({ admin, organizationId: job.organization_id, tenderId: job.tender_id, jobId: job.id, authSubject: "github-worker" });
        await admin.from("tender_processing_jobs").update({ status: "succeeded", stage: "completed", result_metadata: { status: result.status, tenderAnalysisId: result.tenderAnalysisId ?? null, scopeCount: result.scopeCount ?? null }, completed_at: new Date().toISOString(), locked_at: null, locked_by: null, next_run_at: null }).eq("id", job.id);
        processed += 1;
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : String(jobError);
        const permanent = attempt >= MAX_ATTEMPTS;
        await admin.from("tender_processing_jobs").update({ status: permanent ? "failed" : "retryable", stage: permanent ? "completed" : "queued", last_error: message, next_run_at: permanent ? null : nextRetry(attempt), completed_at: permanent ? new Date().toISOString() : null, locked_at: null, locked_by: null }).eq("id", job.id);
      }
    }
  }
  console.log(JSON.stringify({ jobsFound: found, batches, jobsProcessed: processed, runtimeLimited: Date.now() >= deadline }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
