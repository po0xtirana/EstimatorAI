import { calculateCalibration, compareEstimatorWorkbook, parseEstimatorWorkbook } from "./estimator-workbook";

async function run() {
  const csv = Buffer.from([
    "Northstar estimator worksheet,,,,,",
    "Prepared for client review,,,,,",
    "Cost Code,Description,Quantity,Unit,Unit Rate,Labor Cost,Material Cost,Subcontract Cost",
    "02-100,Remove damaged drywall,40,m2,25,1200,350,0",
    "09-200,Install and finish drywall,80,m2,42,2600,3360,500",
    "Subtotal,,,,,3800,3710,500"
  ].join("\n"));
  const parsed = await parseEstimatorWorkbook(csv, "restoration-estimate.csv");
  if (parsed.lines.length !== 5) throw new Error(`workbook detail extraction failed: ${parsed.lines.length}`);
  if (parsed.categoryTotals.labor !== 380000 || parsed.categoryTotals.material !== 371000) throw new Error("category-specific amount columns failed");
  if (parsed.categoryTotals.subcontractor !== 50000 || parsed.totalAmountCents !== 801000 || parsed.mappingMetadata.sheets[0]?.headerRow !== 3) throw new Error("workbook total, subcontract, or shifted header detection failed");

  const workbookLines = parsed.lines.map((line, index) => ({ ...line, id: `workbook-${index}` }));
  const comparison = compareEstimatorWorkbook([
    { id: "ai-labor-1", kind: "labor", label: "Remove damaged drywall labor", amount_cents: 110000 },
    { id: "ai-labor-2", kind: "labor", label: "Install and finish drywall labor", amount_cents: 250000 },
    { id: "ai-material-1", kind: "material", label: "Drywall materials", amount_cents: 340000 }
  ], workbookLines, parsed.extractionConfidence);
  if (comparison.aiTotalCents !== 700000 || comparison.estimatorTotalCents !== 801000) throw new Error("estimate comparison totals failed");
  if (!comparison.lines.some((line) => line.estimateLineId && line.workbookLineId)) throw new Error("line matching failed");

  const calibration = calculateCalibration([
    { observed_factor: 1.08, trust_weight: 0.35, confidence: 92, created_at: "2026-08-03" },
    { observed_factor: 1.1, trust_weight: 0.35, confidence: 90, created_at: "2026-08-02" },
    { observed_factor: 1.09, trust_weight: 0.35, confidence: 88, created_at: "2026-08-01" }
  ]);
  if (calibration.status !== "active" || calibration.appliedFactor <= 1) throw new Error("guarded calibration activation failed");
}

export default run();
