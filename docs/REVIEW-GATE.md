# Review gate protocol

Every Phase 0 module is reviewed separately against the brief:

1. Re-derive acceptance criteria from the product specification.
2. Inspect tenant boundaries, bilingual fields, empty states, and fabricated-data risks.
3. Exercise malformed and empty inputs where the module has executable behavior.
4. Record `APPROVED`, `APPROVED WITH NOTES`, or `REJECTED` with concrete findings.

This repository currently has no external sub-agent runtime exposed to the Architect Agent, so builder and critic passes are explicitly separated in the session log rather than blended into one implementation pass.

## Current Phase 1 slice

- Builder result: `src/ingestion/canadabuys.ts` and `db/migrations/0002_ingestion_runs.sql`.
- Critic result: `APPROVED WITH NOTES` — live metadata discovery and CSV download were verified against the official feed; normalization is deterministic, bilingual-safe, auditable, and idempotency-compatible. Database execution still requires a configured PostgreSQL instance and applied migrations.

## Current Phase 2 slice

- Builder result: `src/estimation/engine.ts` and `db/migrations/0003_cost_profiles.sql`.
- Critic result: `APPROVED WITH NOTES` — integer-cent deterministic math, visible formulas, versioned cost inputs, and organization-scoped RLS are covered; markup terminology remains explicitly recorded in `RISKS.md` for UX validation.

- Builder result: `app/cost-profile/page.tsx`, `src/estimation/profile.ts`, and `db/migrations/0004_project_overrides.sql`.
- Critic result: `APPROVED WITH NOTES` — project overrides merge immutably over a versioned company profile and are tenant-scoped; the UI remains an empty-state shell until authenticated persistence is wired.

## Current Phase 3 slice

- Builder result: `src/matching/engine.ts` and `db/migrations/0005_matching.sql`.
- Critic result: `APPROVED WITH NOTES` — scores are deterministic, explanations are persisted, unknown data is explicit, and capability/match records are organization-scoped; weights require calibration against estimator feedback before production ranking is trusted.

## Remaining phase slices

- Phase 4: `src/finance/cashflow.ts`, `db/migrations/0006_contract_finance.sql`, and contract detail/reporting shells. `APPROVED WITH NOTES` — zero-billing margin is explicit and portfolio rollups are deterministic.
- Phase 5: `src/notifications/match-alert.ts` and `db/migrations/0007_notifications.sql`. `APPROVED WITH NOTES` — threshold alerts are deduplicated and email is opt-in by default.
- Phase 6: responsive empty/error-state polish across overview, tenders, cost profile, reports, and contract detail routes. `APPROVED WITH NOTES` — no fabricated financial or tender data is displayed.
