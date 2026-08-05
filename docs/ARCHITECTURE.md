# BidPilot Phase 0 Architecture

## Scope

The first vertical slice is CanadaBuys tender ingestion for Canadian contractors working in general renovation and adjacent trades: fire/water damage restoration, painting, window replacement, drywall, flooring, insulation, doors, roofing, siding, demolition/abatement, finish carpentry, and minor electrical/plumbing coordination.

## Boundaries

- CanadaBuys is the only live procurement source in the initial slice.
- SEAO remains a future source; its French-first records must fit the same bilingual model.
- Cost calculations will be deterministic and implemented behind a testable service boundary.
- Authentication will use a standard provider integration. Application code receives an authenticated organization context; it does not implement cryptography or password handling.
- Every tenant-owned table carries `organization_id`; database policies are the enforcement backstop.

## Phase gates

Phase 0 establishes the shell, auth/data boundaries, schema foundation, and risk register. No tender polling or price-producing logic is included until Phase 0 is reviewed and approved.
