# EstimatorAI learning and workbook ingestion

## Business purpose

Estimators should not re-key company spreadsheets into EstimatorAI. A pre-bid estimate workbook can be dropped onto an estimate, and a final job-cost workbook can be dropped onto a completed job. EstimatorAI extracts structured cost evidence, reconciles control totals, compares the evidence with the immutable original estimate, and updates only future estimates.

## Evidence precedence

The unified `learning_evidence` pipeline applies this order of trust:

1. Reconciled completed-job actuals.
2. Partially reconciled job actuals.
3. Senior estimator corrections.
4. Pre-bid estimator workbooks.
5. Opt-in anonymized shared priors.

When actual job evidence exists for a project and category, it supersedes provisional estimator-workbook evidence so the project is not learned twice.

## Workbook processing

1. Validate `.xlsx`, `.xlsm`, or `.csv` files and the 12 MB limit.
2. Hash the workbook and identify duplicates and revisions.
3. Inspect every sheet for headers, cost codes, formulas, quantities, hours, rates, extended amounts, taxes, currency, and dates.
4. Normalize rows into labor, material, equipment, subcontractor, overhead, risk, and markup categories.
5. Reconcile accepted rows against the supplied or detected control total.
6. Keep ambiguous rows in a review queue with their source sheet, row, mapping evidence, and confidence.
7. Remember successful company-specific mappings in `workbook_mapping_profiles`.
8. Record accepted rows as immutable learning evidence and build a new model version.

The original workbook binary is not retained in the pilot. The system retains its SHA-256 hash, version metadata, extracted rows, mapping evidence, reconciliation result, and learning lineage.

## Hierarchical learning model

The transparent production model learns log-ratio adjustments at progressively more specific levels:

```text
Company
└── Trade
    └── Category and metric
        └── Task or assembly
            └── Crew or resource
```

Separate targets prevent one cause of error from contaminating another. The model learns quantity accuracy, labor hours, labor rate, material consumption, material price, equipment duration, equipment rate, overhead, schedule, and risk independently.

Early evidence is strongly shrunk toward the parent assumption. Robust median and median-absolute-deviation clipping limit outliers, evidence decays with a 365-day half-life, and active factors remain bounded between `0.65` and `1.45`. Final-job evidence has the greatest influence; provisional estimator workbooks use a low trust weight of `0.20`.

Change orders and abnormal rework train risk and contingency unless explicitly classified as baseline scope. They do not silently increase normal productivity or rates.

## Estimate behavior

Every new estimate snapshots the active `learning_model_version` and its parameters. The estimate runner applies learned factors to deterministic company assumptions and returns:

- Expected cost and recommended selling price.
- P50 expected cost and conservative P80 cost.
- Confidence and uncertainty by learned driver.
- Plain-language explanations of the adjustments used.
- The model version and evidence count behind the result.

Historical estimates are immutable. Rolling back a model changes the active version for future estimates only.

## Accuracy measurement

Each completed job contributes retained prediction-versus-observed metrics, including weighted absolute percentage error, signed bias, median percentage error, task-level labor and material differences, schedule error, and uncertainty coverage. The Jobs and learning screen shows the active models and allows an owner or administrator to restore a previous version.

Shared priors are disabled by default. When enabled, only sufficiently aggregated residual patterns may be used; raw workbook content and company-identifying data remain organization-scoped.
