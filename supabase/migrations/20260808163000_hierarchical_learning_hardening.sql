-- Harden the hierarchical learning schema after deployment review.
-- Shared priors are server-managed aggregates and are never exposed directly
-- through a tenant session. The explicit deny policy documents that boundary
-- while service_role continues to bypass RLS for controlled server reads.

create policy "Shared learning priors are server only"
on public.learning_shared_priors
for all
to authenticated
using (false)
with check (false);

create index if not exists estimator_workbook_imports_superseded_by_idx
  on public.estimator_workbook_imports (superseded_by)
  where superseded_by is not null;

create index if not exists learning_evidence_assembly_idx
  on public.learning_evidence (assembly_id)
  where assembly_id is not null;

create index if not exists learning_evidence_assumption_version_idx
  on public.learning_evidence (assumption_version_id)
  where assumption_version_id is not null;

create index if not exists learning_evidence_superseded_by_idx
  on public.learning_evidence (superseded_by)
  where superseded_by is not null;

create index if not exists learning_evidence_trade_profile_idx
  on public.learning_evidence (trade_profile_id);

create index if not exists learning_model_versions_previous_version_idx
  on public.learning_model_versions (previous_version_id)
  where previous_version_id is not null;
