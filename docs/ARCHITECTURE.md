# EstimatorAI pilot architecture

EstimatorAI is organized around one user workflow: configure the company, qualify an opportunity, process tender evidence, prepare a draft estimate, approve it, and learn from actual job results.

```mermaid
flowchart LR
  A[Company readiness] --> B[Operating model]
  C[CanadaBuys ingestion] --> D[Durable tender job]
  D --> E[Classification and capability match]
  E --> F[Public PDF discovery and page evidence]
  F --> G[Scope quantities and exceptions]
  G --> H[Shared deterministic estimate runner]
  B --> H
  H --> I[Draft estimate and bid recommendation]
  I --> J[Estimator approval]
  J --> K[Actual job results]
  K --> L[Reviewed versioned suggestions]
  L --> B
```

## Boundaries

- `src/company/readiness.ts` is the readiness calculation and does not decide whether a tender is viable.
- `src/tenders/analysis-service.ts` is reusable by the browser retry endpoint and the GitHub worker. It owns tender evidence and capability analysis.
- `src/estimation/estimate-runner.ts` is the only persistence path for generated estimates. Manual and automatic estimates therefore share the same calculation, assumption snapshot, lines, exceptions, and resource demand.
- `src/estimation/accuracy.ts` is deterministic calculation code. It never lets an AI extraction change a company rate or approve a bid.
- `supabase/migrations` is the only migration source. `db/migrations` is retained as historical reference.

## Processing states

The tender UI starts or retries a `tender_processing_jobs` row. GitHub claims queued work and records the stage after each durable checkpoint. Recoverable errors become retryable with backoff; permanent errors remain visible to the estimator. A successful job can still produce a review outcome such as missing documents, unsupported scope, or insufficient capability.

Every estimate line retains tender document/page evidence where available and links to the company assumption snapshot used for pricing. Project overrides can therefore be reviewed without rewriting the operating model or historical estimates.
